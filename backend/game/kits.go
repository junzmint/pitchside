package game

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- kits
//
// Every club has three kits: home, away and third. Each kit is a shirt pattern in two colours (the
// shirt and its trim) plus shorts and socks. Defaults come from kitData (data_kits.go), keyed by
// club name (world clubs by city); clubs without an entry get kits made from their two colours.
// The user can design his own club's kits (club_kits table); matches pick the kits so the two teams
// never look alike (frontend/src/match/engine.ts pickKits).

type Kit struct {
	Pattern string `json:"pattern"` // see KitPatterns
	Shirt   string `json:"shirt"`   // "#rrggbb"
	Trim    string `json:"trim"`    // the pattern's second colour, collar and cuffs
	Shorts  string `json:"shorts"`
	Socks   string `json:"socks"`
}

type Kits struct {
	Home  Kit `json:"home"`
	Away  Kit `json:"away"`
	Third Kit `json:"third"`
}

// KitPatterns: plain, vertical stripes, thin pinstripes, horizontal hoops, two halves, four
// quarters, a diagonal sash, a V on the chest, sleeves in the trim colour, one broad vertical
// stripe down the middle, and a band across the chest.
var KitPatterns = []string{"plain", "stripes", "pinstripes", "hoops", "halves", "quarters", "sash", "chevron", "sleeves", "centre", "band"}

// KitPalette: the colour swatches the kit designer offers (any other colour can be typed in too).
var KitPalette = []string{"#ffffff", "#f4f4f4", "#c0c0c0", "#8c8c8c", "#111111", "#1b2a4a", "#1d3f94", "#0067b1", "#1e90ff",
	"#6cabdd", "#87d8f7", "#0e6e6e", "#00843d", "#65b32e", "#9acd32", "#fde100", "#f2c12e", "#f2a900", "#f68712", "#e2001a",
	"#c8102e", "#a50044", "#8a1538", "#670e36", "#5c2d91", "#9b5de5", "#f5a2c4", "#d64a8a", "#6b3e1e", "#d1b26f"}

var hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validPattern(p string) bool {
	for _, x := range KitPatterns {
		if x == p {
			return true
		}
	}
	return false
}

func (k Kit) valid() bool {
	return validPattern(k.Pattern) && hexColour.MatchString(k.Shirt) && hexColour.MatchString(k.Trim) &&
		hexColour.MatchString(k.Shorts) && hexColour.MatchString(k.Socks)
}

func (k Kits) valid() bool { return k.Home.valid() && k.Away.valid() && k.Third.valid() }

func (k Kit) lower() Kit {
	return Kit{Pattern: k.Pattern, Shirt: strings.ToLower(k.Shirt), Trim: strings.ToLower(k.Trim), Shorts: strings.ToLower(k.Shorts), Socks: strings.ToLower(k.Socks)}
}

// parseKit reads "pattern shirt trim shorts socks" (colours as hex without #).
func parseKit(s string) (Kit, bool) {
	f := strings.Fields(s)
	if len(f) != 5 {
		return Kit{}, false
	}
	k := Kit{Pattern: f[0], Shirt: "#" + f[1], Trim: "#" + f[2], Shorts: "#" + f[3], Socks: "#" + f[4]}
	return k.lower(), k.valid()
}

func rgbOf(hex string) (float64, float64, float64) {
	var r, g, b int
	if _, err := fmt.Sscanf(strings.TrimPrefix(hex, "#"), "%02x%02x%02x", &r, &g, &b); err != nil {
		return 0, 0, 0
	}
	return float64(r), float64(g), float64(b)
}

// colourDist: a rough perceptual distance between two colours (0 … ~765), the same measure the
// match engine uses for kit clashes.
func colourDist(a, b string) float64 {
	r1, g1, b1 := rgbOf(a)
	r2, g2, b2 := rgbOf(b)
	rm := (r1 + r2) / 2
	dr, dg, db := r1-r2, g1-g2, b1-b2
	return math.Sqrt((2+rm/256)*dr*dr + 4*dg*dg + (2+(255-rm)/256)*db*db)
}

func luma(hex string) float64 {
	r, g, b := rgbOf(hex)
	return (0.299*r + 0.587*g + 0.114*b) / 255
}

// ---------------------------------------------------------------- telling kits apart
//
// kitLook: how different two kits look, 0 for identical. A kit is seen as its colours with their
// share of the shirt (patterns: kitTrim). Two kits clash (kitLook < KitClash) when they share a main
// colour (half of a striped shirt counts as main) or when their colours, share for share, are close.
// The match engine uses the same measure (frontend/src/match/engine.ts kitDistance).

const KitClash = 200.0

var kitTrim = map[string]float64{"plain": 0.05, "stripes": 0.5, "pinstripes": 0.15, "hoops": 0.5, "halves": 0.5, "quarters": 0.5,
	"sash": 0.25, "chevron": 0.15, "sleeves": 0.3, "centre": 0.25, "band": 0.2}

type kitCol struct {
	c string
	w float64
}

func kitCols(k Kit) []kitCol {
	s := kitTrim[k.Pattern]
	if s < 0.15 {
		return []kitCol{{k.Shirt, 1}}
	}
	return []kitCol{{k.Shirt, 1 - s}, {k.Trim, s}}
}

// emd2: the cheapest way to turn one colour mix into the other (earth mover's distance, ≤ 2 colours each).
func emd2(a, b []kitCol) float64 {
	if len(a) == 1 || len(b) == 1 {
		one, other := a, b
		if len(b) == 1 {
			one, other = b, a
		}
		sum := 0.0
		for _, x := range other {
			sum += x.w * colourDist(one[0].c, x.c)
		}
		return sum
	}
	cost := func(f11 float64) float64 {
		f12, f21 := a[0].w-f11, b[0].w-f11
		f22 := 1 - a[0].w - b[0].w + f11
		return f11*colourDist(a[0].c, b[0].c) + f12*colourDist(a[0].c, b[1].c) + f21*colourDist(a[1].c, b[0].c) + f22*colourDist(a[1].c, b[1].c)
	}
	return math.Min(cost(math.Min(a[0].w, b[0].w)), cost(math.Max(0, a[0].w+b[0].w-1)))
}

func kitLook(a, b Kit) float64 {
	A, B := kitCols(a), kitCols(b)
	dom := math.Inf(1)
	for _, x := range A {
		for _, y := range B {
			if x.w >= 0.45 && y.w >= 0.45 {
				dom = math.Min(dom, colourDist(x.c, y.c))
			}
		}
	}
	return math.Min(dom*KitClash/150, emd2(A, B)*KitClash/180)
}

// changeKit: the first classic change colour that stands apart from every kit in avoid (or the one
// that stands apart most), with the club's own colour as the trim when it shows.
func changeKit(home Kit, avoid ...Kit) Kit {
	cands := []string{"#f4f4f4", home.Trim, "#1b2a4a", "#111111", "#f2c12e", "#87ceeb", "#00843d", "#c8102e", "#e86a1c", "#5c2d91", "#c0c0c0", "#0e6e6e"}
	var best Kit
	bs := -1.0
	for _, c := range cands {
		trim := home.Shirt
		if colourDist(c, trim) < 160 {
			trim = home.Trim
		}
		if colourDist(c, trim) < 160 {
			trim = "#ffffff"
			if luma(c) > 0.6 {
				trim = "#111111"
			}
		}
		k := plainKit(c, trim)
		if luma(c) > 0.62 && colourDist(c, home.Shirt) > 160 {
			k.Shorts = home.Shirt // a white change shirt with shorts in the club's colour
		}
		s := math.Inf(1)
		for _, o := range avoid {
			s = math.Min(s, kitLook(k, o))
		}
		if s >= KitClash+30 {
			return k
		}
		if s > bs {
			best, bs = k, s
		}
	}
	return best
}

// plainKit: a simple kit in one colour with a trim; shorts follow the shirt unless it is light.
func plainKit(shirt, trim string) Kit {
	return Kit{Pattern: "plain", Shirt: shirt, Trim: trim, Shorts: shirt, Socks: shirt}
}

// awayFrom: a change kit that stands apart from the home kit.
func awayFrom(home Kit) Kit { return changeKit(home, home) }

// thirdFrom: a third kit that stands apart from both the home and the away kit.
func thirdFrom(home, away Kit) Kit { return changeKit(home, home, away) }

// kitEntry finds a club's line in kitData: by full name, or a world club ("City Suffix") by its city.
func kitEntry(name string) (string, bool) {
	if s, ok := kitData[name]; ok {
		return s, true
	}
	if i := strings.LastIndexByte(name, ' '); i > 0 {
		for _, suf := range suffixes {
			if name[i+1:] == suf {
				s, ok := kitData[name[:i]]
				return s, ok
			}
		}
	}
	return "", false
}

// DefaultKits: a club's kits from the data, or made from its two colours.
func DefaultKits(name, color, color2 string) Kits {
	var ks Kits
	parts := []string{}
	if s, ok := kitEntry(name); ok {
		parts = strings.Split(s, "|")
	}
	home, ok := Kit{}, false
	if len(parts) > 0 {
		home, ok = parseKit(parts[0])
	}
	if !ok {
		c, c2 := strings.ToLower(color), strings.ToLower(color2)
		if !hexColour.MatchString(c) {
			c = "#c8202f"
		}
		if !hexColour.MatchString(c2) {
			c2 = "#ffffff"
		}
		home = plainKit(c, c2)
		if luma(c) > 0.62 && luma(c2) < 0.5 {
			home.Shorts = c2 // a white shirt looks best with shorts in the second colour
		}
	}
	ks.Home = home
	if len(parts) > 1 {
		ks.Away, ok = parseKit(parts[1])
	} else {
		ok = false
	}
	if !ok {
		ks.Away = awayFrom(home)
	}
	if len(parts) > 2 {
		ks.Third, ok = parseKit(parts[2])
	} else {
		ok = false
	}
	if !ok {
		ks.Third = thirdFrom(ks.Home, ks.Away)
	}
	return ks
}

// homeColours: a club's two identity colours from its home kit (new careers' generated clubs).
func homeColours(name string) (string, string, bool) {
	s, ok := kitEntry(name)
	if !ok {
		return "", "", false
	}
	k, ok := parseKit(strings.Split(s, "|")[0])
	if !ok {
		return "", "", false
	}
	return k.Shirt, k.Trim, true
}

// ---------------------------------------------------------------- storage

// clubKits: the kits a club wears in this career: the user's own design, or the defaults.
func clubKits(ctx context.Context, q DBTX, careerID int, cl *Club) (Kits, bool, error) {
	var ks Kits
	err := q.QueryRow(ctx, `SELECT kits FROM club_kits WHERE career_id=$1 AND club_id=$2`, careerID, cl.ID).Scan(&ks)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultKits(cl.Name, cl.Color, cl.Color2), false, nil
	}
	if err != nil {
		return Kits{}, false, err
	}
	if !ks.valid() {
		return DefaultKits(cl.Name, cl.Color, cl.Color2), false, nil
	}
	return ks, true, nil
}

// fillKits puts every club's kits on the club (Club.Kits) for the views and the live match.
func fillKits(ctx context.Context, q DBTX, careerID int, clubs ...*Club) error {
	for _, cl := range clubs {
		if cl == nil {
			continue
		}
		ks, _, err := clubKits(ctx, q, careerID, cl)
		if err != nil {
			return err
		}
		cl.Kits = &ks
	}
	return nil
}

// KitPreset: a ready-made design to start from in the kit designer.
type KitPreset struct {
	Key string `json:"key"`
	Kit Kit    `json:"kit"`
}

var kitPresets = func() []KitPreset {
	src := [][2]string{
		{"classic_red", "plain c8102e ffffff ffffff c8102e"}, {"sky", "plain 6cabdd 1c2c5b ffffff 6cabdd"},
		{"zebra", "stripes 111111 ffffff 111111 111111"}, {"rossoneri", "stripes d71920 111111 ffffff 111111"},
		{"nerazzurri", "stripes 0068a8 111111 111111 111111"}, {"celtic", "hoops 018749 ffffff ffffff ffffff"},
		{"sash_river", "sash ffffff d71920 111111 ffffff"}, {"boca_band", "band 103f79 fcd116 103f79 103f79"},
		{"ajax_centre", "centre ffffff d2122e ffffff ffffff"}, {"arsenal_sleeves", "sleeves ef0107 ffffff ffffff ef0107"},
		{"velez_v", "chevron ffffff 1d3f94 1d3f94 ffffff"}, {"halves", "halves 1d3f94 d71920 1d3f94 1d3f94"},
		{"chequers", "quarters 111111 ffffff 111111 111111"}, {"pinstripe_navy", "pinstripes 1b2a4a 6cabdd 1b2a4a 1b2a4a"},
		{"canary", "plain fde100 00843d 00843d fde100"}, {"orange", "plain f68712 111111 111111 f68712"},
		{"violet", "plain 5c2d91 ffffff 5c2d91 5c2d91"}, {"all_black", "plain 111111 d1b26f 111111 111111"},
	}
	out := []KitPreset{}
	for _, s := range src {
		if k, ok := parseKit(s[1]); ok {
			out = append(out, KitPreset{Key: s[0], Kit: k})
		}
	}
	return out
}()

type KitsView struct {
	ClubID   int         `json:"clubId"`
	Name     string      `json:"name"`
	Short    string      `json:"short"`
	Color    string      `json:"color"`
	Color2   string      `json:"color2"`
	Kits     Kits        `json:"kits"`
	Default  Kits        `json:"default"`
	Custom   bool        `json:"custom"`
	Patterns []string    `json:"patterns"`
	Palette  []string    `json:"palette"`
	Presets  []KitPreset `json:"presets"`
	Next     *KitOpp     `json:"next,omitempty"` // the next opponent, for a clash preview
}

type KitOpp struct {
	Name   string `json:"name"`
	Short  string `json:"short"`
	Color  string `json:"color"`
	Color2 string `json:"color2"`
	Kits   Kits   `json:"kits"`
	Home   bool   `json:"home"` // you are the home side
}

func (s *Store) KitsInfo(ctx context.Context, careerID int) (*KitsView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	cl, err := getClub(ctx, s.DB, c.UserClubID)
	if err != nil {
		return nil, err
	}
	ks, custom, err := clubKits(ctx, s.DB, careerID, cl)
	if err != nil {
		return nil, err
	}
	v := &KitsView{ClubID: cl.ID, Name: cl.Name, Short: cl.Short, Color: cl.Color, Color2: cl.Color2, Kits: ks,
		Default: DefaultKits(cl.Name, cl.Color, cl.Color2), Custom: custom, Patterns: KitPatterns, Palette: KitPalette, Presets: kitPresets}
	// the next match, to show which kit each side will wear
	var hid, aid int
	err = s.DB.QueryRow(ctx, `SELECT home_id, away_id FROM fixtures WHERE career_id=$1 AND season=$2 AND NOT played AND (home_id=$3 OR away_id=$3)
		ORDER BY day LIMIT 1`, careerID, c.Season, cl.ID).Scan(&hid, &aid)
	if err == nil {
		oid := hid
		if hid == cl.ID {
			oid = aid
		}
		if opp, err := getClub(ctx, s.DB, oid); err == nil {
			oks, _, err := clubKits(ctx, s.DB, careerID, opp)
			if err != nil {
				return nil, err
			}
			v.Next = &KitOpp{Name: opp.Name, Short: opp.Short, Color: opp.Color, Color2: opp.Color2, Kits: oks, Home: hid == cl.ID}
		}
	}
	return v, nil
}

type KitsReq struct {
	Kits       *Kits `json:"kits"`       // nil: back to the defaults
	ClubColors bool  `json:"clubColors"` // also make the home shirt and trim the club's colours
}

func (s *Store) SaveKits(ctx context.Context, careerID int, req KitsReq) (*KitsView, error) {
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		cl, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		if req.Kits == nil {
			_, err := q.Exec(ctx, `DELETE FROM club_kits WHERE career_id=$1 AND club_id=$2`, careerID, cl.ID)
			return err
		}
		ks := Kits{Home: req.Kits.Home.lower(), Away: req.Kits.Away.lower(), Third: req.Kits.Third.lower()}
		if !ks.valid() {
			return userErr("bad_kit", "That kit is not valid")
		}
		if _, err := q.Exec(ctx, `INSERT INTO club_kits (career_id, club_id, kits) VALUES ($1, $2, $3)
			ON CONFLICT (career_id, club_id) DO UPDATE SET kits=$3`, careerID, cl.ID, ks); err != nil {
			return err
		}
		if req.ClubColors && (cl.Color != ks.Home.Shirt || cl.Color2 != ks.Home.Trim) {
			cl.Color, cl.Color2 = ks.Home.Shirt, ks.Home.Trim
			if colourDist(cl.Color, cl.Color2) < 60 { // the badge needs two colours that show
				cl.Color2 = "#ffffff"
				if luma(cl.Color) > 0.6 {
					cl.Color2 = "#111111"
				}
			}
			return saveClub(ctx, q, cl)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.KitsInfo(ctx, careerID)
}

// ---------------------------------------------------------------- migrations

// KitMigrations: the kits table, and the right colours for clubs whose colours came from the old
// rotating palette (existing careers; the user's own colours are never touched).
func KitMigrations() []string {
	out := []string{`CREATE TABLE IF NOT EXISTS club_kits (
		career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
		club_id   INT NOT NULL,
		kits      JSONB NOT NULL,
		PRIMARY KEY (career_id, club_id))`}
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	// country clubs: their old colours are known from their index in the list
	var rows []string
	for code, names := range countryClubs {
		for i, n := range names {
			c1, c2, ok := homeColours(n)
			if !ok {
				continue
			}
			old := kitColours[(i*5+int(code[0]))%len(kitColours)]
			rows = append(rows, fmt.Sprintf("(%s,%s,%s,%s,%s,%s)", q(code), q(n), q(c1), q(c2), q(old[0]), q(old[1])))
		}
	}
	if len(rows) > 0 {
		out = append(out, `UPDATE clubs c SET color=v.c1, color2=v.c2 FROM (VALUES `+strings.Join(rows, ",")+
			`) AS v(league, name, c1, c2, o1, o2) WHERE c.league=v.league AND c.name=v.name AND c.color=v.o1 AND c.color2=v.o2`)
	}
	// world clubs ("City" or "City Suffix"): their colours were picked at random from the palette
	var pal []string
	for _, k := range kitColours {
		pal = append(pal, fmt.Sprintf("(%s,%s)", q(k[0]), q(k[1])))
	}
	var sufs []string // "City FC", "City United", … (world clubs' names)
	for _, x := range suffixes {
		sufs = append(sufs, "v.city || "+q(" "+x))
	}
	var wrows []string
	for _, wl := range WorldLeagues {
		for _, city := range wl.Cities {
			c1, c2, ok := homeColours(city)
			if !ok {
				continue
			}
			wrows = append(wrows, fmt.Sprintf("(%s,%s,%s,%s)", q(wl.Code), q(city), q(c1), q(c2)))
		}
	}
	if len(wrows) > 0 {
		out = append(out, `UPDATE clubs c SET color=v.c1, color2=v.c2 FROM (VALUES `+strings.Join(wrows, ",")+
			`) AS v(league, city, c1, c2) WHERE c.league=v.league AND (c.name=v.city OR c.name IN (`+strings.Join(sufs, ",")+`)) AND (c.color, c.color2) IN (`+
			strings.Join(pal, ",")+`)`)
	}
	return out
}
