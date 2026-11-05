package game

import (
	"math"
	"math/rand"
)

// ---------------------------------------------------------------- the injury catalogue (medical work stream)
//
// Every injury has a kind. The kind decides how long a player is out, how likely he is to break
// down again while he recovers and after his return, how much wear it leaves on his body and what
// it can cost him for good. Four tiers: 1 light · 2 medium · 3 serious · 4 career-threatening.
// The UI mirrors the body part and tier in frontend/src/pages/medical/kinds.ts.

// AttrLoss: lasting damage to one attribute, Lo..Hi points.
type AttrLoss struct {
	Attr string `json:"attr"`
	Lo   int    `json:"lo"`
	Hi   int    `json:"hi"`
}

type InjuryKind struct {
	Key      string
	Part     string // body part on the silhouette
	Tier     int    // 0: not an injury (the staff keep a fit player out on purpose)
	Min, Max int    // weeks out before treatment
	Match    float64
	Train    float64 // how often it happens in a match / in training (relative)
	Muscle   bool    // a muscle injury: tired legs make it likelier
	GK       float64 // frequency multiplier for goalkeepers
	Setback  float64 // chance per week of a setback during rehab
	Frag     int     // matchdays of raised re-injury risk after he is back
	ReRisk   float64 // injury risk multiplier during those matchdays
	Wear     float64 // body wear the injury leaves
	Dmg      float64 // chance of lasting damage (before treatment, staff and age)
	Loss     []AttrLoss
	Pot      [2]int // lasting damage to his ceiling (potential), lo..hi
	GKLoss   bool   // the lasting damage only hits goalkeepers (shoulder, fingers)
	Mis      string // what a doctor can mistake it for
	Escalate string // a re-injury during the fragile spell can turn into this
}

var Injuries = []*InjuryKind{
	// light: a week or two
	{Key: "knock", Part: "thigh", Tier: 1, Min: 1, Max: 1, Match: 20, Train: 4, GK: 1, Wear: 0.5},
	{Key: "ankle_sprain", Part: "ankle", Tier: 1, Min: 1, Max: 2, Match: 12, Train: 6, GK: 0.7, Setback: 0.03, Frag: 4, ReRisk: 1.5, Wear: 1, Escalate: "ankle_lig"},
	{Key: "calf", Part: "calf", Tier: 1, Min: 1, Max: 2, Match: 7, Train: 8, Muscle: true, GK: 0.6, Setback: 0.04, Frag: 4, ReRisk: 1.6, Wear: 1},
	{Key: "back", Part: "back", Tier: 1, Min: 1, Max: 2, Match: 3, Train: 7, Muscle: true, GK: 1.2, Setback: 0.03, Frag: 3, ReRisk: 1.3, Wear: 1},
	{Key: "concussion", Part: "head", Tier: 1, Min: 1, Max: 1, Match: 4, Train: 0.2, GK: 1.6, Frag: 6, ReRisk: 1.2, Wear: 1},
	{Key: "finger", Part: "hand", Tier: 1, Min: 1, Max: 2, Match: 0.8, Train: 1, GK: 14, Setback: 0.02, Frag: 3, ReRisk: 1.3, Wear: 0.5,
		Dmg: 0.12, Loss: []AttrLoss{{"goalkeeping", 1, 1}}, GKLoss: true},
	// medium: a few weeks
	{Key: "hamstring", Part: "hamstring", Tier: 2, Min: 2, Max: 5, Match: 12, Train: 7, Muscle: true, GK: 0.3, Setback: 0.06, Frag: 8, ReRisk: 2.2, Wear: 2,
		Dmg: 0.08, Loss: []AttrLoss{{"pace", 1, 2}}, Mis: "knock"},
	{Key: "groin", Part: "groin", Tier: 2, Min: 2, Max: 4, Match: 7, Train: 5, Muscle: true, GK: 0.8, Setback: 0.05, Frag: 5, ReRisk: 1.7, Wear: 2,
		Dmg: 0.04, Loss: []AttrLoss{{"pace", 1, 1}}, Escalate: "pubalgia"},
	{Key: "mcl", Part: "knee", Tier: 2, Min: 3, Max: 6, Match: 5, Train: 1, GK: 0.8, Setback: 0.04, Frag: 5, ReRisk: 1.6, Wear: 2,
		Dmg: 0.1, Loss: []AttrLoss{{"pace", 1, 1}, {"physical", 0, 1}}, Escalate: "meniscus"},
	{Key: "shoulder", Part: "shoulder", Tier: 2, Min: 2, Max: 5, Match: 2.5, Train: 0.4, GK: 5, Setback: 0.04, Frag: 5, ReRisk: 1.5, Wear: 1.5,
		Dmg: 0.35, Loss: []AttrLoss{{"goalkeeping", 1, 3}}, GKLoss: true},
	{Key: "rib", Part: "chest", Tier: 2, Min: 2, Max: 3, Match: 3, Train: 0.3, GK: 1.3, Setback: 0.02, Frag: 2, ReRisk: 1.2, Wear: 1, Mis: "knock"},
	// serious: one to three months
	{Key: "meniscus", Part: "knee", Tier: 3, Min: 5, Max: 9, Match: 2.5, Train: 0.6, GK: 0.8, Setback: 0.04, Frag: 6, ReRisk: 1.8, Wear: 3,
		Dmg: 0.35, Loss: []AttrLoss{{"physical", 1, 2}, {"pace", 0, 1}}, Pot: [2]int{0, 2}, Mis: "mcl"},
	{Key: "metatarsal", Part: "foot", Tier: 3, Min: 6, Max: 10, Match: 2, Train: 0.6, GK: 0.5, Setback: 0.03, Frag: 4, ReRisk: 1.5, Wear: 3,
		Dmg: 0.2, Loss: []AttrLoss{{"pace", 1, 1}}, Pot: [2]int{0, 1}, Mis: "knock"},
	{Key: "ankle_lig", Part: "ankle", Tier: 3, Min: 6, Max: 11, Match: 1.6, Train: 0.3, GK: 0.6, Setback: 0.04, Frag: 6, ReRisk: 1.8, Wear: 3,
		Dmg: 0.35, Loss: []AttrLoss{{"pace", 1, 2}, {"dribbling", 1, 2}}, Pot: [2]int{0, 2}, Mis: "ankle_sprain"},
	{Key: "pubalgia", Part: "groin", Tier: 3, Min: 4, Max: 8, Match: 0.8, Train: 1.2, Muscle: true, GK: 0.5, Setback: 0.05, Frag: 6, ReRisk: 1.8, Wear: 3,
		Dmg: 0.25, Loss: []AttrLoss{{"physical", 1, 1}, {"pace", 0, 1}}, Mis: "groin"},
	// career-threatening: most of a season, and he may never be the same
	{Key: "acl", Part: "knee", Tier: 4, Min: 24, Max: 34, Match: 0.45, Train: 0.1, GK: 0.6, Setback: 0.012, Frag: 10, ReRisk: 2, Wear: 4,
		Dmg: 0.85, Loss: []AttrLoss{{"pace", 2, 5}, {"physical", 2, 4}, {"dribbling", 0, 2}}, Pot: [2]int{2, 5}},
	{Key: "achilles", Part: "achilles", Tier: 4, Min: 26, Max: 38, Match: 0.18, Train: 0.12, Muscle: true, GK: 0.5, Setback: 0.012, Frag: 10, ReRisk: 2, Wear: 4,
		Dmg: 0.9, Loss: []AttrLoss{{"pace", 3, 7}, {"physical", 1, 3}}, Pot: [2]int{3, 6}},
	{Key: "broken_leg", Part: "shin", Tier: 4, Min: 18, Max: 28, Match: 0.2, GK: 0.5, Setback: 0.01, Frag: 8, ReRisk: 1.6, Wear: 4,
		Dmg: 0.7, Loss: []AttrLoss{{"physical", 2, 4}, {"pace", 1, 4}}, Pot: [2]int{1, 4}},
	// an illness going round the dressing room (a medical event, never from a tackle)
	{Key: "flu", Part: "body", Tier: 1, Min: 1, Max: 1},
	// not injuries: the medical staff keep a fit player out on purpose
	{Key: "rest", Part: "body", Min: 1, Max: 1},  // a precaution before a risky match
	{Key: "ease", Part: "body", Min: 1, Max: 1},  // one more week of easing back after a long lay-off
	{Key: "rehab", Part: "body", Min: 2, Max: 2}, // a rehabilitation block against body wear
}

var injuryByKey = func() map[string]*InjuryKind {
	m := map[string]*InjuryKind{}
	for _, k := range Injuries {
		m[k.Key] = k
	}
	return m
}()

// injuryKind: the catalogue entry for a key (an unknown one counts as a knock).
func injuryKind(key string) *InjuryKind {
	if k, ok := injuryByKey[key]; ok {
		return k
	}
	return Injuries[0]
}

// avgWeeks: the middle of the kind's usual lay-off.
func (k *InjuryKind) avgWeeks() float64 { return float64(k.Min+k.Max) / 2 }

// pickKind: what kind of injury a player picks up. Tired legs tear muscles, keepers hurt their
// hands and shoulders, older bodies break worse, and a player back from an injury often breaks
// down the same way (sometimes worse) while he is still fragile.
func pickKind(r *rand.Rand, p *Player, rec *MedRec, training bool) *InjuryKind {
	if rec != nil && rec.Frag > 0 && rec.FragK != "" && r.Float64() < 0.5 {
		k := injuryKind(rec.FragK)
		if k.Escalate != "" && r.Float64() < 0.25 {
			return injuryKind(k.Escalate)
		}
		if k.Tier > 0 && k.Key != "flu" {
			return k
		}
	}
	gk := p.Position == "GK"
	tired := clamp((75-p.Fitness)/30, 0, 1.2)
	prone := hasTrait(p, "injury_prone")
	conc := 0
	if rec != nil {
		conc = rec.Conc
	}
	var ws [40]float64
	tot := 0.0
	for i, k := range Injuries {
		if i >= len(ws) {
			break
		}
		w := k.Match
		if training {
			w = k.Train
		}
		if w <= 0 || k.Tier == 0 || k.Key == "flu" {
			continue
		}
		if gk {
			w *= k.GK
		}
		if k.Muscle {
			w *= 1 + tired
			if prone {
				w *= 1.3
			}
		}
		if k.Key == "concussion" {
			w *= 1 + 0.6*float64(conc)
		}
		if k.Tier >= 3 && p.Age >= 30 && !isLegend(p) {
			w *= 1 + 0.08*float64(p.Age-29)
		}
		ws[i] = w
		tot += w
	}
	x := r.Float64() * tot
	for i, k := range Injuries {
		if i >= len(ws) || ws[i] <= 0 {
			continue
		}
		x -= ws[i]
		if x <= 0 {
			return k
		}
	}
	return Injuries[0]
}

// rollWeeks: the lay-off for an injury of this kind, before treatment. Shorter ones are a little
// likelier; a good physio and (from level 3) the medical centre get the player back sooner.
func rollWeeks(r *rand.Rand, k *InjuryKind, physio, medLvl int) int {
	w := float64(k.Min)
	if span := k.Max - k.Min; span > 0 {
		w += math.Floor(float64(span+1) * math.Pow(r.Float64(), 1.25))
	}
	if k.Tier == 0 {
		return max(1, int(w))
	}
	w *= 1 - 0.012*float64(min(20, physio))
	weeks := max(1, int(math.Round(w)))
	if medLvl >= 3 && weeks > 1 {
		weeks--
	}
	return weeks
}

// ---------------------------------------------------------------- treatments

// Treatment: how a serious injury is handled. Rest is free and safe but slow; surgery costs money
// and is only as good as the doctor and the medical centre; an injection (painkillers, play on)
// is quick but risky; a specialist abroad is the best and the dearest.
type Treatment struct {
	Weeks   float64 // share of the lay-off left
	Setback float64 // setbacks during rehab
	Dmg     float64 // chance of lasting damage
	Wear    float64 // body wear
}

var Treatments = map[string]Treatment{
	"rest":       {Weeks: 1, Setback: 1, Dmg: 1, Wear: 1},
	"surgery":    {Weeks: 0.8, Setback: 0.6, Dmg: 0.55, Wear: 1},
	"injection":  {Weeks: 0.55, Setback: 2.2, Dmg: 1.7, Wear: 1.5},
	"specialist": {Weeks: 0.75, Setback: 0.5, Dmg: 0.35, Wear: 1},
}

func treatmentOf(key string) Treatment {
	if t, ok := Treatments[key]; ok {
		return t
	}
	return Treatments["rest"]
}

// surgeryQuality: the surgeon's hands and the theatre (1 = average; lower is better).
func surgeryQuality(doctor, medLvl int, ps Perks) float64 {
	q := 1.15 - 0.03*float64(min(20, doctor)) - 0.05*float64(max(1, medLvl)-1)
	if ps["surgeon"] {
		q -= 0.2
	}
	return clamp(q, 0.45, 1.15)
}

// complicationChance: an operation that goes wrong (more weeks, more damage).
func complicationChance(doctor, medLvl int, ps Perks) float64 {
	c := 0.15 - 0.006*float64(min(20, doctor)) - 0.02*float64(max(1, medLvl)-1)
	if ps["surgeon"] {
		c -= 0.05
	}
	return clamp(c, 0.02, 0.15)
}

// treatmentDmg: the lasting-damage multiplier a treatment brings.
func treatmentDmg(treat string, doctor, medLvl int, ps Perks) float64 {
	t := treatmentOf(treat)
	if treat == "surgery" {
		return t.Dmg * surgeryQuality(doctor, medLvl, ps)
	}
	return t.Dmg
}

// ageDmg: young bodies heal well, old ones keep the scars.
func ageDmg(age int) float64 {
	switch {
	case age <= 21:
		return 0.7
	case age <= 27:
		return 1
	case age <= 30:
		return 1.2
	}
	return 1.45
}

// ---------------------------------------------------------------- lasting effects

const (
	RustMax      = 0.18  // the most sharpness a long lay-off costs
	RustPerMatch = 0.035 // a full 90 minutes brings this much back
	RustTrain    = 0.006 // ...a week of training this much (plus a little per fitness-coach point)
	WearRisk     = 0.04  // injury risk +4% per point of body wear
	WearHeal     = 0.06  // wear the body sheds every matchday
	SummerWear   = 0.7   // share of the wear left after the summer break
	SummerRest   = 8     // weeks of recovery over the summer
	KnockRisk    = 2.5   // injury risk while playing through a hidden knock
	InjuryRate   = 0.96  // calibration: a club still sees about as many injuries as before the medical department (≈6 a season)
)

// wear levels: past each one the body slips (pace and physical first)
var wearLevels = []float64{6, 10, 14}

// rustAfter: match sharpness lost after a lay-off of this many weeks.
func rustAfter(weeks int) float64 {
	if weeks < 2 {
		return 0
	}
	return math.Min(RustMax, 0.01*float64(weeks)+0.01)
}

// summerInjury: weeks still out after the summer break (long injuries carry over into the new season).
func summerInjury(p *Player) int {
	return max(0, p.Injury-SummerRest)
}
