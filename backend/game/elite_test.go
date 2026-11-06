package game

import (
	"math/rand"
	"testing"
)

func medWorld(budget int64) (*world, *Club) {
	club := &Club{ID: 1, IsUser: true, Budget: budget, Medical: 2}
	w := &world{career: &Career{UserClubID: 1}, byID: map[int]*Club{1: club}, players: map[int][]*Player{}, coaches: map[int][]*Coach{},
		med: &MedState{P: map[int]*MedRec{}, touched: map[int]*Player{}}}
	return w, club
}

// An icon is never career-threatened: whatever the roll, even on a fragile knee, the worst is a serious injury.
func TestIconNeverCareerThreatened(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	icon := GenPlayer(r, []string{"EN"}, "FW", 90, 30, 30)
	icon.Tag = "legend"
	plain := GenPlayer(r, []string{"EN"}, "FW", 80, 30, 30)
	fragile := &MedRec{Frag: 5, FragK: "acl"}
	tier4, safe := 0, 0
	for i := 0; i < 200_000; i++ {
		k := pickKind(r, icon, fragile, i%2 == 0)
		if k.Tier >= 4 {
			t.Fatalf("an icon got %s", k.Key)
		}
		if k.Key == "meniscus" {
			safe++
		}
		if pickKind(r, plain, nil, false).Tier >= 4 {
			tier4++
		}
	}
	if tier4 == 0 || safe == 0 {
		t.Errorf("career-threatening injuries for others %d, icon's knee held %d: the test proves nothing", tier4, safe)
	}
}

// Elite surgery: about a third of the lay-off, no lasting damage and no complication, whatever the injury.
func TestEliteSurgery(t *testing.T) {
	w, club := medWorld(500_000_000)
	r := rand.New(rand.NewSource(3))
	for _, key := range []string{"acl", "achilles", "broken_leg", "meniscus", "ankle_lig"} {
		k := injuryKind(key)
		for i := 0; i < 40; i++ {
			p := GenPlayer(r, []string{"EN"}, "MF", 82, 31, 31) // an older body keeps the most scars
			p.ID = 100 + i
			weeks := k.Max
			p.Injury = weeks
			rec := &MedRec{Kind: key, Total: weeks}
			w.med.P[p.ID] = rec
			if w.applyTreatment(r, p, rec, "elite", club.ID) {
				t.Fatalf("%s: elite surgery had a complication", key)
			}
			if want := max(1, int(float64(weeks)*0.35+0.5)); p.Injury != want {
				t.Errorf("%s: %d weeks became %d, want %d", key, weeks, p.Injury, want)
			}
			if ch := damageChance(p, rec, k, 0); ch != 0 {
				t.Errorf("%s: %.2f chance of lasting damage after elite surgery", key, ch)
			}
			pace, pot := p.Pace, p.Potential
			if loss := w.lastingDamage(r, p, rec, k, 0); len(loss) > 0 || p.Pace != pace || p.Potential != pot {
				t.Errorf("%s: lasting damage %v after elite surgery", key, loss)
			}
		}
	}
	// without it, the same injuries leave their mark
	p := GenPlayer(r, []string{"EN"}, "MF", 82, 31, 31)
	if ch := damageChance(p, &MedRec{Kind: "acl", Treat: "specialist", Dmg: 0.35}, injuryKind("acl"), 0); ch <= 0 {
		t.Errorf("a specialist leaves no risk at all (%.2f): elite surgery would be pointless", ch)
	}
}

// The price: steep, by the player's value, well above the specialist abroad.
func TestEliteCost(t *testing.T) {
	acl, men := injuryKind("acl"), injuryKind("meniscus")
	star := &Player{Value: 60_000_000}
	if el, sp := treatCost(star, acl, "elite", 2), treatCost(star, acl, "specialist", 2); el != 7_200_000 || el <= sp {
		t.Errorf("a %d star's cruciate: elite %d, specialist %d", star.Value, el, sp)
	}
	if c := treatCost(&Player{Value: 2_000_000}, acl, "elite", 1); c != 3_000_000 {
		t.Errorf("the cheapest elite operation on a cruciate costs %d", c)
	}
	if c := treatCost(&Player{Value: 400_000_000}, acl, "elite", 5); c != 25_000_000 {
		t.Errorf("the dearest elite operation costs %d", c)
	}
	if c := treatCost(star, men, "elite", 2); c != 4_800_000 {
		t.Errorf("a serious injury's elite operation costs %d", c)
	}
}

// The treatment card offers elite surgery; the doctor advises it for an icon or a valuable player facing most of
// a season out when the club can easily afford it, and never chooses it when the manager does not answer.
func TestTreatCardElite(t *testing.T) {
	w, club := medWorld(200_000_000)
	star := &Player{ID: 1, Name: "Star", Value: 60_000_000, Age: 25, Injury: 30, Position: "FW"}
	rec := &MedRec{Kind: "acl", Total: 30}
	cd := w.treatCard(star, rec, injuryKind("acl"))
	el := cd.opt("elite")
	if el == nil || el.Weeks != 11 || el.Dmg != 0 || el.Cost != 7_200_000 {
		t.Fatalf("elite option %+v", el)
	}
	if !el.Rec || cd.Default == "elite" {
		t.Errorf("advised %v, default %s", el.Rec, cd.Default)
	}
	icon := &Player{ID: 2, Name: "Icon", Value: 110_000_000, Age: 30, Injury: 9, Position: "MF", Tag: "legend"}
	cd = w.treatCard(icon, &MedRec{Kind: "meniscus", Total: 9}, injuryKind("meniscus"))
	if o := cd.opt("elite"); o == nil || !o.Rec || cd.Default == "elite" {
		t.Errorf("icon's serious injury: elite %+v, default %s", o, cd.Default)
	}
	kid := &Player{ID: 3, Name: "Kid", Value: 3_000_000, Age: 19, Injury: 8, Position: "DF"}
	cd = w.treatCard(kid, &MedRec{Kind: "meniscus", Total: 8}, injuryKind("meniscus"))
	if o := cd.opt("elite"); o == nil || o.Rec {
		t.Errorf("a cheap player's elite option %+v", o)
	}
	club.Budget = 15_000_000
	if o := w.treatCard(star, rec, injuryKind("acl")).opt("elite"); o.Rec {
		t.Error("the doctor advised an operation the club cannot afford three times over")
	}
}
