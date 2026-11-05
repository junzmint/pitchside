package game

// ---------------------------------------------------------------- resale: no instant flips
//
// For ResaleDays matchdays after you buy a player, other clubs pay at most what you paid for him
// (in a sale, a swap, a quick sale or a bid). A bargain can't be sold on straight away at full
// value, and a youngster has to play and grow before anyone pays more for him.

const ResaleDays = 30

// Signing: when the user bought a player and what he cost (Contracts.Signed).
type Signing struct {
	Season int   `json:"season"`
	Day    int   `json:"day"`
	Fee    int64 `json:"fee"`
}

func noteSigning(c *Career, p *Player, fee int64) {
	if c.Contracts.Signed == nil {
		c.Contracts.Signed = map[int]Signing{}
	}
	c.Contracts.Signed[p.ID] = Signing{Season: c.Season, Day: c.Day, Fee: max(0, fee)}
}

func daysSinceSigning(c *Career, s Signing) int {
	return (c.Season-s.Season)*len(Calendar) + c.Day - s.Day
}

// resaleLeft: matchdays until other clubs pay his full value again (0: they already do).
func resaleLeft(c *Career, p *Player) int {
	s, ok := c.Contracts.Signed[p.ID]
	if !ok || s.Fee >= p.Value {
		return 0
	}
	return max(0, ResaleDays-daysSinceSigning(c, s))
}

// resalePrice: the most other clubs pay for him today — his value, or what you paid for a recent
// signing who cost less than that.
func resalePrice(c *Career, p *Player) int64 {
	if resaleLeft(c, p) > 0 {
		return max(10_000, c.Contracts.Signed[p.ID].Fee)
	}
	return p.Value
}

// applyResale shows the cap on the user's recent signings and forgets signings that are old enough.
func applyResale(c *Career, p *Player) {
	s, ok := c.Contracts.Signed[p.ID]
	if !ok {
		return
	}
	if left := resaleLeft(c, p); left > 0 {
		p.ResaleCap, p.ResaleLeft = max(10_000, s.Fee), left
	} else if daysSinceSigning(c, s) >= ResaleDays {
		delete(c.Contracts.Signed, p.ID)
	}
}
