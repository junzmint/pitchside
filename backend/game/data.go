package game

// All clubs, players and coaches below are fictional parodies.

// Style tweaks attributes so stars play like their real-life inspiration.
var styles = map[string]map[string]float64{
	"speed":     {"pace": 9, "dribbling": 3, "physical": -4, "passing": -3},
	"finisher":  {"shooting": 7, "physical": 4, "dribbling": -4, "passing": -4},
	"playmaker": {"passing": 8, "dribbling": 3, "pace": -5, "physical": -5},
	"dribbler":  {"dribbling": 8, "pace": 4, "physical": -6, "defending": -4},
	"wall":      {"defending": 6, "physical": 5, "pace": -3, "dribbling": -4},
	"engine":    {"physical": 6, "defending": 5, "passing": 2, "shooting": -5},
	"keeper":    {"goalkeeping": 3},
	"goat":      {"dribbling": 12, "passing": 9, "shooting": 5, "pace": -9, "physical": -14, "defending": -10},
	"siu":       {"shooting": 12, "physical": 4, "pace": -5, "dribbling": -2, "passing": -6},
}

type StarDef struct {
	Name, Nation string
	Age          int
	Pos          string
	Ovr          float64
	Pot          int
	Style        string
}

type CoachDef struct {
	Name, Nation string
	Skill        int
}

type ClubDef struct {
	Name, Short, Color, Color2 string
	Base                       float64
	Rep                        int
	Budget                     int64
	Formation                  string
	Tactic                     Tactic
	Coach                      CoachDef
	Stars                      []StarDef
}

type LeagueDef struct {
	Code    string
	Name    string
	Country string
	Nations []string // weighted pool for generated players
	Clubs   []ClubDef
}

func tac(m, p, pa, w string) Tactic { return Tactic{Mentality: m, Pressing: p, Passing: pa, Width: w} }

const M = 1_000_000

var Leagues = []LeagueDef{
	{
		Code: "EN", Name: "Premier Division", Country: "England",
		Nations: []string{"EN", "EN", "EN", "EN", "FR", "BR", "ES", "PT", "NL", "BE", "NG", "AR", "DE", "JP", "KR"},
		Clubs: []ClubDef{
			{"Manchester Sky", "MSK", "#6cabdd", "#1c2c5b", 79, 92, 120 * M, "4-3-3", tac("attacking", "high", "short", "wide"), CoachDef{"Pep Guardiolo", "ES", 19}, []StarDef{
				{"Erling Halland", "NO", 25, "FW/ST", 91, 94, "finisher"}, {"Rodrí Hernandes", "ES", 29, "MF/DM", 89, 89, "engine"},
				{"Kevin De Bruyna", "BE", 34, "MF/AM", 86, 86, "playmaker"}, {"Phil Fodan", "EN", 25, "MF/AM", 86, 89, "dribbler"},
				{"Rúben Diaz", "PT", 28, "DF/CB", 87, 88, "wall"}, {"Ederzon Moraes", "BR", 32, "GK", 86, 86, "keeper"}}},
			{"Mersey Red", "MER", "#c8102e", "#f6eb61", 78, 90, 90 * M, "4-3-3", tac("attacking", "high", "mixed", "wide"), CoachDef{"Arne Slott", "NL", 16}, []StarDef{
				{"Mohamed Salha", "EG", 33, "FW/RW", 89, 89, "speed"}, {"Virgil van Dyck", "NL", 34, "DF/CB", 88, 88, "wall"},
				{"Alisson Beckar", "BR", 33, "GK", 88, 88, "keeper"}, {"Alexis Mac Allistair", "AR", 26, "MF/CM", 86, 88, "playmaker"}}},
			{"North London Gunners", "NLG", "#ef0107", "#ffffff", 78, 89, 100 * M, "4-3-3", tac("balanced", "high", "short", "normal"), CoachDef{"Mikel Artetta", "ES", 17}, []StarDef{
				{"Bukayo Saká", "EN", 24, "FW/RW", 88, 91, "dribbler"}, {"Martin Ødegaardo", "NO", 26, "MF/AM", 87, 88, "playmaker"},
				{"Declan Rise", "EN", 26, "MF/CM", 87, 88, "engine"}, {"William Salibá", "FR", 24, "DF/CB", 87, 90, "wall"},
				{"David Raia", "ES", 30, "GK", 86, 86, "keeper"}}},
			{"West London Blues", "WLB", "#034694", "#ffffff", 76, 86, 110 * M, "4-2-3-1", tac("balanced", "mid", "short", "normal"), CoachDef{"Enzo Maresco", "IT", 15}, []StarDef{
				{"Cole Palmar", "EN", 23, "MF/AM", 87, 91, "playmaker"}, {"Moisés Caicedó", "EC", 23, "MF/DM", 85, 88, "engine"},
				{"Enzo Fernandés", "AR", 24, "MF/CM", 84, 87, "playmaker"}, {"Reece Jamés", "EN", 25, "DF/RB", 83, 85, "wall"}}},
			{"Manchester Reds", "MRE", "#da291c", "#111111", 75, 87, 90 * M, "3-5-2", tac("balanced", "mid", "mixed", "wide"), CoachDef{"Ruben Amorin", "PT", 15}, []StarDef{
				{"Bruno Fernandess", "PT", 31, "MF/AM", 86, 86, "playmaker"}, {"Lisandro Martinéz", "AR", 27, "DF/CB", 84, 85, "wall"},
				{"Kobbie Mainú", "EN", 20, "MF/CM", 80, 89, "engine"}, {"André Onanna", "CM", 29, "GK", 82, 83, "keeper"}}},
			{"North London Lilywhites", "NLW", "#132257", "#ffffff", 74, 82, 70 * M, "4-3-3", tac("attacking", "high", "direct", "wide"), CoachDef{"Ange Postecoglu", "AU", 13}, []StarDef{
				{"Son Heung-mín", "KR", 33, "FW/LW", 85, 85, "speed"}, {"James Maddisun", "EN", 28, "MF/AM", 83, 83, "playmaker"},
				{"Cristian Romerro", "AR", 27, "DF/CB", 84, 85, "wall"}}},
			{"Tyneside Magpies", "TYM", "#241f20", "#ffffff", 74, 80, 70 * M, "4-3-3", tac("balanced", "high", "direct", "normal"), CoachDef{"Eddie Howo", "EN", 14}, []StarDef{
				{"Alexander Isac", "SE", 26, "FW/ST", 87, 89, "finisher"}, {"Bruno Guimarais", "BR", 27, "MF/CM", 85, 86, "engine"},
				{"Nick Popé", "EN", 33, "GK", 83, 83, "keeper"}}},
			{"Birmingham Claret", "BCV", "#670e36", "#95bfe5", 73, 79, 60 * M, "4-2-3-1", tac("balanced", "mid", "mixed", "normal"), CoachDef{"Unai Emeri", "ES", 16}, []StarDef{
				{"Ollie Watkinz", "EN", 29, "FW/ST", 84, 84, "finisher"}, {"Emiliano Martínes", "AR", 33, "GK", 86, 86, "keeper"},
				{"Youri Tielemanz", "BE", 28, "MF/CM", 82, 83, "playmaker"}}},
		},
	},
	{
		Code: "ES", Name: "Liga Hispania", Country: "Spain",
		Nations: []string{"ES", "ES", "ES", "ES", "ES", "AR", "BR", "FR", "PT", "UY", "DE", "NL", "JP", "NG"},
		Clubs: []ClubDef{
			{"Real Madrix", "RMX", "#ffffff", "#febe10", 80, 95, 150 * M, "4-3-3", tac("attacking", "mid", "mixed", "wide"), CoachDef{"Xabi Alonzo", "ES", 17}, []StarDef{
				{"Kylian Mbapé", "FR", 26, "FW/ST", 91, 93, "speed"}, {"Vini Juniór", "BR", 25, "FW/LW", 89, 91, "dribbler"},
				{"Jude Bellinghum", "EN", 22, "MF/AM", 89, 93, "engine"}, {"Federico Valvarde", "UY", 27, "MF/CM", 88, 89, "engine"},
				{"Thibaut Courtoa", "BE", 33, "GK", 89, 89, "keeper"}, {"Antonio Rüdigar", "DE", 32, "DF/CB", 85, 85, "wall"}}},
			{"FC Barcelano", "BAR", "#a50044", "#004d98", 79, 93, 60 * M, "4-3-3", tac("attacking", "high", "short", "wide"), CoachDef{"Hansi Flik", "DE", 17}, []StarDef{
				{"Lamine Yamall", "ES", 18, "FW/RW", 89, 96, "dribbler"}, {"Robert Lewandowsky", "PL", 37, "FW/ST", 87, 87, "finisher"},
				{"Pedrí González", "ES", 22, "MF/CM", 88, 92, "playmaker"}, {"Raphinia Dias", "BR", 28, "FW/LW", 88, 88, "speed"},
				{"Ronald Araujó", "UY", 26, "DF/CB", 84, 86, "wall"}, {"Marc-André ter Stegan", "DE", 33, "GK", 86, 86, "keeper"}}},
			{"Atlético Madrix", "ATM", "#cb3524", "#272e61", 77, 86, 70 * M, "4-4-2", tac("defensive", "mid", "direct", "narrow"), CoachDef{"Diego Simeono", "AR", 17}, []StarDef{
				{"Antoine Griezmon", "FR", 34, "FW/ST", 86, 86, "playmaker"}, {"Julián Alvares", "AR", 25, "FW/ST", 86, 89, "finisher"},
				{"Jan Oblac", "SI", 32, "GK", 88, 88, "keeper"}, {"Koké Merodio", "ES", 33, "MF/CM", 82, 82, "engine"}}},
			{"Athletic Bilbo", "ATH", "#ee2523", "#ffffff", 74, 78, 50 * M, "4-2-3-1", tac("balanced", "high", "direct", "wide"), CoachDef{"Ernesto Valverdi", "ES", 14}, []StarDef{
				{"Nico Williamz", "ES", 23, "FW/LW", 85, 89, "speed"}, {"Iñaki Williamz", "GH", 31, "FW/RW", 81, 81, "speed"},
				{"Unai Simone", "ES", 28, "GK", 84, 85, "keeper"}}},
			{"Real Sociedá", "RSO", "#0067b1", "#ffffff", 73, 76, 45 * M, "4-3-3", tac("balanced", "mid", "short", "normal"), CoachDef{"Imanol Alguacill", "ES", 13}, []StarDef{
				{"Takefusa Kubó", "JP", 24, "FW/RW", 82, 85, "dribbler"}, {"Mikel Oyarzabál", "ES", 28, "FW/ST", 82, 82, "finisher"},
				{"Martín Zubimendy", "ES", 26, "MF/DM", 85, 87, "engine"}}},
			{"Yellow Submarine CF", "VIL", "#ffe667", "#005187", 73, 76, 45 * M, "4-4-2", tac("balanced", "mid", "short", "normal"), CoachDef{"Marcelino Garsía", "ES", 13}, []StarDef{
				{"Gerard Morenó", "ES", 33, "FW/ST", 81, 81, "finisher"}, {"Dani Parejó", "ES", 36, "MF/CM", 80, 80, "playmaker"}}},
			{"Sevila FC", "SEV", "#f43333", "#ffffff", 72, 75, 40 * M, "4-2-3-1", tac("balanced", "high", "mixed", "normal"), CoachDef{"Julen Lopetegi", "ES", 13}, []StarDef{
				{"Lucas Ocampoz", "AR", 31, "FW/LW", 79, 79, "speed"}, {"Jesús Navaz", "ES", 39, "DF/RB", 76, 76, "wall"}}},
			{"Valencya CF", "VAL", "#f5f5f5", "#111111", 71, 74, 35 * M, "4-4-2", tac("defensive", "mid", "direct", "normal"), CoachDef{"Rubén Barajá", "ES", 12}, []StarDef{
				{"Giorgi Mamardashvily", "GE", 25, "GK", 85, 89, "keeper"}, {"José Gayah", "ES", 30, "DF/LB", 80, 80, "wall"}}},
		},
	},
	{
		Code: "IT", Name: "Serie Azzurra", Country: "Italy",
		Nations: []string{"IT", "IT", "IT", "IT", "IT", "AR", "BR", "FR", "PT", "NL", "NG", "DE", "ES"},
		Clubs: []ClubDef{
			{"Milano Nerazzurri", "INT", "#0068a8", "#111111", 78, 88, 80 * M, "3-5-2", tac("balanced", "mid", "mixed", "wide"), CoachDef{"Simone Inzagy", "IT", 16}, []StarDef{
				{"Lautaro Martinéz", "AR", 28, "FW/ST", 88, 89, "finisher"}, {"Nicolò Barela", "IT", 28, "MF/CM", 87, 87, "engine"},
				{"Hakan Çalhanoglú", "TR", 31, "MF/DM", 86, 86, "playmaker"}, {"Alessandro Bastonni", "IT", 26, "DF/CB", 87, 89, "wall"},
				{"Yann Sommar", "CH", 36, "GK", 84, 84, "keeper"}}},
			{"Neapolis SSC", "NAP", "#12a0d7", "#ffffff", 77, 84, 70 * M, "4-3-3", tac("balanced", "high", "short", "wide"), CoachDef{"Antonio Conté", "IT", 17}, []StarDef{
				{"Khvicha Kvaratskhelya", "GE", 24, "FW/LW", 87, 90, "dribbler"}, {"Victor Osimhan", "NG", 26, "FW/ST", 87, 88, "finisher"},
				{"Scott McTominé", "SC", 28, "MF/CM", 84, 84, "engine"}, {"Giovanni Di Lorenzzo", "IT", 32, "DF/RB", 83, 83, "wall"}}},
			{"Torino Zebras", "TZB", "#111111", "#ffffff", 76, 86, 80 * M, "4-2-3-1", tac("balanced", "mid", "mixed", "normal"), CoachDef{"Thiago Motá", "IT", 14}, []StarDef{
				{"Dušan Vlahovik", "RS", 25, "FW/ST", 84, 86, "finisher"}, {"Kenan Yildís", "TR", 20, "FW/LW", 82, 90, "dribbler"},
				{"Gleison Bremér", "BR", 28, "DF/CB", 85, 85, "wall"}}},
			{"Milano Rossoneri", "MRN", "#fb090b", "#111111", 76, 85, 70 * M, "4-2-3-1", tac("attacking", "mid", "direct", "wide"), CoachDef{"Massimiliano Allegry", "IT", 15}, []StarDef{
				{"Rafael Leau", "PT", 26, "FW/LW", 86, 88, "speed"}, {"Christian Pulisick", "US", 27, "FW/RW", 84, 84, "dribbler"},
				{"Mike Maignon", "FR", 30, "GK", 87, 87, "keeper"}, {"Theo Hernandes", "FR", 28, "DF/LB", 85, 85, "speed"}}},
			{"Bergamo Dea", "BDE", "#1e71b8", "#111111", 74, 78, 45 * M, "3-5-2", tac("attacking", "high", "direct", "wide"), CoachDef{"Gian Piero Gasperinni", "IT", 16}, []StarDef{
				{"Ademola Lukman", "NG", 28, "FW/LW", 85, 85, "dribbler"}, {"Mateo Reteguí", "IT", 26, "FW/ST", 83, 84, "finisher"}}},
			{"Roma Lupi", "RLU", "#8e1f2f", "#f0bc42", 73, 80, 50 * M, "3-5-2", tac("balanced", "mid", "mixed", "normal"), CoachDef{"Claudio Ranieli", "IT", 15}, []StarDef{
				{"Paulo Dybalá", "AR", 31, "FW/RW", 84, 84, "dribbler"}, {"Lorenzo Pellegrinni", "IT", 29, "MF/AM", 82, 82, "playmaker"}}},
			{"Aquile Roma", "AQR", "#87d8f7", "#ffffff", 72, 75, 35 * M, "4-3-3", tac("balanced", "mid", "short", "normal"), CoachDef{"Marco Baronni", "IT", 13}, []StarDef{
				{"Ciro Immobilé", "IT", 35, "FW/ST", 80, 80, "finisher"}, {"Mattia Zaccagnie", "IT", 30, "FW/LW", 81, 81, "dribbler"}}},
			{"Firenze Viola", "FVI", "#592c82", "#ffffff", 71, 74, 35 * M, "4-3-3", tac("balanced", "mid", "mixed", "normal"), CoachDef{"Raffaele Palladinno", "IT", 12}, []StarDef{
				{"Moise Kiin", "IT", 25, "FW/ST", 82, 85, "finisher"}, {"David de Geá", "ES", 34, "GK", 84, 84, "keeper"}}},
		},
	},
	{
		Code: "DE", Name: "Deutsche Liga", Country: "Germany",
		Nations: []string{"DE", "DE", "DE", "DE", "DE", "FR", "NL", "AT", "CH", "BR", "JP", "KR", "NG", "ES"},
		Clubs: []ClubDef{
			{"FC Bavaria", "FCB", "#dc052d", "#ffffff", 80, 92, 110 * M, "4-2-3-1", tac("attacking", "high", "short", "wide"), CoachDef{"Vincent Kompani", "BE", 15}, []StarDef{
				{"Harry Kain", "EN", 32, "FW/ST", 90, 90, "finisher"}, {"Jamal Musiale", "DE", 22, "MF/AM", 88, 93, "dribbler"},
				{"Joshua Kimmik", "DE", 30, "MF/DM", 86, 86, "engine"}, {"Michael Olisé", "FR", 23, "FW/RW", 86, 90, "dribbler"},
				{"Manuel Neuere", "DE", 39, "GK", 85, 85, "keeper"}, {"Alphonso Davis", "CA", 24, "DF/LB", 83, 86, "speed"}}},
			{"Leverkusen Werkself", "LEV", "#e32221", "#111111", 77, 84, 70 * M, "3-5-2", tac("attacking", "high", "short", "wide"), CoachDef{"Erik ten Haag", "NL", 13}, []StarDef{
				{"Florian Wirtts", "DE", 22, "MF/AM", 89, 93, "playmaker"}, {"Granit Xhakka", "CH", 32, "MF/CM", 85, 85, "engine"},
				{"Victor Bonifase", "NG", 24, "FW/ST", 83, 86, "finisher"}, {"Jeremie Frimpon", "NL", 24, "DF/RB", 84, 86, "speed"}}},
			{"Dortmund Yellows", "BVY", "#fde100", "#111111", 75, 85, 70 * M, "4-2-3-1", tac("attacking", "high", "direct", "wide"), CoachDef{"Niko Kovack", "HR", 14}, []StarDef{
				{"Serhou Guirassi", "GN", 29, "FW/ST", 85, 85, "finisher"}, {"Julian Brandd", "DE", 29, "MF/AM", 83, 83, "playmaker"},
				{"Gregor Kobell", "CH", 27, "GK", 86, 88, "keeper"}, {"Karim Adeyemí", "DE", 23, "FW/LW", 81, 86, "speed"}}},
			{"Leipzig Bulls", "LBU", "#dd0741", "#ffffff", 75, 80, 60 * M, "4-4-2", tac("balanced", "high", "direct", "normal"), CoachDef{"Marco Rosé", "DE", 14}, []StarDef{
				{"Xavi Simonz", "NL", 22, "MF/AM", 84, 89, "dribbler"}, {"Benjamin Sesco", "SI", 22, "FW/ST", 83, 88, "finisher"},
				{"Peter Gulacsy", "HU", 35, "GK", 82, 82, "keeper"}}},
			{"Frankfurt Eagles", "FEA", "#e1000f", "#111111", 72, 76, 40 * M, "3-5-2", tac("balanced", "mid", "direct", "normal"), CoachDef{"Dino Topmoller", "DE", 13}, []StarDef{
				{"Hugo Ekitika", "FR", 23, "FW/ST", 83, 88, "speed"}, {"Kevin Trapf", "DE", 35, "GK", 82, 82, "keeper"}}},
			{"Stuttgart Swabians", "STS", "#e32219", "#ffffff", 72, 75, 40 * M, "4-2-3-1", tac("balanced", "high", "short", "normal"), CoachDef{"Sebastian Honess", "DE", 14}, []StarDef{
				{"Deniz Undaf", "DE", 29, "FW/ST", 82, 82, "finisher"}, {"Alexander Nubell", "DE", 29, "GK", 83, 84, "keeper"}}},
			{"Wolfsburg Wolves", "WOW", "#65b32e", "#ffffff", 70, 72, 40 * M, "4-4-2", tac("defensive", "mid", "direct", "normal"), CoachDef{"Ralph Hasenhutl", "AT", 12}, []StarDef{
				{"Mohamed Amura", "DZ", 25, "FW/ST", 80, 83, "speed"}}},
			{"Gladbach Foals", "GFO", "#111111", "#ffffff", 70, 72, 35 * M, "4-2-3-1", tac("balanced", "mid", "mixed", "normal"), CoachDef{"Gerardo Seoanne", "CH", 12}, []StarDef{
				{"Tim Kleindiest", "DE", 30, "FW/ST", 80, 80, "finisher"}, {"Jonas Omlyn", "CH", 31, "GK", 81, 81, "keeper"}}},
		},
	},
}

// Famous coaches between jobs.
var FreeCoaches = []CoachDef{
	{"Carlo Ancelotto", "IT", 18}, {"Jürgen Kloppe", "DE", 18}, {"José Mourinyo", "PT", 16},
	{"Zinedine Zidann", "FR", 17}, {"Luis Enrike", "ES", 17}, {"Thomas Tuchell", "DE", 16},
}

// nationsOf returns the name pool for any league code, competitive or world.
func nationsOf(code string) []string {
	if l := LeagueByCode(code); l != nil {
		return l.Nations
	}
	for _, w := range WorldLeagues {
		if w.Code == code {
			return w.Nations
		}
	}
	return nil
}

func LeagueByCode(code string) *LeagueDef {
	for i := range Leagues {
		if Leagues[i].Code == code {
			return &Leagues[i]
		}
	}
	return nil
}
