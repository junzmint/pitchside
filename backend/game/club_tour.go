package game

import (
	"context"
	"math"
	"math/rand"
)

// ---------------------------------------------------------------- the pre-season tour
//
// Once every summer the club can pick one of three trips. Nothing is forced: skip it and nothing
// happens. Money, fans, morale and chemistry are settled when you choose; tired legs, extra shirt
// sales, quicker recovery and fewer injuries belong to the first weeks of the new season.

const (
	TourFarDays  = 10 // matchdays of extra shirt sales after a tour abroad
	TourCampDays = 8  // matchdays of quicker recovery and fewer injuries after a training camp
)

type TourState struct {
	Season    int         `json:"season"` // the season that has just ended (the offers are for its summer)
	Offers    []TourOffer `json:"offers"`
	Chosen    string      `json:"chosen,omitempty"`
	EffSeason int         `json:"effSeason,omitempty"` // the season the lasting effects belong to
	Until     int         `json:"until,omitempty"`     // last matchday of the lasting effects
	Applied   bool        `json:"applied,omitempty"`   // season-start effects done
	Saved     int         `json:"saved,omitempty"`     // injuries the camp shrugged off
}

// TourOffer: one card. Money is paid to you (or, when negative, by you) when you choose it.
type TourOffer struct {
	Key     string `json:"key"`   // far | local | camp
	Place   string `json:"place"` // far: asia | america | nordic (by the club's size)
	Money   int64  `json:"money"`
	Fans    int    `json:"fans"`    // fans' mood
	Morale  int    `json:"morale"`  // every player's morale
	Chem    int    `json:"chem"`    // weeks of formation familiarity (chemistry)
	Tired   int    `json:"tired"`   // fitness the squad starts the season with (0: fresh)
	Merch   int    `json:"merch"`   // % extra shirt sales, for Days matchdays
	Recover int    `json:"recover"` // extra fitness after every matchday, for Days matchdays
	Shield  int    `json:"shield"`  // % of injuries shrugged off, for Days matchdays
	Days    int    `json:"days"`    // how many matchdays of the new season the lasting effects run
}

// tourOffers: a trip abroad (bigger clubs travel further and earn more), a tour of the region and
// a mountain training camp.
func tourOffers(user *Club) []TourOffer {
	rep := float64(user.Reputation)
	place, mul := "nordic", 0.8
	switch {
	case user.Reputation >= 74:
		place, mul = "asia", 1
	case user.Reputation >= 60:
		place, mul = "america", 0.9
	}
	return []TourOffer{
		{Key: "far", Place: place, Money: roundK(rep * rep * 480 * mul), Tired: 80, Merch: 15, Days: TourFarDays},
		{Key: "local", Money: roundK(rep * 11_000), Fans: 8, Morale: 5, Chem: 4},
		{Key: "camp", Money: -roundK(rep * 28_000), Morale: 4, Recover: 5, Shield: 50, Days: TourCampDays},
	}
}

// offerTours: the three cards arrive when the season ends.
func (w *world) offerTours(life *ClubLife, rep *DayReport) {
	c := w.career
	if t := life.Tour; t != nil && t.Season == c.Season {
		return
	}
	life.Tour = &TourState{Season: c.Season, Offers: tourOffers(w.byID[c.UserClubID])}
	ev := ComEvent{Key: "tour_offers"}
	rep.Happenings = append(rep.Happenings, ev)
	w.logHappening(ev)
}

func (t *TourState) offer(key string) *TourOffer {
	for i := range t.Offers {
		if t.Offers[i].Key == key {
			return &t.Offers[i]
		}
	}
	return nil
}

// chooseTour settles the immediate part of a tour: money, fans, morale and chemistry.
func (w *world) chooseTour(ctx context.Context, q DBTX, life *ClubLife, squad []*Player, key string) ([]*Player, int64, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	if c.Day <= len(Calendar) {
		return nil, 0, userErr("tour_closed", "Tours are picked in the off-season")
	}
	if life.Tour == nil || life.Tour.Season != c.Season { // a save whose season ended before tours existed
		life.Tour = &TourState{Season: c.Season, Offers: tourOffers(user)}
	}
	t := life.Tour
	if t.Chosen != "" {
		return nil, 0, userErr("tour_done", "You have already picked this summer's tour")
	}
	o := t.offer(key)
	if o == nil {
		return nil, 0, userErr("bad_tour", "Unknown tour")
	}
	if o.Money < 0 && user.Budget < -o.Money {
		return nil, 0, userErr("no_budget", "Not enough budget")
	}
	t.Chosen = key
	user.Budget += o.Money
	kind := "tour"
	if o.Money < 0 {
		kind = "tour_cost"
	}
	if err := addFinance(ctx, q, c, kind, o.Money, key); err != nil {
		return nil, 0, err
	}
	if o.Fans != 0 {
		fs := &life.Fans
		fs.Mood = clamp(fs.Mood+float64(o.Fans), 0, 100)
		fs.Delta = o.Fans
		fs.Notes = []FanNote{{Key: "tour_local", V: float64(o.Fans)}}
		fs.Voice = FanVoice{Style: "banner", Key: "tour_local", Seed: c.Season*100 + c.Day}
	}
	if o.Morale != 0 {
		for _, p := range squad {
			p.Morale = clamp(p.Morale+float64(o.Morale), 20, 100)
		}
	}
	if o.Chem != 0 {
		user.FormWeeks += o.Chem
	}
	w.logHappening(ComEvent{Key: "tour_" + key, Name: o.Place, Amount: o.Money})
	return squad, o.Money, nil
}

// tourSeasonStart: a long trip leaves tired legs; the lasting effects start counting.
func (w *world) tourSeasonStart(life *ClubLife, squad []*Player) []*Player {
	c := w.career
	t := life.Tour
	if t == nil || t.Chosen == "" || t.Applied || t.Season != c.Season-1 {
		return nil
	}
	t.Applied, t.EffSeason = true, c.Season
	o := t.offer(t.Chosen)
	if o == nil {
		return nil
	}
	t.Until = o.Days
	if o.Tired <= 0 {
		return nil
	}
	for _, p := range squad {
		p.Fitness = math.Min(p.Fitness, float64(o.Tired))
	}
	return squad
}

func (life *ClubLife) tourActive(c *Career, day int) *TourOffer {
	t := life.Tour
	if t == nil || !t.Applied || t.EffSeason != c.Season || day > t.Until {
		return nil
	}
	return t.offer(t.Chosen)
}

// tourMerch: foreign fans buy shirts in the first weeks after a tour abroad.
func (life *ClubLife) tourMerch(c *Career) float64 {
	if o := life.tourActive(c, c.Day); o != nil && o.Merch > 0 {
		return 1 + float64(o.Merch)/100
	}
	return 1
}

// tourLasting: after a training camp the squad recovers faster and shrugs off half its injuries.
func (w *world) tourLasting(r *rand.Rand, life *ClubLife, squad []*Player, rep *DayReport, injuredToday map[int]bool) []*Player {
	c := w.career
	o := life.tourActive(c, rep.Day)
	if o == nil || rep.Day > len(Calendar) {
		return nil
	}
	var changed []*Player
	if o.Recover > 0 {
		for _, p := range squad {
			if p.Injury == 0 && p.Fitness < 100 {
				p.Fitness = math.Min(100, p.Fitness+float64(o.Recover))
				changed = append(changed, p)
			}
		}
	}
	if o.Shield > 0 {
		for _, p := range squad {
			if !injuredToday[p.ID] || p.Injury == 0 || r.Intn(100) >= o.Shield {
				continue
			}
			p.Injury = 0
			changed = append(changed, p)
			life.Tour.Saved++
			keep := rep.Injuries[:0]
			for _, in := range rep.Injuries {
				if in.Name != p.Name {
					keep = append(keep, in)
				}
			}
			rep.Injuries = keep
			rep.Happenings = append(rep.Happenings, ComEvent{Key: "camp_shield", Name: p.Name})
		}
	}
	return changed
}

// ---------------------------------------------------------------- view

type TourView struct {
	Season int         `json:"season"`
	Offers []TourOffer `json:"offers"`
	Chosen string      `json:"chosen"`
	Open   bool        `json:"open"`   // the off-season: pick now
	Active bool        `json:"active"` // the lasting effects are running
	Until  int         `json:"until"`
	Saved  int         `json:"saved"`
}

func tourView(c *Career, user *Club, life *ClubLife) *TourView {
	t := life.Tour
	if c.Day > len(Calendar) {
		if t != nil && t.Season == c.Season {
			return &TourView{Season: t.Season, Offers: t.Offers, Chosen: t.Chosen, Open: true}
		}
		// a save whose season ended before tours existed
		return &TourView{Season: c.Season, Offers: tourOffers(user), Open: true}
	}
	if t == nil {
		return nil
	}
	if o := life.tourActive(c, c.Day); o != nil {
		return &TourView{Season: t.Season, Offers: t.Offers, Chosen: t.Chosen, Active: true, Until: t.Until, Saved: t.Saved}
	}
	return nil
}
