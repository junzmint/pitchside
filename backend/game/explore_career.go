package game

// ---------------------------------------------------------------- manager career
//
// The manager has his own reputation (0..100), separate from the club's. Results, trophies and
// beating expectations raise it, relegation costs it. A career is one club in one world: the
// manager never changes clubs inside a career (a new club means a new career, a new world), so
// reputation is a ladder of standing and titles, not a job market. JobOffer/Offers stay in the
// state only so older saves still load; nothing creates offers any more.

type Stint struct {
	ClubID   int    `json:"clubId"`
	Club     string `json:"club"`
	Short    string `json:"short"`
	Color    string `json:"color"`
	Color2   string `json:"color2"`
	League   string `json:"league"`
	Division int    `json:"division"`
	From     int    `json:"from"`
	To       int    `json:"to"`     // last season in charge (when closed)
	Closed   bool   `json:"closed"` // he has left
	Trophies int    `json:"trophies"`
}

type JobOffer struct {
	ClubID     int    `json:"clubId"`
	Club       string `json:"club"`
	Short      string `json:"short"`
	Color      string `json:"color"`
	Color2     string `json:"color2"`
	League     string `json:"league"`
	Division   int    `json:"division"`
	Reputation int    `json:"reputation"`
	Budget     int64  `json:"budget"`
	Until      int    `json:"until"` // season*100+day
	Mid        bool   `json:"mid"`   // a mid-season approach
}

type Manager struct {
	Rep      float64    `json:"rep"`
	Stints   []Stint    `json:"stints"`
	Offers   []JobOffer `json:"offers"`
	Declined int        `json:"declined"`
}

var ManagerTiers = []struct {
	Key string
	Min float64
}{{"unknown", 0}, {"promising", 25}, {"respected", 40}, {"renowned", 55}, {"elite", 70}, {"legendary", 85}}

func managerTier(rep float64) string {
	t := "unknown"
	for _, x := range ManagerTiers {
		if rep >= x.Min {
			t = x.Key
		}
	}
	return t
}

func startRep(club *Club) float64 {
	if club == nil {
		return 20
	}
	return clamp(20+float64(club.Reputation-40)*0.5, 10, 50)
}

// reachable: the biggest club reputation that would consider this manager.
func reachable(rep float64) int { return int(44 + rep*0.6) }

func stintOf(cl *Club, season int) Stint {
	return Stint{ClubID: cl.ID, Club: cl.Name, Short: cl.Short, Color: cl.Color, Color2: cl.Color2, League: cl.League, Division: cl.Division, From: season}
}

func (w *world) currentStint() *Stint {
	st := w.career.Explore.Manager.Stints
	if len(st) == 0 {
		return nil
	}
	return &st[len(st)-1]
}

// managerSeason: the season's verdict on the manager.
func (w *world) managerSeason(se *SeasonEnd) {
	x := &w.career.Explore
	user := w.byID[w.career.UserClubID]
	exp := w.expectedRank(user.ID)
	d := clamp(float64(exp-se.Position)*0.6, -8, 8)
	if se.Position == 1 {
		d += map[int]float64{1: 10, 2: 6, 3: 4}[se.Division]
	}
	switch se.Move {
	case "up":
		d += 4
	case "down":
		d -= 6
	}
	d += map[string]float64{"W": 5, "F": 2, "SF": 1}[se.Cup]
	d += map[string]float64{"W": 10, "F": 5, "SF": 3, "QF": 1.5, "R16": 0.5}[se.CL]
	x.Manager.Rep = clamp(x.Manager.Rep+d, 0, 100)
	if st := w.currentStint(); st != nil {
		st.Division = user.Division
	}
}
