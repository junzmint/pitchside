package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"pitchside/game"
)

const cookieName = "ps_session"

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	dsn := env("DATABASE_URL", "postgres://pitch:pitch@localhost:55432/pitchside?sslmode=disable")
	port := env("PORT", "8095")
	ctx := context.Background()

	var pool *pgxpool.Pool
	var err error
	for i := 0; i < 30; i++ {
		pool, err = pgxpool.New(ctx, dsn)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				break
			}
			pool.Close()
		}
		log.Printf("waiting for database: %v", err)
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	store := game.NewStore(pool)
	if err := store.Migrate(ctx); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	// saves created before new legends were added get their cards too
	if err := store.SyncLegendCards(ctx); err != nil {
		log.Printf("legend sync: %v", err)
	}
	// `pitchside seed` loads demo data and exits; AUTO_SEED=1 seeds a brand-new database on start.
	if len(os.Args) > 1 && os.Args[1] == "seed" {
		if err := runSeed(ctx, store); err != nil {
			log.Fatalf("seed: %v", err)
		}
		log.Printf("seed: done")
		return
	}
	if os.Getenv("AUTO_SEED") == "1" {
		seedIfEmpty(ctx, store)
	}
	srv := &http.Server{Addr: ":" + port, Handler: routes(store), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("pitchside api on :%s", port)
	log.Fatal(srv.ListenAndServe())
}

// ---------------------------------------------------------------- plumbing

type handler func(r *http.Request) (any, error)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	if u, ok := game.IsUserErr(err); ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": u.Msg, "code": u.Code})
		return
	}
	if errors.Is(err, game.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found", "code": "not_found"})
		return
	}
	log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Server error", "code": "server"})
}

func wrap(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := h(r)
		if err != nil {
			fail(w, r, err)
			return
		}
		if out == nil {
			out = map[string]bool{"ok": true}
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func intParam(r *http.Request, name string) (int, error) {
	v, err := strconv.Atoi(r.PathValue(name))
	if err != nil {
		return 0, game.ErrNotFound
	}
	return v, nil
}

func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return game.ErrUser{Code: "bad_request", Msg: "Invalid request body"}
	}
	return nil
}

type ctxKey int

const userKey ctxKey = 1

func currentUser(r *http.Request) *game.User { return r.Context().Value(userKey).(*game.User) }

// authed requires a session cookie.
func authed(s *game.Store, h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, _ := r.Cookie(cookieName)
		tok := ""
		if c != nil {
			tok = c.Value
		}
		u, err := s.UserBySession(r.Context(), tok)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please log in", "code": "login_required"})
			return
		}
		wrap(h)(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	}
}

// career wraps handlers under /api/careers/{id}: requires login and ownership.
func career(s *game.Store, h func(r *http.Request, id int) (any, error)) http.HandlerFunc {
	return authed(s, func(r *http.Request) (any, error) {
		id, err := intParam(r, "id")
		if err != nil {
			return nil, err
		}
		owned, ended := s.CareerStatus(r.Context(), id, currentUser(r).ID)
		if !owned {
			return nil, game.ErrNotFound
		}
		// an ended career is read-only (deleting it is a separate route)
		if ended != "" && r.Method != http.MethodGet {
			return nil, game.ErrCareerOver
		}
		return h(r, id)
	})
}

func setSession(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

// ---------------------------------------------------------------- routes

func routes(s *game.Store) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", wrap(func(r *http.Request) (any, error) { return nil, nil }))
	mux.HandleFunc("GET /api/leagues", wrap(func(r *http.Request) (any, error) { return game.ListLeagues(), nil }))

	type creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	authHandler := func(fn func(ctx context.Context, u, p string) (*game.User, string, error)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			var c creds
			if err := decode(r, &c); err != nil {
				fail(w, r, err)
				return
			}
			u, tok, err := fn(r.Context(), c.Username, c.Password)
			if err != nil {
				fail(w, r, err)
				return
			}
			setSession(w, tok, int(game.SessionTTL.Seconds()))
			writeJSON(w, http.StatusOK, u)
		}
	}
	mux.HandleFunc("POST /api/auth/register", authHandler(s.Register))
	mux.HandleFunc("POST /api/auth/login", authHandler(s.Login))
	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, _ := r.Cookie(cookieName); c != nil {
			_ = s.Logout(r.Context(), c.Value)
		}
		setSession(w, "", -1)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/auth/me", authed(s, func(r *http.Request) (any, error) { return currentUser(r), nil }))

	mux.HandleFunc("GET /api/careers", authed(s, func(r *http.Request) (any, error) {
		return s.ListCareers(r.Context(), currentUser(r).ID)
	}))
	mux.HandleFunc("POST /api/careers", authed(s, func(r *http.Request) (any, error) {
		var req game.NewCareerReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		id, err := s.NewCareer(r.Context(), currentUser(r).ID, req)
		return map[string]int{"id": id}, err
	}))
	mux.HandleFunc("DELETE /api/careers/{id}", career(s, func(r *http.Request, id int) (any, error) {
		return nil, s.DeleteCareer(r.Context(), id)
	}))
	mux.HandleFunc("GET /api/careers/{id}", career(s, func(r *http.Request, id int) (any, error) {
		return s.State(r.Context(), id)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/lineup", career(s, func(r *http.Request, id int) (any, error) {
		var req game.LineupReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetLineup(r.Context(), id, req)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/training", career(s, func(r *http.Request, id int) (any, error) {
		var req game.TrainingReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetTraining(r.Context(), id, req)
	}))

	// market & staff
	mux.HandleFunc("GET /api/careers/{id}/market", career(s, func(r *http.Request, id int) (any, error) {
		return s.Market(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/players/{pid}/buy", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		return s.Buy(r.Context(), id, pid)
	}))
	mux.HandleFunc("POST /api/careers/{id}/players/{pid}/release", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		got, err := s.QuickSell(r.Context(), id, pid)
		return map[string]int64{"received": got}, err
	}))
	mux.HandleFunc("POST /api/careers/{id}/templates", career(s, func(r *http.Request, id int) (any, error) {
		var req game.TemplateReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.CreateTemplate(r.Context(), id, req)
	}))
	mux.HandleFunc("DELETE /api/careers/{id}/templates/{tid}", career(s, func(r *http.Request, id int) (any, error) {
		tid, err := intParam(r, "tid")
		if err != nil {
			return nil, err
		}
		return nil, s.DeleteTemplate(r.Context(), id, tid)
	}))
	mux.HandleFunc("GET /api/careers/{id}/scout", career(s, func(r *http.Request, id int) (any, error) {
		return s.Scout(r.Context(), id, r.URL.Query().Get("league"), r.URL.Query().Get("pos"))
	}))
	mux.HandleFunc("POST /api/careers/{id}/deals/quote", career(s, func(r *http.Request, id int) (any, error) {
		var req game.DealReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.QuoteDeal(r.Context(), id, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/deals", career(s, func(r *http.Request, id int) (any, error) {
		var req game.DealReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.MakeDeal(r.Context(), id, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/coaches/{cid}/hire", career(s, func(r *http.Request, id int) (any, error) {
		c, err := intParam(r, "cid")
		if err != nil {
			return nil, err
		}
		return nil, s.Hire(r.Context(), id, c)
	}))
	mux.HandleFunc("POST /api/careers/{id}/coaches/{cid}/fire", career(s, func(r *http.Request, id int) (any, error) {
		c, err := intParam(r, "cid")
		if err != nil {
			return nil, err
		}
		return nil, s.Fire(r.Context(), id, c)
	}))

	// competitions, clubs, stats, history
	mux.HandleFunc("GET /api/careers/{id}/competitions", career(s, func(r *http.Request, id int) (any, error) {
		return s.Competitions(r.Context(), id, r.URL.Query().Get("lite") == "1")
	}))
	mux.HandleFunc("GET /api/careers/{id}/clubs/{club}", career(s, func(r *http.Request, id int) (any, error) {
		c, err := intParam(r, "club")
		if err != nil {
			return nil, err
		}
		return s.ClubInfo(r.Context(), id, c)
	}))
	mux.HandleFunc("GET /api/careers/{id}/stats", career(s, func(r *http.Request, id int) (any, error) {
		season, _ := strconv.Atoi(r.URL.Query().Get("season"))
		return s.Stats(r.Context(), id, season, r.URL.Query().Get("comp"))
	}))
	mux.HandleFunc("GET /api/careers/{id}/history", career(s, func(r *http.Request, id int) (any, error) {
		return s.History(r.Context(), id)
	}))

	// money
	mux.HandleFunc("GET /api/careers/{id}/finance", career(s, func(r *http.Request, id int) (any, error) {
		return s.Finance(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/sponsor", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Index int `json:"index"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.ChooseSponsor(r.Context(), id, req.Index)
	}))
	mux.HandleFunc("GET /api/careers/{id}/quests", career(s, func(r *http.Request, id int) (any, error) {
		return s.Quests(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/quests/{qid}/claim", career(s, func(r *http.Request, id int) (any, error) {
		qid, err := intParam(r, "qid")
		if err != nil {
			return nil, err
		}
		got, err := s.ClaimQuest(r.Context(), id, qid)
		return map[string]int64{"reward": got}, err
	}))

	// club development
	mux.HandleFunc("POST /api/careers/{id}/facilities/{kind}", career(s, func(r *http.Request, id int) (any, error) {
		return nil, s.UpgradeFacility(r.Context(), id, r.PathValue("kind"))
	}))
	mux.HandleFunc("PUT /api/careers/{id}/ticket", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Price string `json:"price"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetTicket(r.Context(), id, req.Price)
	}))
	mux.HandleFunc("POST /api/careers/{id}/loan", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Amount int64 `json:"amount"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.TakeLoan(r.Context(), id, req.Amount)
	}))
	mux.HandleFunc("POST /api/careers/{id}/loan/repay", career(s, func(r *http.Request, id int) (any, error) {
		return nil, s.RepayLoan(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/tp", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			N int `json:"n"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.BuyTP(r.Context(), id, req.N)
	}))
	mux.HandleFunc("POST /api/careers/{id}/players/{pid}/reveal", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		return s.RevealTraits(r.Context(), id, pid)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/players/{pid}/care", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		var req game.CareReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetCare(r.Context(), id, pid, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/demands", career(s, func(r *http.Request, id int) (any, error) {
		var req game.DemandReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.AnswerDemand(r.Context(), id, req)
	}))
	mux.HandleFunc("GET /api/careers/{id}/commercial", career(s, func(r *http.Request, id int) (any, error) {
		return s.CommercialInfo(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/commercial", career(s, func(r *http.Request, id int) (any, error) {
		var req game.CommercialReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.Commercial(r.Context(), id, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/players/{pid}/renew", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		return nil, s.RenewEarly(r.Context(), id, pid)
	}))
	registerEventRoutes(mux, s)
	registerLanRoutes(mux, s)
	registerPlayRoutes(mux, s)
	registerWorldRoutes(mux, s)
	registerExploreRoutes(mux, s)
	registerClubRoutes(mux, s)
	registerMedicalRoutes(mux, s)
	registerStaffRoutes(mux, s)
	registerKitRoutes(mux, s)
	mux.HandleFunc("POST /api/careers/{id}/icon-pick", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			TemplateID int `json:"templateId"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.PickIcon(r.Context(), id, req.TemplateID)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/autoxi", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			On bool `json:"on"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetAutoXI(r.Context(), id, req.On)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/rotation", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Threshold int `json:"threshold"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetRotation(r.Context(), id, req.Threshold)
	}))
	mux.HandleFunc("POST /api/careers/{id}/players/{pid}/upgrade", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		var req struct {
			What string `json:"what"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.UpgradePlayer(r.Context(), id, pid, req.What)
	}))

	// matches
	mux.HandleFunc("GET /api/careers/{id}/match", career(s, func(r *http.Request, id int) (any, error) {
		return s.MatchSetup(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/play", career(s, func(r *http.Request, id int) (any, error) {
		var req game.MatchResultReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.PlayDay(r.Context(), id, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/friendly", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			OpponentID int `json:"opponentId"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetupFriendly(r.Context(), id, req.OpponentID)
	}))
	mux.HandleFunc("POST /api/careers/{id}/new-season", career(s, func(r *http.Request, id int) (any, error) {
		return s.StartNextSeason(r.Context(), id)
	}))
	return mux
}
