package game

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const SessionTTL = 30 * 24 * time.Hour

type User struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,24}$`)

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) Register(ctx context.Context, username, password string) (*User, string, error) {
	username = strings.TrimSpace(username)
	if !usernameRe.MatchString(username) {
		return nil, "", userErr("bad_username", "Username must be 3–24 letters, digits, dot, dash or underscore")
	}
	if len(password) < 6 || len(password) > 72 {
		return nil, "", userErr("bad_password", "Password must be 6–72 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}
	u := &User{Username: username}
	err = s.DB.QueryRow(ctx, `INSERT INTO users (username, pass_hash) VALUES ($1, $2) RETURNING id`, username, string(hash)).Scan(&u.ID)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, "", userErr("username_taken", "That username is taken")
		}
		return nil, "", err
	}
	tok, err := s.newSession(ctx, u.ID)
	return u, tok, err
}

func (s *Store) Login(ctx context.Context, username, password string) (*User, string, error) {
	u := &User{}
	var hash string
	err := s.DB.QueryRow(ctx, `SELECT id, username, pass_hash FROM users WHERE lower(username)=lower($1)`, strings.TrimSpace(username)).
		Scan(&u.ID, &u.Username, &hash)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil) {
		return nil, "", userErr("bad_login", "Wrong username or password")
	}
	if err != nil {
		return nil, "", err
	}
	tok, err := s.newSession(ctx, u.ID)
	return u, tok, err
}

func (s *Store) newSession(ctx context.Context, userID int) (string, error) {
	tok := newToken()
	_, err := s.DB.Exec(ctx, `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`, tok, userID, time.Now().Add(SessionTTL))
	return tok, err
}

func (s *Store) Logout(ctx context.Context, token string) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM sessions WHERE token=$1`, token)
	return err
}

func (s *Store) UserBySession(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, ErrNotFound
	}
	u := &User{}
	err := s.DB.QueryRow(ctx, `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token=$1 AND s.expires_at > now()`, token).Scan(&u.ID, &u.Username)
	return u, notFound(err)
}

// Owns reports whether the career belongs to the user.
func (s *Store) Owns(ctx context.Context, careerID, userID int) bool {
	ok, _ := s.CareerStatus(ctx, careerID, userID)
	return ok
}

// CareerStatus says whether the user owns the career and, if it is over, why.
func (s *Store) CareerStatus(ctx context.Context, careerID, userID int) (owned bool, ended string) {
	err := s.DB.QueryRow(ctx, `SELECT ended FROM careers WHERE id=$1 AND user_id=$2`, careerID, userID).Scan(&ended)
	return err == nil, ended
}

// ErrCareerOver is returned for any change to a career that has ended.
var ErrCareerOver = userErr("career_over", "This career is over")

type CareerSummary struct {
	ID        int       `json:"id"`
	League    string    `json:"league"`
	Season    int       `json:"season"`
	Day       int       `json:"day"`
	ClubName  string    `json:"clubName"`
	Short     string    `json:"short"`
	Color     string    `json:"color"`
	Color2    string    `json:"color2"`
	Budget    int64     `json:"budget"`
	Ended     string    `json:"ended"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Store) ListCareers(ctx context.Context, userID int) ([]CareerSummary, error) {
	rows, err := s.DB.Query(ctx, `SELECT c.id, c.league, c.season, c.day, k.name, k.short, k.color, k.color2, k.budget, c.ended, c.updated_at
		FROM careers c JOIN clubs k ON k.id=c.user_club_id WHERE c.user_id=$1 ORDER BY c.updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CareerSummary{}
	for rows.Next() {
		var c CareerSummary
		if err := rows.Scan(&c.ID, &c.League, &c.Season, &c.Day, &c.ClubName, &c.Short, &c.Color, &c.Color2, &c.Budget, &c.Ended, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCareer(ctx context.Context, careerID int) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM careers WHERE id=$1`, careerID)
	return err
}
