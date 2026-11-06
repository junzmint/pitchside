package game

import (
	"math"
	"strconv"
	"strings"
	"sync"
)

// Legends: fictional parody names. Each line is
//
//	name | nation | position[/role] | style | peak rating | peak year | birth year | club:year[:role], club:year…
//
// Every club era becomes a card (age and rating follow a career curve), plus one "Icon" card at
// the peak. About 300 legends → roughly 1,000 cards.
//
// The role after the position is where his real-life self played at his peak (a full-back is "DF/RB", a
// holding midfielder "MF/DM", a winger "FW/LW"): one of NaturalRole's roles, in that position's group. A card
// always plays that role (legendRole) and his attributes are built for it (legendStar). Without a role ("DF")
// his attributes decide, as for anyone else. An era names its own role when he played elsewhere then, in the
// same group ("Torino Zebras:2019:ST": Ronalda led the line at Juventus, "Milano Rossoneri:2005:CB": Maldinni
// moved inside); the Icon card plays the main role.
const legendData = `
Lionel Messo|AR|FW/RW|goat|95|2012|1987|FC Barcelano:2006,FC Barcelano:2011:ST,FC Barcelano:2015,Paris Lumière:2022,Miami Rosa:2024:ST
Cristiano Ronalda|PT|FW/LW|siu|94|2014|1985|Sporting Lisboa:2003:RW,Manchester Reds:2008:RW,Real Madrix:2014,Torino Zebras:2019:ST,Riyadh Nassr:2024:ST
Ronaldo Fenômeno|BR|FW/ST|speed|94|1998|1976|Eindhoven Boeren:1995,FC Barcelano:1997,Milano Nerazzurri:1998,Real Madrix:2003,Milano Rossoneri:2007
Ronaldinyo Gaúcho|BR|FW/LW|dribbler|93|2005|1980|Paris Lumière:2002,FC Barcelano:2005,Milano Rossoneri:2009
Zinedine Zidann|FR|MF/AM|playmaker|92|2001|1972|Bordeaux:1995,Torino Zebras:1998,Real Madrix:2002
Thierry Henri|FR|FW/ST|speed|93|2004|1977|Monaco Rouge:1997:LW,North London Gunners:2004,FC Barcelano:2009:LW,New York Bulls:2012
Dennis Bergkampf|NL|FW/ST|playmaker|90|1998|1969|Amsterdam Ajacied:1992,Milano Nerazzurri:1994,North London Gunners:1998
Patrick Viera|FR|MF/DM|engine|90|2003|1976|Milano Rossoneri:1996,North London Gunners:2003,Milano Nerazzurri:2008
Paolo Maldinni|IT|DF/LB|wall|92|1994|1968|Milano Rossoneri:1990,Milano Rossoneri:1994,Milano Rossoneri:2005:CB
Franco Baresy|IT|DF/CB|wall|91|1990|1960|Milano Rossoneri:1989,Milano Rossoneri:1994
Alessandro Nestá|IT|DF/CB|wall|90|2003|1976|Aquile Roma:2000,Milano Rossoneri:2004
Andrea Pirlou|IT|MF/DM|playmaker|90|2007|1979|Milano Nerazzurri:1999:AM,Milano Rossoneri:2007,Torino Zebras:2013,New York Bulls:2016
Kaká Leitão|BR|MF/AM|dribbler|92|2007|1982|São Paulo Tricolor:2002,Milano Rossoneri:2007,Real Madrix:2010,Orlando Lions:2015
Andriy Shevchenkko|UA|FW/ST|finisher|91|2004|1976|Kyiv Dynamo:1998,Milano Rossoneri:2004,West London Blues:2007
Clarence Seedorph|NL|MF/CM|engine|88|2003|1976|Amsterdam Ajacied:1995,Real Madrix:1998,Milano Rossoneri:2007
Gennaro Gattusso|IT|MF/DM|engine|87|2006|1978|Milano Rossoneri:2003,Milano Rossoneri:2006
Filippo Inzaghy|IT|FW/ST|finisher|87|2003|1973|Torino Zebras:1999,Milano Rossoneri:2003
Marco van Bastan|NL|FW/ST|finisher|93|1989|1964|Amsterdam Ajacied:1986,Milano Rossoneri:1989
Ruud Gullett|NL|MF/AM|engine|91|1988|1962|Eindhoven Boeren:1986,Milano Rossoneri:1989,West London Blues:1996
Frank Rijkaart|NL|MF/DM|wall|90|1990|1962|Amsterdam Ajacied:1987,Milano Rossoneri:1990
Johan Cruyf|NL|FW/ST|playmaker|94|1974|1947|Amsterdam Ajacied:1972,FC Barcelano:1975
Diego Maradonna|AR|MF/AM|goat|95|1986|1960|La Boca Xeneize:1981,FC Barcelano:1983,Neapolis SSC:1987
Pelé Nascimento|BR|FW/ST|goat|96|1970|1940|Santos Praia:1962,Santos Praia:1970,New York Cosmos:1976
Franz Beckenbaur|DE|DF/CB|playmaker|93|1974|1945|FC Bavaria:1972,FC Bavaria:1975
Gerd Müllar|DE|FW/ST|finisher|93|1972|1945|FC Bavaria:1970,FC Bavaria:1974
Lothar Matthäos|DE|MF/CM|engine|91|1990|1961|Gladbach Foals:1983,FC Bavaria:1988,Milano Nerazzurri:1990
Jürgen Klinsmanne|DE|FW/ST|finisher|89|1994|1964|Stuttgart Swabians:1988,Milano Nerazzurri:1990,North London Lilywhites:1995
Michael Ballak|DE|MF/CM|engine|89|2004|1976|Leverkusen Werkself:2002:AM,FC Bavaria:2004,West London Blues:2008
Oliver Kahnn|DE|GK|keeper|92|2001|1969|FC Bavaria:2001,FC Bavaria:2006
Manuel Neuere|DE|GK|keeper|93|2014|1986|Gelsenkirchen Blau:2010,FC Bavaria:2014,FC Bavaria:2020
Philipp Lahmm|DE|DF/RB|wall|90|2013|1983|Stuttgart Swabians:2004:LB,FC Bavaria:2013
Bastian Schweinstiga|DE|MF/CM|engine|90|2013|1984|FC Bavaria:2008:LM,FC Bavaria:2013,Manchester Reds:2016
Franck Riberi|FR|FW/LW|dribbler|90|2013|1983|Marseille Bleu:2006,FC Bavaria:2013,Firenze Viola:2020
Arjen Robbin|NL|FW/RW|dribbler|90|2013|1984|Eindhoven Boeren:2003:LW,West London Blues:2005:LW,Real Madrix:2008,FC Bavaria:2013
Thomas Müllerr|DE|FW/RW|finisher|88|2014|1989|FC Bavaria:2010,FC Bavaria:2014,FC Bavaria:2020:ST
Miroslav Klosé|DE|FW/ST|finisher|87|2006|1978|Kaiserslautern Rot:2002,Bremen Werder:2006,FC Bavaria:2008,Aquile Roma:2012
Marco Royce|DE|FW/LW|speed|89|2016|1989|Gladbach Foals:2011,Dortmund Yellows:2016,Dortmund Yellows:2021
Mats Hummelz|DE|DF/CB|wall|89|2014|1988|Dortmund Yellows:2012,FC Bavaria:2017
Robert Lewandowsky|PL|FW/ST|finisher|93|2020|1988|Dortmund Yellows:2013,FC Bavaria:2020,FC Barcelano:2023
Xavi Hernandes|ES|MF/CM|playmaker|92|2010|1980|FC Barcelano:2005,FC Barcelano:2010
Andrés Iniestra|ES|MF/CM|dribbler|92|2012|1984|FC Barcelano:2009,FC Barcelano:2012,Vissel Kobe:2019
Carles Puyoll|ES|DF/CB|wall|90|2009|1978|FC Barcelano:2005,FC Barcelano:2009
Sergio Busquetts|ES|MF/DM|engine|89|2014|1988|FC Barcelano:2011,FC Barcelano:2016,Miami Rosa:2023
Gerard Piquét|ES|DF/CB|wall|89|2015|1987|Manchester Reds:2008,FC Barcelano:2015
Dani Alvés|BR|DF/RB|speed|89|2011|1983|Sevila FC:2007,FC Barcelano:2011,Torino Zebras:2017
Samuel Eto'oh|CM|FW/ST|finisher|91|2009|1981|FC Barcelano:2006,Milano Nerazzurri:2010:RW
Rivaldinho Ferreira|BR|FW/LW|dribbler|92|1999|1972|FC Barcelano:1999,Milano Rossoneri:2003
Luís Figu|PT|FW/RW|dribbler|91|2000|1972|Sporting Lisboa:1994,FC Barcelano:1998,Real Madrix:2001,Milano Nerazzurri:2007
Raúl Gonzales|ES|FW/ST|finisher|90|2001|1977|Real Madrix:1997,Real Madrix:2001,Gelsenkirchen Blau:2011
Iker Casillias|ES|GK|keeper|91|2008|1981|Real Madrix:2002,Real Madrix:2008,Porto Dragões:2016
Fernando Hierrro|ES|DF/CB|wall|89|1999|1968|Real Madrix:1995,Real Madrix:2001
Roberto Carloss|BR|DF/LB|speed|90|2002|1973|Milano Nerazzurri:1996,Real Madrix:2002
Sergio Ramoz|ES|DF/CB|wall|91|2017|1986|Sevila FC:2004:RB,Real Madrix:2012,Real Madrix:2017,Paris Lumière:2022
Luka Modrik|HR|MF/CM|playmaker|91|2018|1985|North London Lilywhites:2010,Real Madrix:2018,Real Madrix:2024
Karim Benzena|FR|FW/ST|finisher|91|2022|1987|Lumière:2007,Real Madrix:2012,Real Madrix:2022
Toni Kroós|DE|MF/CM|playmaker|90|2017|1990|FC Bavaria:2013:AM,Real Madrix:2017,Real Madrix:2024
Gareth Baile|WA|FW/RW|speed|89|2014|1989|North London Lilywhites:2012:LW,Real Madrix:2014
Marcelo Vieirra|BR|DF/LB|dribbler|88|2016|1988|Real Madrix:2012,Real Madrix:2017
David Beckhem|EN|MF/RM|playmaker|88|1999|1975|Manchester Reds:1999,Real Madrix:2004:CM,Los Angeles Galaxia:2009:CM,Milano Rossoneri:2009
Paul Scholez|EN|MF/CM|playmaker|89|2003|1974|Manchester Reds:1999,Manchester Reds:2003:AM,Manchester Reds:2011:DM
Ryan Giggz|WA|MF/LM|dribbler|88|1999|1973|Manchester Reds:1994,Manchester Reds:1999,Manchester Reds:2008:CM
Roy Keene|IE|MF/CM|engine|90|1999|1971|Manchester Reds:1994,Manchester Reds:1999
Eric Cantonna|FR|FW/ST|playmaker|90|1996|1966|Marseille Bleu:1990,Manchester Reds:1996
Peter Schmeikel|DK|GK|keeper|91|1998|1963|Manchester Reds:1994,Manchester Reds:1999
Rio Ferdinan|EN|DF/CB|wall|89|2008|1978|Manchester Reds:2004,Manchester Reds:2008
Nemanja Vidik|RS|DF/CB|wall|89|2009|1981|Manchester Reds:2009
Wayne Rooni|EN|FW/ST|finisher|90|2011|1985|Tyneside Magpies:2004,Manchester Reds:2008,Manchester Reds:2011,Washington United:2018
Ruud van Nistelroy|NL|FW/ST|finisher|90|2003|1976|Eindhoven Boeren:2000,Manchester Reds:2003,Real Madrix:2007
Edwin van der Saar|NL|GK|keeper|90|2008|1970|Amsterdam Ajacied:1995,Torino Zebras:2000,Manchester Reds:2008
Steven Gerrardo|EN|MF/CM|engine|91|2005|1980|Mersey Red:2001,Mersey Red:2005,Mersey Red:2009:AM,Los Angeles Galaxia:2015:DM
Kenny Dalgleesh|SC|FW/ST|playmaker|90|1983|1951|Glasgow Hoops:1976,Mersey Red:1983
Fernando Torress|ES|FW/ST|speed|90|2008|1984|Atlético Madrix:2006,Mersey Red:2008,West London Blues:2012,Milano Rossoneri:2015
Luis Suárezz|UY|FW/ST|finisher|92|2016|1987|Amsterdam Ajacied:2010,Mersey Red:2014,FC Barcelano:2016,Atlético Madrix:2021
Xabi Alonzo|ES|MF/DM|playmaker|89|2010|1981|Real Sociedá:2003,Mersey Red:2006,Real Madrix:2010,FC Bavaria:2015
Jamie Carraghar|EN|DF/CB|wall|86|2005|1978|Mersey Red:2005
Michael Owenn|EN|FW/ST|speed|90|2001|1979|Mersey Red:1998,Mersey Red:2001,Real Madrix:2005,Tyneside Magpies:2007
Sadio Manné|SN|FW/LW|speed|90|2019|1992|Southampton Saints:2015,Mersey Red:2019,FC Bavaria:2023:ST
Frank Lampardo|EN|MF/CM|engine|90|2008|1978|West London Blues:2005,West London Blues:2008,Manchester Sky:2015
John Terri|EN|DF/CB|wall|90|2006|1980|West London Blues:2005,West London Blues:2012
Didier Drogbah|CI|FW/ST|finisher|90|2010|1978|Marseille Bleu:2004,West London Blues:2010,West London Blues:2012,İstanbul Aslanlar:2013
Petr Čechh|CZ|GK|keeper|90|2006|1982|West London Blues:2006,North London Gunners:2016
Eden Hazzard|BE|FW/LW|dribbler|91|2018|1991|Lille Nord:2012,West London Blues:2015,West London Blues:2018,Real Madrix:2020
N'Golo Kantey|FR|MF/DM|engine|89|2017|1991|Leicester Foxes:2016:CM,West London Blues:2017
Claude Makelelé|FR|MF/DM|engine|88|2004|1973|Real Madrix:2002,West London Blues:2005
Gianfranco Zolla|IT|FW/ST|playmaker|89|1997|1966|Neapolis SSC:1990,West London Blues:1998
Ashley Kolle|EN|DF/LB|speed|88|2004|1980|North London Gunners:2004,West London Blues:2010
Tony Adamms|EN|DF/CB|wall|88|1998|1966|North London Gunners:1991,North London Gunners:1998
Robert Pirés|FR|FW/LW|dribbler|88|2002|1973|Marseille Bleu:1998,North London Gunners:2002,Yellow Submarine CF:2007
Cesc Fàbregass|ES|MF/CM|playmaker|89|2010|1987|North London Gunners:2008,FC Barcelano:2012:AM,West London Blues:2015
Robin van Persí|NL|FW/ST|finisher|90|2012|1983|North London Gunners:2012,Manchester Reds:2013,İstanbul Kanaryalar:2016
Ian Wrightt|EN|FW/ST|finisher|87|1995|1963|North London Gunners:1995
Alan Shearr|EN|FW/ST|finisher|90|1995|1970|Blackburn Rovers:1995,Tyneside Magpies:1997,Tyneside Magpies:2002
Harry Kain|EN|FW/ST|finisher|92|2023|1993|North London Lilywhites:2018,North London Lilywhites:2021,FC Bavaria:2024
David Ginolá|FR|FW/LW|dribbler|88|1996|1967|Paris Lumière:1994,Tyneside Magpies:1996,North London Lilywhites:1999
Son Heung-mín|KR|FW/LW|speed|89|2021|1992|Hamburg Rauten:2012,Leverkusen Werkself:2014,North London Lilywhites:2021
Ledley Kingg|EN|DF/CB|wall|86|2006|1980|North London Lilywhites:2006
Kevin De Bruyna|BE|MF/AM|playmaker|92|2020|1991|Wolfsburg Wolves:2015,Manchester Sky:2020,Manchester Sky:2024
Sergio Agüerro|AR|FW/ST|finisher|91|2014|1988|Atlético Madrix:2009,Manchester Sky:2014,Manchester Sky:2019
David Silvá|ES|MF/AM|playmaker|89|2012|1986|Valencya CF:2009:LM,Manchester Sky:2012,Manchester Sky:2018:CM,Real Sociedá:2021
Vincent Kompanny|BE|DF/CB|wall|89|2012|1986|Hamburg Rauten:2008,Manchester Sky:2012
Yaya Touré|CI|MF/CM|engine|89|2014|1983|FC Barcelano:2009:DM,Manchester Sky:2014
Fernandinho Rozza|BR|MF/DM|engine|87|2018|1985|Manchester Sky:2014,Manchester Sky:2018
Paul Pogbá|FR|MF/CM|engine|88|2016|1993|Torino Zebras:2015,Manchester Reds:2018
Gianluigi Buffoni|IT|GK|keeper|92|2006|1978|Parma Gialli:1999,Torino Zebras:2006,Torino Zebras:2017
Fabio Cannavarro|IT|DF/CB|wall|91|2006|1973|Parma Gialli:1998,Torino Zebras:2006,Real Madrix:2007
Alessandro Del Pierro|IT|FW/ST|dribbler|90|1998|1974|Torino Zebras:1996:LW,Torino Zebras:2002,Torino Zebras:2008
Pavel Nedvedd|CZ|MF/LM|engine|91|2003|1972|Aquile Roma:1999,Torino Zebras:2003
David Trezeguét|FR|FW/ST|finisher|88|2002|1977|Monaco Rouge:1998,Torino Zebras:2002
Giorgio Chiellinni|IT|DF/CB|wall|89|2015|1984|Torino Zebras:2012,Torino Zebras:2015
Leonardo Bonucchi|IT|DF/CB|wall|88|2016|1987|Torino Zebras:2016
Roberto Baggioh|IT|FW/ST|playmaker|92|1994|1967|Firenze Viola:1989,Torino Zebras:1994,Milano Rossoneri:1996,Bologna Rossoblu:1998
Francesco Tottie|IT|FW/ST|playmaker|91|2007|1976|Roma Lupi:2001,Roma Lupi:2007,Roma Lupi:2015
Daniele De Rossy|IT|MF/DM|engine|87|2008|1983|Roma Lupi:2008
Gabriel Batistutta|AR|FW/ST|finisher|92|1998|1969|Firenze Viola:1995,Firenze Viola:1998,Roma Lupi:2001
Javier Zanettí|AR|DF/RB|engine|88|2004|1973|Milano Nerazzurri:2000,Milano Nerazzurri:2010
Diego Militto|AR|FW/ST|finisher|88|2010|1979|Genova Grifone:2009,Milano Nerazzurri:2010
Wesley Sneijdar|NL|MF/AM|playmaker|90|2010|1984|Amsterdam Ajacied:2006,Real Madrix:2008,Milano Nerazzurri:2010
Zlatan Ibrahimovix|SE|FW/ST|finisher|91|2012|1981|Amsterdam Ajacied:2003,Torino Zebras:2005,Milano Nerazzurri:2008,FC Barcelano:2010,Milano Rossoneri:2011,Paris Lumière:2014,Manchester Reds:2017,Los Angeles Galaxia:2019
Hernán Crespó|AR|FW/ST|finisher|89|2001|1975|Parma Gialli:1999,Aquile Roma:2001,West London Blues:2004
Juan Sebastián Verón|AR|MF/CM|playmaker|89|2000|1975|Aquile Roma:2000,Manchester Reds:2002
Rui Costta|PT|MF/AM|playmaker|89|1999|1972|Lisboa Águias:1994,Firenze Viola:1999,Milano Rossoneri:2003
Marek Hamšíkk|SK|MF/CM|playmaker|87|2016|1987|Neapolis SSC:2013,Neapolis SSC:2016
Edinson Cavanni|UY|FW/ST|finisher|89|2013|1987|Neapolis SSC:2012,Paris Lumière:2017,Manchester Reds:2021
Lorenzo Insignié|IT|FW/LW|dribbler|87|2019|1991|Neapolis SSC:2019
Ciro Immobilé|IT|FW/ST|finisher|88|2020|1990|Dortmund Yellows:2015,Aquile Roma:2020
Hristo Stoichkof|BG|FW/LW|finisher|91|1994|1966|FC Barcelano:1994
Romário Faria|BR|FW/ST|finisher|92|1994|1966|Eindhoven Boeren:1990,FC Barcelano:1994,Rio Rubro-Negro:1998
Bebeto Oliveira|BR|FW/ST|finisher|88|1993|1964|La Coruña Blanquiazul:1993
Cafú Evangelista|BR|DF/RB|engine|90|2002|1970|Roma Lupi:2001,Milano Rossoneri:2004
Lúcio Ferreira|BR|DF/CB|wall|88|2010|1978|Leverkusen Werkself:2002,FC Bavaria:2006,Milano Nerazzurri:2010
Thiago Silvaa|BR|DF/CB|wall|90|2014|1984|Milano Rossoneri:2011,Paris Lumière:2014,West London Blues:2021
Neymer Jr|BR|FW/LW|dribbler|92|2017|1992|Santos Praia:2012,FC Barcelano:2015,Paris Lumière:2018
Adriano Imperador|BR|FW/ST|finisher|89|2005|1982|Parma Gialli:2003,Milano Nerazzurri:2005
Juninho Pernambucano|BR|MF/CM|playmaker|88|2005|1975|Lumière:2005
Hugo Sánchezz|MX|FW/ST|finisher|90|1990|1958|Atlético Madrix:1984,Real Madrix:1990
Emilio Butragueñho|ES|FW/ST|finisher|88|1987|1963|Real Madrix:1987
Alfredo Di Stefanno|AR|FW/ST|goat|94|1959|1926|Real Madrix:1956,Real Madrix:1960
Ferenc Puskáss|HU|FW/ST|finisher|93|1960|1927|Budapest Honvéd:1952,Real Madrix:1960
Eusébio Ferreira|PT|FW/ST|speed|92|1966|1942|Lisboa Águias:1966
George Bestt|NI|FW/RW|dribbler|92|1968|1946|Manchester Reds:1968
Bobby Charltonn|EN|MF/AM|playmaker|91|1966|1937|Manchester Reds:1966
Bobby Moorr|EN|DF/CB|wall|91|1966|1941|West Ham Hammers:1966
Lev Yashinn|RU|GK|keeper|93|1963|1929|Moscow Dynamo:1963
Michel Platinni|FR|MF/AM|playmaker|93|1985|1955|Saint-Étienne Verts:1980,Torino Zebras:1985
Karl-Heinz Rummenigá|DE|FW/ST|finisher|91|1981|1955|FC Bavaria:1981,Milano Nerazzurri:1985
Paolo Rossy|IT|FW/ST|finisher|90|1982|1956|Torino Zebras:1982
Dino Zoffo|IT|GK|keeper|90|1982|1942|Torino Zebras:1978,Torino Zebras:1982
Gary Linekker|EN|FW/ST|finisher|89|1986|1960|Everton Toffees:1986,FC Barcelano:1987,North London Lilywhites:1991
Kevin Keegann|EN|FW/ST|dribbler|90|1979|1951|Mersey Red:1976,Hamburg Rauten:1979
Ian Rushh|WA|FW/ST|finisher|90|1984|1961|Mersey Red:1984
Mohamed Salha|EG|FW/RW|speed|91|2022|1992|Basel Rot:2013,West London Blues:2014,Roma Lupi:2017,Mersey Red:2022
Virgil van Dyck|NL|DF/CB|wall|91|2019|1991|Glasgow Hoops:2014,Mersey Red:2019,Mersey Red:2024
Alisson Beckar|BR|GK|keeper|90|2020|1992|Roma Lupi:2018,Mersey Red:2020
Antoine Griezmon|FR|FW/ST|playmaker|89|2018|1991|Real Sociedá:2013:LW,Atlético Madrix:2018,FC Barcelano:2020:LW
Jan Oblac|SI|GK|keeper|91|2018|1993|Atlético Madrix:2016,Atlético Madrix:2021
Diego Godínn|UY|DF/CB|wall|88|2014|1986|Atlético Madrix:2014
Diego Forlánn|UY|FW/ST|finisher|88|2010|1979|Manchester Reds:2003,Yellow Submarine CF:2005,Atlético Madrix:2010
Diego Costta|ES|FW/ST|finisher|88|2014|1988|Atlético Madrix:2014,West London Blues:2017
David Villah|ES|FW/ST|finisher|90|2010|1981|Valencya CF:2008,FC Barcelano:2011,Atlético Madrix:2014,New York Bulls:2016
Gaizka Mendietta|ES|MF/CM|engine|88|2000|1974|Valencya CF:2000,Aquile Roma:2002
Santiago Cañizarres|ES|GK|keeper|87|2001|1969|Valencya CF:2001
Jesús Navaz|ES|FW/RW|speed|86|2010|1985|Sevila FC:2010,Manchester Sky:2014
Frédéric Kanoutté|ML|FW/ST|finisher|87|2007|1977|North London Lilywhites:2004,Sevila FC:2007
Aritz Adurizz|ES|FW/ST|finisher|86|2016|1981|Athletic Bilbo:2016
Julen Guerrerro|ES|MF/AM|playmaker|86|1995|1974|Athletic Bilbo:1995
Xabi Prietto|ES|MF/AM|playmaker|84|2010|1983|Real Sociedá:2010
Marcos Sennaa|ES|MF/DM|engine|86|2008|1976|Yellow Submarine CF:2008
Juan Román Riquelmé|AR|MF/AM|playmaker|90|2006|1978|La Boca Xeneize:2000,FC Barcelano:2002,Yellow Submarine CF:2006
Erling Halland|NO|FW/ST|finisher|93|2024|2000|Salzburg Bullen:2019,Dortmund Yellows:2021,Manchester Sky:2024
Kylian Mbapé|FR|FW/LW|speed|93|2023|1998|Monaco Rouge:2017:ST,Paris Lumière:2020,Paris Lumière:2023,Real Madrix:2025:ST
Jude Bellinghum|EN|MF/AM|engine|90|2024|2003|Birmingham Blues:2020,Dortmund Yellows:2022,Real Madrix:2024
Florian Wirtts|DE|MF/AM|playmaker|90|2025|2003|Leverkusen Werkself:2024,Mersey Red:2025
Pedrí González|ES|MF/CM|playmaker|89|2025|2002|Las Palmas Amarillo:2019,FC Barcelano:2025
Vini Juniór|BR|FW/LW|dribbler|91|2024|2000|Rio Rubro-Negro:2018,Real Madrix:2024
Bukayo Saká|EN|FW/RW|dribbler|89|2025|2001|North London Gunners:2021,North London Gunners:2025
Lautaro Martinéz|AR|FW/ST|finisher|89|2024|1997|Racing Avellaneda:2018,Milano Nerazzurri:2024
Rodrí Hernandes|ES|MF/DM|engine|91|2024|1996|Yellow Submarine CF:2018,Atlético Madrix:2019,Manchester Sky:2024
Khvicha Kvaratskhelya|GE|FW/LW|dribbler|88|2025|2001|Neapolis SSC:2023,Paris Lumière:2025
Victor Osimhan|NG|FW/ST|finisher|89|2023|1998|Lille Nord:2020,Neapolis SSC:2023,İstanbul Aslanlar:2025
Jay-Jay Okochaa|NG|MF/AM|dribbler|88|1998|1973|Frankfurt Eagles:1993,İstanbul Kanaryalar:1998,Paris Lumière:2000
George Weahh|LR|FW/ST|speed|91|1995|1966|Monaco Rouge:1990,Paris Lumière:1994,Milano Rossoneri:1996
Samuel Kuffourr|GH|DF/CB|wall|86|2001|1976|FC Bavaria:2001
Michael Essienn|GH|MF/CM|engine|88|2008|1982|Lumière:2005,West London Blues:2008
Park Ji-sungg|KR|MF/RM|engine|85|2009|1981|Eindhoven Boeren:2005,Manchester Reds:2009
Hidetoshi Nakatta|JP|MF/AM|playmaker|86|2001|1977|Perugia Grifo:1999,Roma Lupi:2001
Shinji Kagawah|JP|MF/AM|playmaker|86|2012|1989|Dortmund Yellows:2012,Manchester Reds:2013
Keisuke Hondah|JP|MF/AM|playmaker|85|2014|1986|Moscow CSKA:2012,Milano Rossoneri:2014
Cha Bum-kunn|KR|FW/ST|finisher|88|1983|1953|Frankfurt Eagles:1980,Leverkusen Werkself:1986
Landon Donovann|US|FW/RW|speed|85|2010|1982|Los Angeles Galaxia:2010
Clint Dempsy|US|FW/ST|finisher|85|2012|1983|Fulham Cottagers:2012,Seattle Sound:2014
Tim Howardd|US|GK|keeper|86|2009|1979|Manchester Reds:2004,Everton Toffees:2009
Christian Pulisick|US|FW/RW|dribbler|85|2024|1998|Dortmund Yellows:2018,West London Blues:2020,Milano Rossoneri:2024
Henrik Larssonn|SE|FW/ST|finisher|89|2001|1971|Glasgow Hoops:2001,FC Barcelano:2005,Manchester Reds:2007
Peter Crouche|EN|FW/ST|finisher|82|2008|1981|Mersey Red:2007,North London Lilywhites:2010
Jamie Vardee|EN|FW/ST|speed|87|2016|1987|Leicester Foxes:2016,Leicester Foxes:2020
Riyad Mahrezz|DZ|FW/RW|dribbler|88|2016|1991|Leicester Foxes:2016,Manchester Sky:2021
Hakim Ziyechh|MA|FW/RW|playmaker|86|2019|1993|Amsterdam Ajacied:2019,West London Blues:2021
Achraf Hakimmi|MA|DF/RB|speed|88|2023|1998|Dortmund Yellows:2020,Milano Nerazzurri:2021,Paris Lumière:2023
Luka Jovicc|RS|FW/ST|finisher|82|2019|1997|Frankfurt Eagles:2019,Real Madrix:2020
Mario Götzé|DE|MF/AM|dribbler|87|2013|1992|Dortmund Yellows:2013,FC Bavaria:2015,Frankfurt Eagles:2023
Ilkay Gündoğann|DE|MF/CM|playmaker|88|2021|1990|Dortmund Yellows:2013,Manchester Sky:2021,FC Barcelano:2024
Jerome Boatengg|DE|DF/CB|wall|88|2014|1988|Manchester Sky:2010,FC Bavaria:2014
Granit Xhakka|CH|MF/CM|engine|86|2024|1992|Gladbach Foals:2015,North London Gunners:2020,Leverkusen Werkself:2024
Jamal Musiale|DE|MF/AM|dribbler|89|2025|2003|FC Bavaria:2023,FC Bavaria:2025
Marcus Rashfort|EN|FW/LW|speed|86|2023|1997|Manchester Reds:2023
Wilfried Zahá|CI|FW/LW|dribbler|84|2019|1992|Crystal Eagles:2019,İstanbul Aslanlar:2024
Mousa Dembelé|BE|MF/CM|dribbler|85|2015|1987|North London Lilywhites:2015
Edin Džekko|BA|FW/ST|finisher|87|2017|1986|Wolfsburg Wolves:2009,Manchester Sky:2012,Roma Lupi:2017,Milano Nerazzurri:2022
Víctor Valdéss|ES|GK|keeper|86|2011|1982|FC Barcelano:2006,FC Barcelano:2011
Ronald Koemann|NL|DF/CB|playmaker|88|1992|1963|Eindhoven Boeren:1988,FC Barcelano:1992
Jaap Stamm|NL|DF/CB|wall|88|2000|1972|Eindhoven Boeren:1997,Manchester Reds:2000,Aquile Roma:2003,Milano Rossoneri:2005
Gary Nevill|EN|DF/RB|engine|85|1999|1975|Manchester Reds:1999,Manchester Reds:2007
Dida Silvaa|BR|GK|keeper|87|2004|1973|Milano Rossoneri:2003,Milano Rossoneri:2007
Ricardo Carvalhoo|PT|DF/CB|wall|87|2005|1978|Porto Dragões:2003,West London Blues:2006,Real Madrix:2011
Marcel Desaillyy|FR|DF/CB|wall|89|1994|1968|Marseille Bleu:1993,Milano Rossoneri:1995,West London Blues:2000
Júlio Césarr|BR|GK|keeper|88|2010|1979|Milano Nerazzurri:2007,Milano Nerazzurri:2010
Sami Hyypiäa|FI|DF/CB|wall|85|2001|1973|Mersey Red:2001,Leverkusen Werkself:2009
Trent Alexander-Arnald|EN|DF/RB|playmaker|87|2022|1998|Mersey Red:2019,Mersey Red:2023,Real Madrix:2025
Ederson Moraess|BR|GK|keeper|89|2021|1993|Lisboa Águias:2017,Manchester Sky:2021
Rúben Diass|PT|DF/CB|wall|89|2021|1997|Lisboa Águias:2019,Manchester Sky:2021,Manchester Sky:2024
Kyle Walkerr|EN|DF/RB|speed|86|2019|1990|North London Lilywhites:2016,Manchester Sky:2019
Gianluigi Donnarumo|IT|GK|keeper|88|2023|1999|Milano Rossoneri:2020,Paris Lumière:2023
Marquinhoss Aoás|BR|DF/CB|wall|88|2020|1994|Roma Lupi:2013,Paris Lumière:2020
Marco Verrattí|IT|MF/CM|playmaker|88|2018|1992|Paris Lumière:2015,Paris Lumière:2019
Raí Oliveiraa|BR|MF/AM|playmaker|87|1994|1965|São Paulo Tricolor:1992,Paris Lumière:1995
Sol Campbel|EN|DF/CB|wall|88|2002|1974|North London Lilywhites:1998,North London Gunners:2002
Lee Dixonn|EN|DF/RB|engine|84|1991|1964|North London Gunners:1991,North London Gunners:1998
Martin Keownn|EN|DF/CB|wall|84|1998|1966|North London Gunners:1998,North London Gunners:2002
Filipe Luíss|BR|DF/LB|engine|85|2014|1985|Atlético Madrix:2014,West London Blues:2015,Atlético Madrix:2018
Juanfrann Torress|ES|DF/RB|engine|84|2016|1985|Atlético Madrix:2014,Atlético Madrix:2018
José María Giménezz|UY|DF/CB|wall|85|2019|1995|Atlético Madrix:2017,Atlético Madrix:2021
Hugo Llorris|FR|GK|keeper|87|2017|1986|Lumière:2011,North London Lilywhites:2017
Gary Mabutt|EN|DF/CB|wall|83|1989|1961|North London Lilywhites:1987,North London Lilywhites:1992
Jan Vertonghenn|BE|DF/CB|wall|85|2016|1987|Amsterdam Ajacied:2011,North London Lilywhites:2016
Glenn Hoddlé|EN|MF/CM|playmaker|87|1983|1957|North London Lilywhites:1983,Monaco Rouge:1988
Roman Weidenfellar|DE|GK|keeper|84|2012|1980|Dortmund Yellows:2011,Dortmund Yellows:2014
Matthias Sammerr|DE|DF/CB|playmaker|90|1996|1967|Milano Nerazzurri:1992,Dortmund Yellows:1996
Łukasz Piszczekk|PL|DF/RB|engine|83|2013|1985|Dortmund Yellows:2012,Dortmund Yellows:2017
Frank de Boerr|NL|DF/CB|wall|87|1995|1970|Amsterdam Ajacied:1995,FC Barcelano:2000
Danny Blindd|NL|DF/CB|wall|84|1995|1961|Amsterdam Ajacied:1992,Amsterdam Ajacied:1995
Matthijs de Licht|NL|DF/CB|wall|87|2019|1999|Amsterdam Ajacied:2019,Torino Zebras:2021,FC Bavaria:2023
Ruud Krolle|NL|DF/LB|playmaker|88|1974|1949|Amsterdam Ajacied:1972,Amsterdam Ajacied:1978,Neapolis SSC:1982
Aldair Santoss|BR|DF/CB|wall|86|1996|1965|Lisboa Águias:1990,Roma Lupi:1996
Walter Samuél|AR|DF/CB|wall|86|2004|1978|Roma Lupi:2001,Real Madrix:2004,Milano Nerazzurri:2010
Vincent Candelaa|FR|DF/LB|engine|82|2001|1973|Roma Lupi:2001
Radja Nainggolann|BE|MF/CM|engine|85|2016|1988|Roma Lupi:2016,Milano Nerazzurri:2018
Angelo Peruzzy|IT|GK|keeper|86|1998|1970|Torino Zebras:1996,Aquile Roma:2002
Siniša Mihajlovićc|RS|DF/CB|playmaker|85|1999|1969|Aquile Roma:1999,Milano Nerazzurri:2005
Fernando Coutto|PT|DF/CB|wall|84|1998|1969|Porto Dragões:1993,FC Barcelano:1996,Aquile Roma:2000
Pepe Reinna|ES|GK|keeper|85|2010|1982|Yellow Submarine CF:2004,Mersey Red:2010,Neapolis SSC:2014
Kalidou Koulibali|SN|DF/CB|wall|88|2019|1991|Neapolis SSC:2018,West London Blues:2022
Ciro Ferrarra|IT|DF/CB|wall|85|1990|1967|Neapolis SSC:1989,Torino Zebras:1995
Kim Min-jaee|KR|DF/CB|wall|86|2023|1996|Neapolis SSC:2023,FC Bavaria:2024
Giovanni Di Lorenzzo|IT|DF/RB|engine|84|2023|1993|Neapolis SSC:2021,Neapolis SSC:2024
Allan Marquess|BR|MF/CM|engine|84|2018|1991|Neapolis SSC:2018
Bernd Lenno|DE|GK|keeper|83|2016|1992|Leverkusen Werkself:2015,North London Gunners:2019
Jeremie Frimpongg|NL|DF/RB|speed|85|2024|2000|Leverkusen Werkself:2024
Jonathan Tahh|DE|DF/CB|wall|85|2024|1996|Leverkusen Werkself:2022,Leverkusen Werkself:2024
Ulf Kirstenn|DE|FW/ST|finisher|86|1997|1965|Leverkusen Werkself:1993,Leverkusen Werkself:1999
Roberto Ayalla|AR|DF/CB|wall|87|2003|1973|Milano Rossoneri:1999,Valencya CF:2003
Carlos Marchenna|ES|DF/CB|wall|83|2006|1979|Valencya CF:2004,Valencya CF:2008
Miroslav Djukicc|RS|DF/CB|wall|83|1998|1966|Valencya CF:1998
Amedeo Carbonia|IT|DF/LB|engine|82|2001|1965|Valencya CF:2000
Rubén Barajja|ES|MF/CM|engine|85|2004|1975|Valencya CF:2002,Valencya CF:2006
Claudio Lópezz|AR|FW/ST|speed|86|1999|1974|Valencya CF:1999,Aquile Roma:2002
Mario Kempess|AR|FW/ST|finisher|89|1978|1954|Valencya CF:1978,Valencya CF:1981
Andrés Palopp|ES|GK|keeper|82|2008|1973|Sevila FC:2007
Jules Koundéh|FR|DF/RB|speed|86|2022|1998|Sevila FC:2021,FC Barcelano:2024
Diego Carlosz|BR|DF/CB|wall|82|2020|1993|Sevila FC:2020
Ivan Rakitićc|HR|MF/CM|playmaker|86|2014|1988|Sevila FC:2014,FC Barcelano:2017
Éver Banegga|AR|MF/CM|playmaker|83|2016|1988|Valencya CF:2011,Sevila FC:2016
Steven N'Zonzii|FR|MF/DM|engine|83|2016|1988|Sevila FC:2016,Roma Lupi:2018
Davor Šukker|HR|FW/ST|finisher|89|1996|1968|Sevila FC:1993,Real Madrix:1997,North London Gunners:1999
Fabien Barthezz|FR|GK|keeper|87|1998|1971|Marseille Bleu:1993,Monaco Rouge:1998,Manchester Reds:2001
Basile Bolli|FR|DF/CB|wall|84|1993|1967|Marseille Bleu:1993
Laurent Blancc|FR|DF/CB|playmaker|87|1998|1965|Marseille Bleu:1998,Milano Nerazzurri:2000,Manchester Reds:2002
Manuel Amoróss|FR|DF/RB|engine|84|1990|1961|Monaco Rouge:1986,Marseille Bleu:1990
Jocelyn Anglomma|FR|DF/RB|engine|82|1993|1965|Marseille Bleu:1993,Valencya CF:1999
Didier Deschampp|FR|MF/DM|engine|87|1996|1968|Marseille Bleu:1993,Torino Zebras:1996,West London Blues:1999
Chris Waddlle|EN|MF/RM|dribbler|86|1991|1960|North London Lilywhites:1988,Marseille Bleu:1991
Abedi Pelléh|GH|MF/AM|dribbler|87|1991|1964|Marseille Bleu:1991,Monaco Rouge:1994
Shay Givenn|IE|GK|keeper|84|2002|1976|Tyneside Magpies:2002,Manchester Sky:2009
Fabricio Colocciny|AR|DF/CB|wall|81|2011|1982|Tyneside Magpies:2011
Steve Howeyy|EN|DF/CB|wall|81|1996|1971|Tyneside Magpies:1996
Philippe Albertt|BE|DF/CB|playmaker|82|1996|1967|Tyneside Magpies:1996
Kieran Trippiar|EN|DF/RB|engine|83|2023|1990|North London Lilywhites:2018,Atlético Madrix:2020,Tyneside Magpies:2023
Nolberto Solanno|PE|MF/RM|dribbler|82|2002|1974|Tyneside Magpies:2002
Gary Speedd|WA|MF/CM|engine|82|1999|1969|Tyneside Magpies:1999
Peter Beardsleyy|EN|MF/AM|playmaker|86|1988|1961|Tyneside Magpies:1985,Mersey Red:1989,Tyneside Magpies:1994
Thibaut Courtoá|BE|GK|keeper|90|2022|1992|Atlético Madrix:2014,West London Blues:2017,Real Madrix:2022
Jens Lehmannd|DE|GK|keeper|86|2004|1969|Dortmund Yellows:2000,North London Gunners:2004
David Seamann|EN|GK|keeper|86|1998|1963|North London Gunners:1998
Pat Jenningss|NI|GK|keeper|86|1975|1945|North London Lilywhites:1975,North London Gunners:1981
Gordon Bankss|EN|GK|keeper|90|1966|1937|Leicester Foxes:1966
Ray Clemencee|EN|GK|keeper|87|1977|1948|Mersey Red:1977,North London Lilywhites:1984
Sepp Maierr|DE|GK|keeper|89|1974|1944|FC Bavaria:1974
Walter Zengaa|IT|GK|keeper|88|1990|1960|Milano Nerazzurri:1990
Andoni Zubizarretta|ES|GK|keeper|86|1992|1961|FC Barcelano:1992,Valencya CF:1996
`

func roundHalf(v float64) float64 { return math.Round(v*2) / 2 }

// VersionLabel: the version as a card stores it: "Real Madrix '14", or "Icon".
func (lv LegendVersion) VersionLabel() string {
	if lv.Club != "" {
		return lv.Club + " " + lv.Label
	}
	return lv.Label
}

// LegendVersions are generated from legendData: one card per club era plus an "Icon" card.
var LegendVersions = buildLegendVersions()

func buildLegendVersions() []LegendVersion {
	var out []LegendVersion
	for _, line := range strings.Split(strings.TrimSpace(legendData), "\n") {
		f := strings.Split(line, "|")
		if len(f) != 8 {
			continue
		}
		pos, role, _ := strings.Cut(f[2], "/") // "DF/RB": a defender who plays right-back
		peak, _ := strconv.ParseFloat(f[4], 64)
		peakYear, _ := strconv.Atoi(f[5])
		born, _ := strconv.Atoi(f[6])
		peakAge := peakYear - born
		for _, era := range strings.Split(f[7], ",") {
			cy := strings.SplitN(era, ":", 3) // club:year, or club:year:role when he played elsewhere in that era
			if len(cy) < 2 {
				continue
			}
			eraRole := role
			if len(cy) == 3 && roleInPosition(cy[2], pos) {
				eraRole = cy[2]
			}
			year, _ := strconv.Atoi(cy[1])
			age := year - born
			// young players and veterans sit below their peak
			ovr := roundHalf(math.Max(70, peak-math.Max(0, float64(peakAge-age))*0.9-math.Max(0, float64(age-peakAge))*0.75))
			// a young version can still become the player he was at his peak; a veteran is past it
			pot := int(ovr)
			if age < peakAge {
				pot = max(pot, int(peak))
			}
			out = append(out, LegendVersion{Name: f[0], Nation: f[1], Pos: pos, Role: eraRole, Club: cy[0],
				Label: "'" + cy[1][2:], Age: age, Ovr: ovr, Pot: pot, Style: f[3]})
		}
		icon := math.Min(97, peak+1)
		out = append(out, LegendVersion{Name: f[0], Nation: f[1], Pos: pos, Role: role, Club: "", Label: "Icon",
			Age: peakAge, Ovr: icon, Pot: int(icon), Style: f[3]})
	}
	return out
}

// legendRoles: each legend's person (foldName) → his main role in the data (his Icon card's).
var legendRoles = sync.OnceValue(func() map[string]string {
	m := map[string]string{}
	for _, lv := range LegendVersions {
		if lv.Role != "" && lv.Club == "" {
			m[foldName(lv.Name)] = lv.Role
		}
	}
	return m
})

// legendRole: where a legend card plays — the role his real-life self played, from the data — whatever his
// attributes and his id (which decides the side for anyone else, NaturalRole). "" for everyone else, a legend
// without a role in the data, or a role outside his position group: his attributes decide then.
func legendRole(p *Player) string {
	if p.Tag != "legend" {
		return ""
	}
	if lv, ok := legendVersionIndex()[[2]string{p.Name, p.Version}]; ok && roleInPosition(lv.Role, p.Position) {
		return lv.Role // the role of his era: "Torino Zebras '19", Ronalda up front
	}
	if r := legendRoles()[legendPerson(p.Name)]; roleInPosition(r, p.Position) {
		return r
	}
	return ""
}

// roleInPosition: role is one that NaturalRole gives, in pos's group ("DF" → CB, LB or RB).
func roleInPosition(role, pos string) bool {
	switch role {
	case "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST":
		return RoleCat(role) == pos
	}
	return false
}
