package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"pitchside/game"
)

// ---------------------------------------------------------------- LAN play
//
// Two people on the same Wi-Fi play one live match: the host's browser runs the match engine,
// a second device joins with a four-letter room code and controls the other team. The server
// only relays messages between the two sockets of a room; it never looks inside them.
//
//	GET  /api/lan/info                         → the address other devices should open
//	GET  /api/lan/room?code=ABCD               → {code, host, guest} or 404 (guests check a code before joining)
//	WS   /api/lan/ws?role=host                 → (logged in) opens a room, first message {"type":"room","code":"ABCD","key":…}
//	WS   /api/lan/ws?role=host&code=ABCD&key=K → the host comes back to its room after a dropped connection
//	WS   /api/lan/ws?role=guest&code=ABCD&key=G → joins; the host gets {"type":"peer-joined"}, the guest {"type":"joined","info":…}
//
// Host → guest and guest → host messages are passed through as they are. A host message
// {"type":"info", …} is also kept as the room's lobby info for guests who join later.
// When either side leaves, the other gets {"type":"peer-left","who":"host"|"guest"}.
// A host that closes its socket normally (close code 1000) ends the room at once; a host whose
// connection just dropped keeps the room for lanHostGrace so it can come back with its key.
// A guest that comes back with the same key (its own random id) replaces its stale connection.

const (
	lanCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no O/0/I/1
	lanRoomTTL   = 6 * time.Hour
	lanHostGrace = 90 * time.Second
	lanMaxMsg    = 256 << 10
)

type lanRoom struct {
	code     string
	mu       sync.Mutex
	host     *websocket.Conn
	hostKey  string
	guest    *websocket.Conn
	guestKey string
	info     json.RawMessage
	created  time.Time
	hostGone time.Time // when the host's connection dropped (zero while connected)
	closed   bool
}

var lanRooms = struct {
	sync.Mutex
	m map[string]*lanRoom
}{m: map[string]*lanRoom{}}

func lanRandom(chars string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		v, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b.WriteByte(chars[v.Int64()])
	}
	return b.String()
}

func lanKey() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// lanSweep drops rooms that are too old or whose host never came back (callers hold lanRooms).
func lanSweep() {
	for code, r := range lanRooms.m {
		r.mu.Lock()
		stale := time.Since(r.created) > lanRoomTTL || (!r.hostGone.IsZero() && time.Since(r.hostGone) > lanHostGrace)
		guest := r.guest
		if stale {
			r.closed = true
			r.guest = nil
		}
		r.mu.Unlock()
		if stale {
			delete(lanRooms.m, code)
			if guest != nil {
				// Close waits up to 10 s for the close handshake: never while holding lanRooms
				go func() { _ = guest.Close(websocket.StatusNormalClosure, "room closed") }()
			}
		}
	}
}

func lanOpen() *lanRoom {
	lanRooms.Lock()
	defer lanRooms.Unlock()
	lanSweep()
	for {
		code := lanRandom(lanCodeChars, 4)
		if _, taken := lanRooms.m[code]; !taken {
			r := &lanRoom{code: code, created: time.Now(), hostKey: lanKey()}
			lanRooms.m[code] = r
			return r
		}
	}
}

func lanFind(code string) *lanRoom {
	lanRooms.Lock()
	defer lanRooms.Unlock()
	lanSweep()
	return lanRooms.m[strings.ToUpper(strings.TrimSpace(code))]
}

func lanClose(r *lanRoom) {
	lanRooms.Lock()
	if lanRooms.m[r.code] == r {
		delete(lanRooms.m, r.code)
	}
	lanRooms.Unlock()
	r.mu.Lock()
	r.closed = true
	guest := r.guest
	r.guest = nil
	r.mu.Unlock()
	if guest != nil {
		_ = guest.Close(websocket.StatusNormalClosure, "host left")
	}
}

func lanSend(ctx context.Context, c *websocket.Conn, v any) {
	if c == nil {
		return
	}
	b, _ := json.Marshal(v)
	wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_ = c.Write(wctx, websocket.MessageText, b)
}

// lanLocalIP: the machine's own private IPv4 address, when the API runs directly on it (make api).
// Inside Docker the container only sees its virtual network, so there LAN_IP must come from `make up`.
func lanLocalIP() string {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return ""
	}
	ifs, err := net.Interfaces()
	if err != nil {
		return ""
	}
	best := ""
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || !ip.IsPrivate() {
				continue
			}
			// Wi-Fi / Ethernet first (en0, en1, eth0, wlan0); virtual bridges last
			if strings.HasPrefix(ifc.Name, "en") || strings.HasPrefix(ifc.Name, "eth") || strings.HasPrefix(ifc.Name, "wl") {
				return ip.String()
			}
			if best == "" {
				best = ip.String()
			}
		}
	}
	return best
}

var lanIPOnce = sync.OnceValue(lanLocalIP)

// lanAddress: what other devices should type in their browser. LAN_IP is set by `make up`
// (the container can't see the Mac's Wi-Fi address itself); WEB_PORT defaults to 5195.
func lanAddress() map[string]string {
	ip := os.Getenv("LAN_IP")
	if ip == "" {
		ip = lanIPOnce()
	}
	port := env("WEB_PORT", "5195")
	url := ""
	if ip != "" {
		url = "http://" + ip + ":" + port
	}
	return map[string]string{"ip": ip, "port": port, "url": url}
}

func registerLanRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/lan/info", wrap(func(r *http.Request) (any, error) { return lanAddress(), nil }))
	mux.HandleFunc("GET /api/lan/room", func(w http.ResponseWriter, r *http.Request) {
		room := lanFind(r.URL.Query().Get("code"))
		if room == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "No match with this code", "code": "lan_no_room"})
			return
		}
		room.mu.Lock()
		out := map[string]any{"code": room.code, "host": room.host != nil, "guest": room.guest != nil}
		room.mu.Unlock()
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("GET /api/lan/ws", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		role := q.Get("role")
		key := strings.TrimSpace(q.Get("key"))
		var room *lanRoom
		resumed := false
		switch role {
		case "host":
			c, _ := r.Cookie(cookieName)
			tok := ""
			if c != nil {
				tok = c.Value
			}
			if _, err := s.UserBySession(r.Context(), tok); err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Please log in", "code": "login_required"})
				return
			}
			if code := q.Get("code"); code != "" {
				// coming back to our own room after a dropped connection
				room = lanFind(code)
				if room == nil {
					writeJSON(w, http.StatusNotFound, map[string]string{"error": "No match with this code", "code": "lan_no_room"})
					return
				}
				room.mu.Lock()
				ok := key != "" && key == room.hostKey && !room.closed
				room.mu.Unlock()
				if !ok {
					writeJSON(w, http.StatusConflict, map[string]string{"error": "This room belongs to someone else", "code": "lan_taken"})
					return
				}
				resumed = true
			}
		case "guest":
			if room = lanFind(q.Get("code")); room == nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "No match with this code", "code": "lan_no_room"})
				return
			}
			room.mu.Lock()
			busy := room.guest != nil && (key == "" || key != room.guestKey)
			room.mu.Unlock()
			if busy {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "Someone has already joined", "code": "lan_full"})
				return
			}
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "role must be host or guest", "code": "bad_request"})
			return
		}
		// a game on the local network: other devices load the page from this server's LAN address
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		conn.SetReadLimit(lanMaxMsg)
		ctx := r.Context()
		if role == "host" {
			if room == nil {
				room = lanOpen()
			}
			room.mu.Lock()
			old := room.host // a stale connection of the same host (its key matched): replace it
			room.host = conn
			room.hostGone = time.Time{}
			guest, hostKey := room.guest, room.hostKey
			room.mu.Unlock()
			if old != nil {
				// in the background: Close waits up to 10 s for a dead socket's handshake
				go func() { _ = old.Close(websocket.StatusNormalClosure, "replaced") }()
			}
			lanSend(ctx, conn, map[string]any{"type": "room", "code": room.code, "key": hostKey, "address": lanAddress(), "resumed": resumed, "guest": guest != nil})
			if resumed && guest != nil {
				lanSend(ctx, guest, map[string]any{"type": "peer-joined", "who": "host"})
				lanSend(ctx, conn, map[string]any{"type": "peer-joined", "who": "guest"})
			}
		} else {
			room.mu.Lock()
			old := room.guest
			room.guest = conn
			room.guestKey = key
			host, info := room.host, room.info
			room.mu.Unlock()
			if old != nil {
				// in the background: Close waits up to 10 s for a dead socket's handshake
				go func() { _ = old.Close(websocket.StatusNormalClosure, "replaced") }()
			}
			lanSend(ctx, conn, map[string]any{"type": "joined", "code": room.code, "info": info, "host": host != nil})
			lanSend(ctx, host, map[string]any{"type": "peer-joined", "who": "guest", "again": old != nil})
		}
		var closeCode websocket.StatusCode = -1
		defer func() {
			room.mu.Lock()
			var other *websocket.Conn
			mine := false
			if role == "host" {
				if room.host == conn {
					room.host, other, mine = nil, room.guest, true
					room.hostGone = time.Now()
				}
			} else if room.guest == conn {
				room.guest, other, mine = nil, room.host, true
			}
			room.mu.Unlock()
			if mine {
				lanSend(context.Background(), other, map[string]any{"type": "peer-left", "who": role})
				if role == "host" {
					if closeCode == websocket.StatusNormalClosure {
						lanClose(room) // the host left on purpose: the match is over
					} else {
						// a dropped connection: keep the room a little while for the host to come back
						time.AfterFunc(lanHostGrace+time.Second, func() {
							lanRooms.Lock()
							lanSweep()
							lanRooms.Unlock()
						})
					}
				}
			}
			_ = conn.Close(websocket.StatusNormalClosure, "")
		}()
		// keep the connection alive through idle stretches (pause menus, half-time) and notice dead peers
		go func() {
			t := time.NewTicker(10 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					pctx, cancel := context.WithTimeout(ctx, 6*time.Second)
					err := conn.Ping(pctx)
					cancel()
					if err != nil {
						_ = conn.Close(websocket.StatusGoingAway, "no answer")
						return
					}
				}
			}
		}()
		infoTag := []byte(`{"type":"info"`)
		for {
			typ, data, err := conn.Read(ctx)
			if err != nil {
				closeCode = websocket.CloseStatus(err)
				return
			}
			room.mu.Lock()
			var to *websocket.Conn
			if role == "host" {
				to = room.guest
				if len(data) < 16<<10 && bytes.HasPrefix(data, infoTag) {
					room.info = append(json.RawMessage(nil), data...)
				}
			} else {
				to = room.host
			}
			room.mu.Unlock()
			if to != nil {
				wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
				_ = to.Write(wctx, typ, data)
				cancel()
			}
		}
	})
}
