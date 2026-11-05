package game

import (
	"context"
	"math/rand"
)

// ---------------------------------------------------------------- discovery
// Owned by the "explore" work stream: scouting missions, hidden gems, achievements, the trophy
// room, manager job offers and other things to discover.
//
//   explore_missions.go  scouting missions, the discovery log, golden events
//   explore_ach.go       achievements, counters, rewards and titles
//   explore_career.go    manager reputation, job offers, moving to another club
//   explore_museum.go    the full Explore view: trophy room, records, hall of fame, legend album

// ExploreState is stored on the career (careers.explore, JSONB).
type ExploreState struct {
	Init      bool                 `json:"init"`
	NextID    int                  `json:"nextId"`
	Missions  []Mission            `json:"missions"` // out in the field, then the latest reports
	Finds     []Find               `json:"finds"`    // the discovery log, newest first
	Regions   map[string]int       `json:"regions"`  // region → missions sent there
	Ach       map[string]*AchState `json:"ach"`      // unlocked achievements
	Stats     map[string]int       `json:"stats"`    // counters behind the achievements (see explore_ach.go)
	Run       RunState             `json:"run"`
	Records   Records              `json:"records"`
	Title     string               `json:"title"`      // equipped cosmetic title (an achievement key)
	Album     map[string]int       `json:"album"`      // legend card "Name|Version" → season first owned
	Youth     map[int]int          `json:"youthStart"` // teenagers at your club → overall when first seen
	Manager   Manager              `json:"manager"`
	Feed      []FeedItem           `json:"feed"` // recent discoveries, newest first
	Golden    map[int]int          `json:"golden"`
	CelebID   int                  `json:"celebId"`
	Celebrate []Celebration        `json:"celebrate"` // titles waiting for their congratulations pop-up
	Trophies  []Celebration        `json:"trophies"`  // every title won, with the story of the day
}

// RunState: running streaks and this season's tallies.
type RunState struct {
	Season   int  `json:"season"`
	Streak   int  `json:"streak"`   // competitive wins in a row
	Unbeaten int  `json:"unbeaten"` // competitive games without defeat
	Goals    int  `json:"goals"`    // goals this season (all competitions)
	Clean    int  `json:"clean"`    // clean sheets this season
	InDebt   bool `json:"inDebt"`
	LastFx   int  `json:"lastFx"` // the last fixture counted (a day can't be counted twice)
}

type MatchRec struct {
	GF     int    `json:"gf"`
	GA     int    `json:"ga"`
	Opp    string `json:"opp"`
	Club   string `json:"club"`
	Season int    `json:"season"`
	Comp   string `json:"comp"`
}

type Records struct {
	BigWin   *MatchRec `json:"bigWin"`
	BigLoss  *MatchRec `json:"bigLoss"`
	MostGoal *MatchRec `json:"mostGoals"`
	Haul     *HaulRec  `json:"haul"` // most goals by one player in a match
	BestOvr  *HaulRec  `json:"bestOvr"`
}

type HaulRec struct {
	Name   string `json:"name"`
	N      int    `json:"n"`
	Season int    `json:"season"`
}

type FeedItem struct {
	ComEvent
	Season int    `json:"season"`
	Day    int    `json:"day"`
	Rarity string `json:"rarity,omitempty"`
}

func (e *ExploreState) ensure() {
	if e.Regions == nil {
		e.Regions = map[string]int{}
	}
	if e.Ach == nil {
		e.Ach = map[string]*AchState{}
	}
	if e.Stats == nil {
		e.Stats = map[string]int{}
	}
	if e.Album == nil {
		e.Album = map[string]int{}
	}
	if e.Youth == nil {
		e.Youth = map[int]int{}
	}
	if e.Golden == nil {
		e.Golden = map[int]int{}
	}
}

// say adds a line to the day report and the Explore feed.
func (w *world) say(rep *DayReport, key, name string, amount int64, rarity string) {
	ev := ComEvent{Key: key, Name: name, Amount: amount}
	if rep != nil {
		rep.Discoveries = append(rep.Discoveries, ev)
	}
	x := &w.career.Explore
	day := w.career.Day
	x.Feed = append([]FeedItem{{ComEvent: ev, Season: w.career.Season, Day: day, Rarity: rarity}}, x.Feed...)
	if len(x.Feed) > 40 {
		x.Feed = x.Feed[:40]
	}
}

// exploreTick runs once per matchday after eventsTick.
func (w *world) exploreTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	x := &w.career.Explore
	x.ensure()
	if !x.Init {
		if err := w.exploreInit(ctx, q, 0); err != nil {
			return err
		}
	}
	if x.Run.Season != w.career.Season {
		x.Run = RunState{Season: w.career.Season, Streak: x.Run.Streak, Unbeaten: x.Run.Unbeaten, InDebt: x.Run.InDebt, LastFx: x.Run.LastFx}
	}
	w.trackMatch(rep)
	w.celebrateFinals(rep)
	w.trackSquad()
	if err := w.missionsTick(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.goldenTick(ctx, q, r, rep); err != nil {
		return err
	}
	w.career.Explore.Manager.Offers = nil // careers never change clubs (older saves may still hold offers)
	return w.unlock(rep)
}

// exploreSeasonEnd runs inside finishSeason after eventsSeasonEnd.
func (w *world) exploreSeasonEnd(ctx context.Context, q DBTX, r *rand.Rand, se *SeasonEnd, rep *DayReport) error {
	x := &w.career.Explore
	x.ensure()
	if !x.Init {
		if err := w.exploreInit(ctx, q, se.Season); err != nil {
			return err
		}
	}
	w.trackSeason(se)
	w.celebrateFinals(rep) // the continental final is the season's last matchday: celebrate it before the league
	w.celebrateSeason(se)
	w.managerSeason(se)
	return w.unlock(rep)
}

// ExploreBadge is what the career state carries for the menu badge and the overview.
type ExploreBadge struct {
	Count     int           `json:"count"`     // things waiting: rewards, new reports, job offers
	Unclaimed int           `json:"unclaimed"` // achievements to collect
	Reports   int           `json:"reports"`   // missions back with unread reports
	Out       int           `json:"out"`       // missions in the field
	Offers    int           `json:"offers"`    // job offers
	Title     string        `json:"title"`
	Rep       float64       `json:"rep"`       // manager reputation 0..100
	Tier      string        `json:"tier"`      // manager tier
	Celebrate []Celebration `json:"celebrate"` // pending congratulations (oldest first)
}

// exploreView is sent with the career state (CareerState.exploreView).
func (w *world) exploreView() any {
	x := &w.career.Explore
	b := ExploreBadge{Title: x.Title, Rep: round1(x.Manager.Rep), Tier: managerTier(x.Manager.Rep), Celebrate: x.Celebrate}
	if b.Celebrate == nil {
		b.Celebrate = []Celebration{}
	}
	if !x.Init {
		b.Rep = round1(startRep(w.byID[w.career.UserClubID]))
		b.Tier = managerTier(b.Rep)
	}
	for _, a := range x.Ach {
		if !a.Claimed {
			b.Unclaimed++
		}
	}
	for _, m := range x.Missions {
		if m.Left > 0 {
			b.Out++
		} else if !m.Seen {
			b.Reports++
		}
	}
	now := w.career.now()
	for _, o := range x.Manager.Offers {
		if o.Until >= now {
			b.Offers++
		}
	}
	b.Count = b.Unclaimed + b.Reports + b.Offers
	return b
}
