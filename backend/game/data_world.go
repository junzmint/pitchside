package game

// World leagues: clubs that exist only in the transfer world (scout, buy, swap) and do not play
// in the four competitions. They take the player pool to roughly 5,000.

type WorldLeague struct {
	Code    string
	Name    string
	Country string
	Nations []string
	Cities  []string
	Base    [2]float64 // weakest → strongest club level
}

var suffixes = []string{"FC", "United", "Athletic", "Sporting", "City", "Rovers", "Wanderers", "AC", "SC", "Real"}

var WorldLeagues = []WorldLeague{
	{"FR", "Ligue Hexagone", "France", []string{"FR", "FR", "FR", "FR", "NG", "BR", "PT", "BE"},
		[]string{"Lumière", "Marseille Bleu", "Lille Nord", "Bordeaux", "Nantes", "Rennes", "Nice Azur", "Montpellier", "Strasbourg", "Toulouse", "Lens", "Reims", "Brest", "Lorient", "Metz", "Angers", "Auxerre", "Le Havre"}, [2]float64{64, 78}},
	{"PT", "Liga Lusa", "Portugal", []string{"PT", "PT", "PT", "BR", "BR", "AR", "UY"},
		[]string{"Lisboa Águias", "Lisboa Leões", "Porto Dragões", "Braga", "Guimarães", "Boavista", "Famalicão", "Rio Ave", "Gil Vicente", "Estoril", "Casa Pia", "Arouca", "Moreirense", "Chaves", "Vizela", "Farense", "Portimão", "Madeira"}, [2]float64{60, 77}},
	{"NL", "Lage Landen Divisie", "Netherlands", []string{"NL", "NL", "NL", "NL", "BE", "NG", "JP"},
		[]string{"Amsterdam Ajacied", "Eindhoven Boeren", "Rotterdam Haven", "Alkmaar", "Utrecht", "Enschede Tukkers", "Arnhem", "Heerenveen", "Groningen", "Nijmegen", "Sittard", "Zwolle", "Almere", "Waalwijk", "Tilburg", "Breda", "Deventer", "Rotterdam Kralingen"}, [2]float64{60, 76}},
	{"BR", "Série Verde", "Brazil", []string{"BR", "BR", "BR", "BR", "BR", "AR", "UY"},
		[]string{"Rio Rubro-Negro", "São Paulo Tricolor", "Palmeiras Verde", "Santos Praia", "Corinthians Leste", "Fluminense", "Vasco", "Botafogo Estrela", "Grêmio Sul", "Internacional Porto", "Atlético Mineiro", "Cruzeiro", "Bahia", "Fortaleza", "Recife", "Curitiba", "Goiás", "Ceará", "Bragantino", "Cuiabá"}, [2]float64{60, 75}},
	{"AR", "Primera Plata", "Argentina", []string{"AR", "AR", "AR", "AR", "UY", "BR"},
		[]string{"Buenos Aires Millonarios", "La Boca Xeneize", "Avellaneda Racing", "Avellaneda Rojo", "San Lorenzo", "Vélez", "Estudiantes", "Gimnasia", "Rosario Canallas", "Rosario Leprosos", "Lanús", "Banfield", "Huracán", "Talleres", "Belgrano", "Godoy Cruz", "Argentinos", "Platense", "Tigre", "Colón"}, [2]float64{58, 74}},
	{"US", "Major Soccer West", "USA", []string{"US", "US", "US", "AR", "EN", "JP", "KR", "BR"},
		[]string{"Los Angeles Galaxia", "Seattle Sound", "Miami Rosa", "New York Bulls", "Atlanta Five", "Austin Verde", "Portland Timber", "Kansas City", "Columbus Crew", "Nashville", "Philadelphia Union", "Toronto Reds", "Vancouver", "Cincinnati", "Orlando Lions", "Chicago Fire", "Dallas", "Houston Dynamo", "Salt Lake", "St. Louis"}, [2]float64{56, 72}},
	{"JP", "J-Sakura League", "Japan", []string{"JP", "JP", "JP", "JP", "KR", "BR"},
		[]string{"Yokohama Marinos", "Kawasaki Front", "Kashima Antlers", "Urawa Diamonds", "Vissel Kobe", "Gamba Osaka", "Cerezo Osaka", "Nagoya Grampus", "Sanfrecce", "Tokyo FC", "Sapporo", "Kyoto Sanga", "Shonan", "Fukuoka", "Niigata", "Kashiwa", "Sagan Tosu", "Machida"}, [2]float64{56, 71}},
	{"TR", "Süper Hilal Lig", "Türkiye", []string{"TR", "TR", "TR", "TR", "BR", "NG", "PT"},
		[]string{"İstanbul Aslanlar", "İstanbul Kanaryalar", "İstanbul Kartallar", "Trabzon Fırtına", "Başakşehir", "Konya", "Antalya", "Kayseri", "Sivas", "Alanya", "Gaziantep", "Kasımpaşa", "Hatay", "Samsun", "Ankara", "Rize", "Adana", "Bodrum"}, [2]float64{58, 75}},
	{"BE", "Pro League Belgica", "Belgium", []string{"BE", "BE", "BE", "NL", "FR", "NG"},
		[]string{"Brugge Blauw", "Anderlecht Paars", "Genk", "Antwerpen", "Gent Buffalo", "Standard Luik", "Union Saint-Gilles", "Mechelen", "Charleroi", "Leuven", "Sint-Truiden", "Westerlo", "Kortrijk", "Cercle", "Eupen", "Dender"}, [2]float64{58, 74}},
	{"SC", "Highland Premiership", "Scotland", []string{"SC", "SC", "SC", "EN", "EN", "NG"},
		[]string{"Glasgow Hoops", "Glasgow Light Blues", "Aberdeen Dons", "Edinburgh Jambos", "Edinburgh Hibees", "Dundee", "Dundee Arabs", "Kilmarnock", "Motherwell", "St Mirren", "Ross County", "St Johnstone"}, [2]float64{56, 72}},
}

func isCompLeague(code string) bool {
	for _, l := range Leagues {
		if l.Code == code {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- legend versions
//
// Each legend has several cards from different eras. A card carries the club of that era: signing
// a legend for the club he starred at gives him a "homecoming" chemistry bonus.

type LegendVersion struct {
	Name   string
	Nation string
	Pos    string
	Club   string // era club (must match a club name in the career), "" = none
	Label  string // e.g. "'08"
	Age    int
	Ovr    float64
	Style  string
}
