package game

import (
	"math"
	"math/rand"
	"strings"
)

// Each country runs three divisions of 20. Division 1 starts with the eight hand-made clubs from
// data.go plus twelve from the list below; divisions 2 and 3 take the next forty. Lists are fixed
// so the club picker can show them before a career exists.

const (
	Divisions    = 3
	DivisionSize = 20
	LowerDivStep = 0.75 // base strength lost per place in divisions 2 and 3 (division 1's generated clubs: 0.6)
	PromoteCount = 3
)

var DivisionNames = map[string][Divisions]string{
	"EN": {"Premier Division", "First Division", "Second Division"},
	"ES": {"Liga Hispania", "Segunda Hispania", "Tercera Hispania"},
	"IT": {"Serie Azzurra", "Serie Bianca", "Serie Verde"},
	"DE": {"Deutsche Liga", "Zweite Liga", "Dritte Liga"},
}

var countryClubs = map[string][]string{
	"EN": {"Merseyside Blues", "West Midlands Albion", "Yorkshire Whites", "Leicester Foxes", "Southampton Saints", "Brighton Seagulls",
		"Crystal Eagles", "Wolverhampton Wanderers", "Fulham Cottagers", "Brentford Bees", "Bournemouth Cherries", "Nottingham Woods",
		"Burnley Clarets", "Sheffield Blades", "Sheffield Owls", "Norwich Canaries", "Watford Hornets", "West Ham Hammers",
		"Ipswich Tractors", "Sunderland Black Cats", "Middlesbrough Smoggies", "Stoke Potters", "Hull Tigers", "Derby Rams",
		"Coventry Sky Blues", "Bristol Robins", "Cardiff Bluebirds", "Swansea Swans", "Preston Lilywhites", "Blackburn Rovers",
		"Millwall Lions", "West London Hoops", "Luton Hatters", "Reading Royals", "Birmingham Blues", "Portsmouth Pompey",
		"Plymouth Pilgrims", "Charlton Addicks", "Wigan Latics", "Bolton Trotters", "Barnsley Tykes", "Huddersfield Terriers",
		"Oxford Yellows", "Peterborough Posh", "Rotherham Millers", "Wycombe Chairboys", "Lincoln Imps", "Exeter Grecians",
		"Blackpool Seasiders", "Shrewsbury Shrews", "Cambridge Amber", "Bradford Bantams"},
	"ES": {"Betis Verdiblanco", "Vigo Celestes", "Osasuna Rojillos", "Getafe Azulones", "Mallorca Bermellones", "Girona Blanquivermell",
		"Rayo Vallekas", "Alavés Babazorros", "Las Palmas Amarillo", "Espanyol Periquitos", "Granada Nazaríes", "Cádiz Amarillos",
		"Almería Rojiblancos", "Valladolid Pucela", "Leganés Pepineros", "Eibar Armeros", "Elche Franjiverdes", "Levante Granotas",
		"Zaragoza Maños", "Gijón Rojiblancos", "Oviedo Carbayones", "Santander Racing", "Tenerife Chicharreros", "La Coruña Blanquiazul",
		"Huesca Oscenses", "Mirandés Jabatos", "Albacete Queso", "Burgos Blanquinegros", "Cartagena Efesé", "Castellón Albinegros",
		"Córdoba Califas", "Málaga Boquerones", "Elda Azulgranas", "Ferrol Racing", "Ponferrada Bercianos", "Lugo Albivermellos",
		"Murcia Pimentoneros", "Huelva Decanos", "Alicante Herculanos", "Salamanca Charros", "Logroño Riojanos", "Mérida Romanos",
		"Alcorcón Alfareros", "Fuenlabrada Azules", "Sabadell Arlequinados", "Tarragona Grana", "Soria Numantinos", "Lorca Blanquiazul",
		"Jaén Lagartos", "Badajoz Blanquinegros", "Cáceres Verdes", "Marbella Costeños"},
	"IT": {"Bologna Rossoblu", "Torino Granata", "Genova Grifone", "Genova Blucerchiati", "Udine Bianconeri", "Verona Gialloblu",
		"Sassuolo Neroverdi", "Lecce Giallorossi", "Cagliari Isolani", "Empoli Azzurri", "Monza Brianzoli", "Parma Gialli",
		"Como Lariani", "Venezia Arancioneroverdi", "Frosinone Canarini", "Salerno Granata", "Bari Galletti", "Palermo Rosanero",
		"Brescia Rondinelle", "Cremona Grigiorossi", "Spezia Aquilotti", "Pisa Nerazzurri", "Modena Canarini", "Reggio Granata",
		"Catanzaro Giallorossi", "Cosenza Lupi", "Ascoli Bianconeri", "Terni Rossoverdi", "Perugia Grifo", "Pescara Delfini",
		"Catania Elefanti", "Livorno Amaranto", "Vicenza Biancorossi", "Padova Biancoscudati", "Trieste Alabardati", "Novara Azzurri",
		"Avellino Lupi", "Foggia Satanelli", "Taranto Rossoblu", "Siena Robur", "Arezzo Amaranto", "Ancona Dorici",
		"Mantova Virgiliani", "Piacenza Lupi", "Alessandria Grigi", "Carrara Marmiferi", "Castellammare Vespe", "Bolzano Biancorossi",
		"Lucca Pantere", "Benevento Streghe", "Crotone Squali", "Trapani Granata"},
	"DE": {"Bremen Werder", "Freiburg Breisgau", "Hoffenheim Kraichgau", "Mainz Karneval", "Augsburg Fugger", "Union Eisern",
		"Berlin Alte Dame", "Köln Geißböcke", "Bochum Unabsteigbar", "Heidenheim Brenz", "Darmstadt Lilien", "Gelsenkirchen Blau",
		"Hamburg Rauten", "Hannover Roten", "Düsseldorf Fortuna", "Nürnberg Club", "Kaiserslautern Rot", "Karlsruhe Wildpark",
		"Paderborn Ostwestfalen", "Kiel Störche", "Fürth Kleeblatt", "Magdeburg Elbe", "Rostock Kogge", "Braunschweig Löwen",
		"Elversberg Saar", "Osnabrück Lila", "Wiesbaden Wehen", "Regensburg Jahn", "Sandhausen Hardt", "Bielefeld Arminia",
		"Dresden Dynamo", "Saarbrücken Molschder", "Aue Veilchen", "Ingolstadt Schanzer", "Duisburg Zebras", "Essen Rot-Weiss",
		"Münster Preußen", "Mannheim Waldhof", "Unterhaching Vorstadt", "Verl Sportclub", "Halle Hallescher", "Lübeck Marzipan",
		"Ulm Spatzen", "Aachen Alemannia", "Oberhausen Kleeblätter", "Offenbach Kickers", "Cottbus Energie", "Zwickau Schwäne",
		"Meppen Emsland", "Würzburg Kickers", "Burghausen Wacker", "Chemnitz Himmelblau"},
}

var kitColours = [][2]string{{"#1f6fd1", "#ffffff"}, {"#c8202f", "#ffffff"}, {"#1a8f4c", "#ffffff"}, {"#f08a24", "#1b2440"},
	{"#5f3fb0", "#ffffff"}, {"#30343a", "#e6c34a"}, {"#e6c34a", "#1b2440"}, {"#0f3d6e", "#7fd3ff"}, {"#7a1f2b", "#f0c040"},
	{"#2b8fb3", "#ffffff"}, {"#111111", "#ffffff"}, {"#d64a8a", "#111111"}}

func shortOf(name string) string {
	parts := strings.Fields(strings.ToUpper(name))
	rs := []rune(parts[0])
	if len(rs) > 3 {
		rs = rs[:3]
	}
	return string(rs)
}

// CountryClubDefs returns all 60 club definitions for a country, in division order (20 per division).
func CountryClubDefs(code string) []ClubDef {
	ld := LeagueByCode(code)
	defs := append([]ClubDef{}, ld.Clubs...)
	names := countryClubs[code]
	r := rand.New(rand.NewSource(int64(len(code)*7919 + int(code[0])*31 + int(code[1]))))
	forms := []string{"4-4-2", "4-3-3", "4-2-3-1", "3-5-2", "5-3-2"}
	ments := []string{"defensive", "balanced", "attacking"}
	press := []string{"low", "mid", "high"}
	pass := []string{"short", "mixed", "direct"}
	for i, n := range names {
		total := len(defs) // overall index 8..59
		div := total / DivisionSize
		posInDiv := float64(total % DivisionSize)
		var base float64
		switch div {
		case 0:
			base = 71 - posInDiv*0.6 // D1 extras: ~71 → 64
		// lower divisions spread like real second and third tiers (0.4 a place made them a coin toss: the champion
		// finished on about 72 points, the table's spread was half a real one's)
		case 1:
			base = 66 - posInDiv*LowerDivStep // D2: 66 → 51.8
		default:
			base = 60 - posInDiv*LowerDivStep // D3: 60 → 45.8
		}
		k := kitColours[(i*5+int(code[0]))%len(kitColours)]
		if c1, c2, ok := homeColours(n); ok { // the club's real colours (data_kits.go)
			k = [2]string{c1, c2}
		}
		defs = append(defs, ClubDef{Name: n, Short: shortOf(n), Color: k[0], Color2: k[1], Base: base, Rep: int(base) - 4,
			Budget: int64(max(1, math.Floor(base-48))) * 2 * M, Formation: forms[r.Intn(len(forms))], // the poorest still have 2M
			Tactic: Tactic{Mentality: ments[r.Intn(3)], Pressing: press[r.Intn(3)], Passing: pass[r.Intn(3)], Width: "normal"}})
		if len(defs) >= Divisions*DivisionSize {
			break
		}
	}
	uniqueShorts(defs, len(ld.Clubs))
	return defs
}

// preSpread: a lower-division club's base before LowerDivStep spread the lower divisions (0.4 a place).
func preSpread(div int, pos float64) float64 {
	if div == 1 {
		return 66 - pos*0.4
	}
	return 60 - pos*0.4
}

// divisionLevel: the level of a division's mid-table club, which its youth intake and market players follow.
// Divisions 2 and 3 keep the level they had before they were spread, so a save's intake and market stay as they
// were; only a new career's squads spread (division 1 never changed).
func divisionLevel(code string, div int) float64 {
	if div < 1 || div > Divisions {
		return 60
	}
	if div > 1 {
		return preSpread(div-1, DivisionSize/2)
	}
	if defs := CountryClubDefs(code); DivisionSize/2 < len(defs) {
		return defs[DivisionSize/2].Base
	}
	return 60
}

// divisionAverage: the mean level of a division's clubs (the same rule as divisionLevel).
func divisionAverage(code string, div int) float64 {
	if div > 1 && div <= Divisions {
		sum := 0.0
		for pos := 0; pos < DivisionSize; pos++ {
			sum += preSpread(div-1, float64(pos))
		}
		return sum / DivisionSize
	}
	defs := CountryClubDefs(code)
	sum, n := 0.0, 0
	for i := 0; i < DivisionSize && i < len(defs); i++ {
		sum += defs[i].Base
		n++
	}
	return sum / float64(max(1, n))
}

// uniqueShorts gives every generated club a short name no other club in the country has
// ("Merseyside Blues" can't be MER next to Mersey Red). The hand-made top clubs keep theirs.
func uniqueShorts(defs []ClubDef, fixed int) {
	taken := map[string]bool{}
	for _, d := range defs[:min(fixed, len(defs))] {
		taken[d.Short] = true
	}
	for i := fixed; i < len(defs); i++ {
		d := &defs[i]
		for _, c := range shortCandidates(d.Name) {
			if !taken[c] {
				d.Short = c
				break
			}
		}
		taken[d.Short] = true
	}
}

// shortCandidates: the first three letters, then initials and mixes of the first and last words.
func shortCandidates(name string) []string {
	words := strings.Fields(strings.ToUpper(name))
	if len(words) == 0 {
		return []string{"FC"}
	}
	first, last := []rune(words[0]), []rune(words[len(words)-1])
	pick := func(rs []rune, n int) string { return string(rs[:min(n, len(rs))]) }
	out := []string{shortOf(name)}
	if len(words) >= 3 {
		out = append(out, string([]rune(words[0])[:1])+string([]rune(words[1])[:1])+string([]rune(words[2])[:1]))
	}
	if len(words) >= 2 {
		out = append(out, pick(first, 2)+pick(last, 1), pick(first, 1)+pick(last, 2), pick(first, 1)+string(last[min(1, len(last)-1)])+pick(last, 1))
	}
	for i := 3; i < len(first); i++ {
		out = append(out, pick(first, 2)+string(first[i]))
	}
	for d := '2'; d <= '9'; d++ {
		out = append(out, pick(first, 2)+string(d))
	}
	return out
}

// ShortFixes lists, per country, the generated clubs whose short name changed when names were made
// unique: existing saves are updated once at start-up (see Migrate).
func ShortFixes() [][3]string {
	var out [][3]string // league code, club name, new short
	for _, l := range Leagues {
		ld := LeagueByCode(l.Code)
		for _, d := range CountryClubDefs(l.Code)[len(ld.Clubs):] {
			if d.Short != shortOf(d.Name) {
				out = append(out, [3]string{l.Code, d.Name, d.Short})
			}
		}
	}
	return out
}

func divisionName(code string, div int) string {
	if n, ok := DivisionNames[code]; ok && div >= 1 && div <= Divisions {
		return n[div-1]
	}
	return code
}

// leagueKey labels a division's fixtures, e.g. "EN-1".
func leagueKey(code string, div int) string { return code + "-" + string(rune('0'+div)) }
