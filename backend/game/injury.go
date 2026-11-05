package game

import (
	"math"
	"math/rand"
)

// ---------------------------------------------------------------- injuries
//
// Every injury in the game goes through these functions: a knock in a match, a knock in training
// and the weekly recovery. The kind of injury (injury_kinds.go) decides how long and how bad; what
// it leaves behind is settled by the medical department (medical.go) at the end of the matchday.

// matchInjury: does this player get hurt in the match? Sets p.Injury and returns true when he does.
// share is the part of the 90 minutes he was on the pitch.
func (w *world) matchInjury(r *rand.Rand, p *Player, sh TeamSheet, f *Fixture, congested bool, share float64, physio int) bool {
	md := w.medState()
	rec := md.P[p.ID]
	if rec != nil && rec.Rust > 0 { // minutes on the pitch bring the sharpness back
		rec.Rust = math.Max(0, rec.Rust-RustPerMatch*share)
		p.Rust = rec.Rust
	}
	// injury risk grows as players tire, with fewer minutes on the pitch and with a midweek game
	risk := 0.01 + math.Max(0, 68-p.Fitness)*0.003
	if sh.Club.Tactic.Pressing == "high" {
		risk += 0.005
	}
	if congested {
		risk += MidweekInjury
	}
	risk *= bodyRisk(p, rec) // injury-prone, worn, fragile after an injury, hiding a knock
	risk *= 0.3 + 0.7*share
	if p.Rushed {
		risk += RushInjury
	}
	risk *= staffRisk(physio, coachSkill(w.coaches[sh.Club.ID], "fitness"), sh.Club.Medical, sh.Perks) * InjuryRate
	hid := rec != nil && rec.Knock > 0
	if hid {
		if rec.Knock--; rec.Knock == 0 {
			rec.Seen = false
		}
	}
	if r.Float64() >= risk {
		return false
	}
	k := pickKind(r, p, rec, false)
	if p.Rushed && rec != nil && isRealInjury(rec.Kind) {
		k = injuryKind(rec.Kind) // rushed back too soon: the same injury again, and worse
	}
	weeks := rollWeeks(r, k, physio, sh.Club.Medical)
	if p.Rushed {
		weeks += 2
	}
	p.Injury = weeks
	md.fresh[p.ID] = freshInj{Kind: k.Key, Club: sh.Club.ID, Source: "match", Rushed: p.Rushed, Knock: hid}
	return true
}

// bodyRisk: how much likelier this player is to get hurt than a fresh, sound one.
func bodyRisk(p *Player, rec *MedRec) float64 {
	m := 1.0
	if hasTrait(p, "injury_prone") {
		m *= 1.8
	}
	if rec != nil {
		m *= 1 + WearRisk*rec.Wear
		if rec.Frag > 0 && rec.FragK != "" {
			m *= math.Max(1, injuryKind(rec.FragK).ReRisk)
		}
		if rec.Knock > 0 {
			m *= KnockRisk
		}
	}
	return m
}

// knownBodyRisk: bodyRisk as the club's doctor sees it: a hidden knock he has not spotted and an
// injury-prone body nobody has found out about yet do not count.
func (w *world) knownBodyRisk(p *Player, rec *MedRec) float64 {
	m := 1.0
	if w.knownProne(p, rec) {
		m *= 1.8
	}
	if rec != nil {
		m *= 1 + WearRisk*rec.Wear
		if rec.Frag > 0 && rec.FragK != "" {
			m *= math.Max(1, injuryKind(rec.FragK).ReRisk)
		}
		if rec.Knock > 0 && rec.Seen {
			m *= KnockRisk
		}
	}
	return m
}

// knownProne: the user knows the player is injury-prone (his traits are visible, or injuries wore
// him down to it under the medical department's eyes).
func (w *world) knownProne(p *Player, rec *MedRec) bool {
	if !hasTrait(p, "injury_prone") {
		return false
	}
	return (rec != nil && rec.WearLv >= 2) || visibleTraits(p, w.career.UserClubID, w.scoutSkillMem())
}

// scoutSkillMem: the user's scouting skill from the loaded staff (as userScoutSkill, without a query).
func (w *world) scoutSkillMem() int {
	s := 0
	for _, c := range w.coaches[w.career.UserClubID] {
		if c.Role != "scout" {
			continue
		}
		v := c.Skill
		for _, pk := range c.Perks {
			if pk == "talent_eye" {
				v += 5
			}
		}
		s = max(s, v)
	}
	return s
}

// trainBodyRisk: in training only body wear, a fragile spell and a hidden knock count (an
// injury-prone player is a risk in matches).
func trainBodyRisk(p *Player, rec *MedRec) float64 {
	if rec == nil {
		return 1
	}
	m := 1 + WearRisk*rec.Wear
	if rec.Frag > 0 && rec.FragK != "" {
		m *= math.Max(1, injuryKind(rec.FragK).ReRisk)
	}
	if rec.Knock > 0 {
		m *= KnockRisk
	}
	return m
}

// staffRisk: what the physio, the fitness coach, the medical centre and the staff's specialities
// take off the injury risk.
func staffRisk(physio, fitness, medLvl int, ps Perks) float64 {
	return (1 - float64(min(20, physio))*0.025) * (1 - float64(min(20, fitness))*0.008) * medicalRisk(medLvl) * perkInjury(ps)
}

// healDay: one week of recovery for an injured player (not on the day he got hurt); for a fit one,
// a week of training that brings back sharpness and lets the body shed wear.
func (w *world) healDay(r *rand.Rand, p *Player, clubID int, ps Perks, injuredToday map[int]bool) {
	md := w.medState()
	rec := md.P[p.ID]
	if p.Injury <= 0 {
		if rec != nil {
			rec.fitWeek(coachSkill(w.coaches[clubID], "fitness"))
			p.Rust = rec.Rust
		}
		return
	}
	if injuredToday[p.ID] {
		return
	}
	lvl := 1
	if cl := w.byID[clubID]; cl != nil {
		lvl = cl.Medical
	}
	if rec != nil {
		rec.shedWear()
		// a setback in rehab (never in the last week)
		if k := injuryKind(rec.Kind); isRealInjury(rec.Kind) && k.Setback > 0 && p.Injury > 1 {
			physio := coachSkill(w.coaches[clubID], "physio")
			ch := k.Setback * treatmentOf(rec.Treat).Setback * (1 - 0.03*float64(min(20, physio))) * rehabPool(lvl)
			if r.Float64() < ch {
				f := 0.25
				if k.Tier >= 4 {
					f = 0.15
				}
				add := max(1, int(math.Round(k.avgWeeks()*f)))
				p.Injury += add
				rec.Total += add
				rec.Dmg = math.Max(1, rec.Dmg) * 1.15
				md.Stats.Setbacks++
				md.note(clubID, MedLine{Key: "setback", PlayerID: p.ID, Name: p.Name, Kind: rec.shown(), N: add})
				return
			}
		}
	}
	p.Injury--
	// a better medical centre gets players back sooner
	if p.Injury > 0 && lvl > 1 && r.Float64() < 0.1*float64(lvl-1) {
		p.Injury--
	}
	if p.Injury > 0 && ps["quick_heal"] && r.Float64() < 0.25 {
		p.Injury--
	}
	// a wrong diagnosis catches up with him on his first day back in training
	if p.Injury == 0 && rec != nil && rec.Hide > 0 {
		add := rec.Hide + 1
		p.Injury = add
		rec.Total += add
		rec.Hide = 0
		rec.Dmg = math.Max(1, rec.Dmg) * 1.2
		md.note(clubID, MedLine{Key: "misdiag", PlayerID: p.ID, Name: p.Name, Kind: rec.Kind, Was: rec.Diag, N: add})
		rec.Diag = ""
	}
}

// rehabPool: from level 4 the medical centre's rehab pool cuts setbacks.
func rehabPool(lvl int) float64 {
	if lvl >= 4 {
		return 0.6
	}
	return 1
}

// trainingKnock: hard sessions on tired legs (the user's club only).
func (w *world) trainingKnock(r *rand.Rand, p *Player, clubID int, load string, ps Perks, injuredToday map[int]bool, rep *DayReport) {
	if p.Injury != 0 || load == "rest" {
		return
	}
	md := w.medState()
	rec := md.P[p.ID]
	lvl := 1
	if cl := w.byID[clubID]; cl != nil {
		lvl = cl.Medical
	}
	risk := trainRisk[load] + math.Max(0, 55-p.Fitness)*0.002
	risk *= trainBodyRisk(p, rec) * medicalRisk(lvl) * perkInjury(ps) * InjuryRate
	if r.Float64() >= risk {
		return
	}
	k := pickKind(r, p, rec, true)
	p.Injury = rollWeeks(r, k, coachSkill(w.coaches[clubID], "physio"), lvl)
	injuredToday[p.ID] = true
	md.fresh[p.ID] = freshInj{Kind: k.Key, Club: clubID, Source: "training"}
	rep.Injuries = append(rep.Injuries, InjuryNote{PlayerID: p.ID, Name: p.Name, Weeks: p.Injury, Kind: k.Key, Tier: k.Tier})
}
