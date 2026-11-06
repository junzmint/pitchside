package game

import (
	"context"
	"math/rand"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// noReads: a staff run's database in a test: writes go through, nothing is read.
type noReads struct{}

func (noReads) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (noReads) Query(context.Context, string, ...any) (pgx.Rows, error) { panic("no reads here") }
func (noReads) QueryRow(context.Context, string, ...any) pgx.Row        { panic("no reads here") }

func growthRun() *staffRun {
	w := &world{career: &Career{Season: 1, Day: 10}, crew: &StaffState{base: map[int]int{}, People: map[int]*CoachLife{}}}
	return w.staffRun(context.Background(), noReads{}, rand.New(rand.NewSource(1)), nil)
}

// coachSeason: a good season's experience for one coach, as daily and seasonEnd hand it out (a win on three
// matchdays in five, a cup game now and then, 8 at the end); his skill when it is over.
func coachSeason(t *testing.T, sr *staffRun, co *Coach, l *CoachLife) int {
	t.Helper()
	for d := 0; d < 54; d++ {
		xp := 1
		if d%5 < 3 {
			xp++
		}
		if d%9 == 0 {
			xp++
		}
		if err := sr.gainXP(co, l, xp); err != nil {
			t.Fatal(err)
		}
	}
	if err := sr.gainXP(co, l, 8); err != nil {
		t.Fatal(err)
	}
	return sr.st.baseSkill(co)
}

// seasonsTo: seasons until a head coach of 56 at his peak of 18 reaches 20, with an advanced course at the
// start of each season he can take one (as StaffAction runs it) or never.
func seasonsTo(t *testing.T, courses bool) int {
	sr := growthRun()
	co := &Coach{ID: 7, Name: "Carlo Ancelotto", Role: "head", Skill: 18}
	l := &CoachLife{Age: 56, Ceil: 18}
	for s := 1; s <= 40; s++ {
		sr.w.career.Season = s
		base := sr.st.baseSkill(co)
		if courses && courseState(base, l, s) == "open" {
			l.Ceil, l.Course = courseCeil(base, l), s
			if err := sr.gainXP(co, l, 0); err != nil {
				t.Fatal(err)
			}
		}
		if coachSeason(t, sr, co, l) >= MaxCoachSkill {
			if l.XP != 0 || l.Ceil != MaxCoachSkill {
				t.Errorf("at the top: xp %d, ceiling %d", l.XP, l.Ceil)
			}
			return s
		}
		if l.Ceil < sr.st.baseSkill(co) {
			t.Fatalf("season %d: his ceiling %d fell behind his skill %d", s, l.Ceil, sr.st.baseSkill(co))
		}
	}
	return 99
}

// The report that started it: a coach at his peak could not go on (all his experience was thrown away). Now
// the peak is a guide: he still grows, three times more slowly, and an advanced course a season gets him to the
// top of the scale far sooner. Nobody goes past 20.
func TestCoachPastPeak(t *testing.T) {
	slow, fast := seasonsTo(t, false), seasonsTo(t, true)
	t.Logf("Ancelotto, 56, at his peak of 18 → 20: %d seasons on experience alone, %d with a course a season", slow, fast)
	if slow < 7 || slow > 14 {
		t.Errorf("experience alone: %d seasons to 20, want slow but within reach (7–14)", slow)
	}
	if fast > 4 {
		t.Errorf("with courses: %d seasons to 20, want 4 at most", fast)
	}
	// below his ceiling a point costs the usual experience, at or past it three times as much
	if coachXPNeed(12, 15) != xpNeed(12) || coachXPNeed(15, 15) != 3*xpNeed(15) {
		t.Errorf("experience for a point: %d below his ceiling, %d at it", coachXPNeed(12, 15), coachXPNeed(15, 15))
	}
	// experience at the peak is kept, not thrown away
	sr := growthRun()
	co := &Coach{ID: 8, Name: "Peaked", Role: "attack", Skill: 14}
	l := &CoachLife{Age: 58, Ceil: 14}
	if err := sr.gainXP(co, l, 30); err != nil || l.XP != 30 {
		t.Errorf("at his peak: xp %d after 30 (%v)", l.XP, err)
	}
}

// When a course is offered: at his ceiling or one point below it, once a season, never with a ceiling of 20
// already; a coach under 50 gains two points of ceiling, an older one one.
func TestCoachCourse(t *testing.T) {
	for _, c := range []struct {
		skill, ceil, course, season int
		want                        string
	}{
		{18, 18, 0, 2, "open"},
		{17, 18, 0, 2, "open"},
		{16, 18, 0, 2, ""}, // room to grow on his own
		{18, 18, 2, 2, "done"},
		{18, 18, 1, 2, "open"}, // last season's course
		{19, 20, 0, 2, ""},     // his ceiling is the top already
		{20, 20, 0, 2, ""},
		{15, 12, 0, 2, "open"}, // an old save's ceiling below his skill
	} {
		l := &CoachLife{Ceil: c.ceil, Course: c.course}
		if got := courseState(c.skill, l, c.season); got != c.want {
			t.Errorf("skill %d, ceiling %d, course in season %d, now season %d: %q, want %q", c.skill, c.ceil, c.course, c.season, got, c.want)
		}
	}
	if courseCeil(18, &CoachLife{Age: 56, Ceil: 18}) != 19 || courseCeil(14, &CoachLife{Age: 41, Ceil: 14}) != 16 ||
		courseCeil(19, &CoachLife{Age: 40, Ceil: 19}) != 20 || courseCeil(15, &CoachLife{Age: 55, Ceil: 12}) != 16 {
		t.Errorf("course ceilings: %d %d %d %d", courseCeil(18, &CoachLife{Age: 56, Ceil: 18}), courseCeil(14, &CoachLife{Age: 41, Ceil: 14}),
			courseCeil(19, &CoachLife{Age: 40, Ceil: 19}), courseCeil(15, &CoachLife{Age: 55, Ceil: 12}))
	}
	co := &Coach{Skill: 18}
	co.Fill()
	if got := courseCost(co); got != roundK(float64(co.Wage)*CourseWeeks) || got <= roundK(float64(co.Wage)*StaffBonusWeeks) {
		t.Errorf("a course costs %d (wage %d): twelve weeks, more than a bonus", got, co.Wage)
	}
}
