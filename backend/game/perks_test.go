package game

import (
	"math/rand"
	"reflect"
	"testing"
)

// The cache must give exactly the perks every coach always had (saves rely on them never changing),
// and callers must get their own copy.
func TestPerksForCached(t *testing.T) {
	ref := func(c *Coach) []string {
		opts := rolePerks[c.Role]
		r := rand.New(rand.NewSource(int64(c.ID)*7919 + int64(len(c.Name))*31))
		n := 1
		if c.Skill >= 15 {
			n = 2
		}
		idx := r.Perm(len(opts))
		out := []string{}
		for i := 0; i < n && i < len(idx); i++ {
			out = append(out, opts[idx[i]])
		}
		return out
	}
	for id := 1; id <= 3000; id++ {
		for role := range rolePerks {
			c := &Coach{ID: id, Name: "Coach " + role, Role: role, Skill: 8 + id%12}
			want := ref(c)
			for pass := 0; pass < 2; pass++ { // worked out, then from the cache
				if got := perksFor(c); !reflect.DeepEqual(got, want) {
					t.Fatalf("coach %d %s pass %d: %v, want %v", id, role, pass, got, want)
				}
			}
		}
	}
	c := &Coach{ID: 7, Name: "x", Role: "head", Skill: 10}
	got := perksFor(c)
	got[0] = "changed"
	if perksFor(c)[0] == "changed" {
		t.Fatal("a returned slice changed the cached perks")
	}
}

func BenchmarkPerksFor(b *testing.B) {
	cs := make([]*Coach, 2000)
	for i := range cs {
		cs[i] = &Coach{ID: i + 1, Name: "Coach", Role: CoachRoles[i%len(CoachRoles)], Skill: 10 + i%10}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, c := range cs {
			_ = perksFor(c)
		}
	}
}
