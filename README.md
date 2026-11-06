# Pitchside

A football game that mixes management with playing matches yourself (Vietnamese / English / Japanese). You sign up, pick a club from one of four European leagues (fictional parody names), then build the squad, set tactics, train players and do deals. On matchday you can either take the pitch and play against the computer, or simulate the result.

- **Backend**: Go 1.24 (`net/http`, `pgx`, `bcrypt`), in `backend/`
- **Frontend**: React 18 + Vite + TypeScript, in `frontend/`. Matches are drawn on a canvas (`frontend/src/match/engine.ts`)
- **Database**: PostgreSQL 16 in Docker. The schema is created and migrated automatically on start; accounts are kept across upgrades

## Getting started (for new players)

Only **Docker Desktop** is needed (Docker Engine 24+ with Compose v2). Go and Node are only for development.

```bash
git clone <repo-url> pitchside && cd pitchside
make up          # or: docker compose up -d --build
```

Open **http://localhost:5195**. The first build takes a few minutes.

`make up` keeps the game on this computer: other devices on the network can't reach it. To play with a phone, a tablet or a second laptop over Wi-Fi, start it with `make up-lan` instead.

On first start with an empty database the server loads the **demo data** from [`backend/seed.json`](backend/seed.json):

| Account | Careers |
|---------|---------|
| `demo`  | Mersey Red (England, Division 1, 6 matchdays in, sponsor signed, 2 custom players) · Pitchside FC (custom club, Spain Division 3) |
| `demo2` | Palermo Rosanero (Italy, Division 2, fresh save) |

The passwords are in `seed.json`. You can also just sign up your own account.

These accounts are for local testing only: change or remove them before putting the game on a public server.

**First steps in the game**:
- The first time you open a career, a five-step tour shows the main screens.
- The **?** button in the side menu opens *How to play*: the game loop, keyboard and controller controls, and tips.
- The **gear** opens Settings: language (Tiếng Việt / English / 日本語), sound and volume, controller vibration, the match camera, difficulty and match length.
- To ease into a career, switch on **Assistant picks the team** in Tactics, and simulate matches from the Match Centre while you learn.

### Useful commands

```bash
make up          # build and start everything      → http://localhost:5195 (this computer only)
make up-lan      # the same, open to devices on the same Wi-Fi (Wi-Fi 2-player, phones, tablets)
make down        # stop
make vacuum      # compact the database if the game gets slow after many seasons (a few seconds, while nobody plays)
make seed        # load seed.json again (users that already exist are skipped)
make reset       # stop and WIPE the database (demo data comes back on the next `make up`)
make logs        # API logs
```

### Ports

| Service  | Port  | Notes |
|----------|-------|-------|
| Web      | 5195  | nginx; proxies `/api` to the backend, gzip enabled |
| API      | 8095  | Go |
| Postgres | 55432 | user/pass/db: `pitch` / `pitch` / `pitchside` |

All three listen on 127.0.0.1 only, so nothing is reachable from other machines. `make up-lan` opens the web port (5195) to the network; the API and the database stay on this computer.

If one of these ports is taken on your machine, change the port number before the container port in `ports:` in `docker-compose.yml` (for example `127.0.0.1:5196:80`).

### Development (live reload)

```bash
make db          # Postgres only
make api         # Go backend (port 8095); needs Go 1.24+
make web         # Vite dev server (port 5195, this computer only; WEB_BIND=0.0.0.0 make web opens it to the Wi-Fi), proxies /api to 8095; needs Node 20+
make seed-local  # load demo data into the dev database
```

### Editing the demo data

`backend/seed.json` is embedded into the API binary. Each career can set `league` (EN/ES/IT/DE), `clubIndex` (0–59: 0–19 Division 1, 20–39 Division 2, 40–59 Division 3) or `custom` + `division` for your own club, `sponsor` (offer 0–2), `simulateDays` and `customPlayers`. Rebuild (`make up`) after editing, then run `make seed`, or `make reset && make up` for a clean start.

### Play now: quick match, Wi-Fi 2-player, training ground

The title screen's **Play now** card (also at the bottom of the Match Centre in a career) has three modes.

**Quick match**
- Pick any of the 240 clubs, or one of 17 Legends XIs (Real Madrix, Barcelano, Milano, Bavaria and more).
- Play against the computer, with two players on one device, or over Wi-Fi.
- Choose the length, difficulty and weather, and whether a draw goes to extra time and penalties.
- Nothing touches your careers; your record (wins, draws, losses) is kept on the device.

**Two players over Wi-Fi**
1. On the computer running `make up-lan` (the host), open **Play now → 2 players over Wi-Fi** and pick two teams. (Plain `make up` keeps the game on this computer, so other devices can't join.)
2. A room code, an address like `http://192.168.1.20:5195/join` and a QR code appear. `make up-lan` finds the Wi-Fi address itself (`LAN_IP`).
3. On a phone, tablet or second laptop on the same Wi-Fi, scan the QR code or open the address and enter the code. No account is needed; the login page also has a "Join a 2-player Wi-Fi match" link.
4. Press **Kick off**. The guest is player 2, using on-screen touch buttons, a controller or the keyboard.

What else to know:
- **Dropouts:** if the guest drops out, the match pauses until they reopen the page, or you let the computer take over.
- **No network:** pair two Bluetooth controllers to one computer and use "2 players, this device".
- **Firewall:** if your Mac's firewall asks, allow incoming connections for Docker.

**Training ground**
- Free practice against a keeper, plus five challenges with bronze, silver and gold medals:
  - dribble slalom;
  - shooting at targets in the corners;
  - free kicks over a wall;
  - penalties;
  - crossing and heading.
- Each challenge shows the buttons it needs for your keyboard or controller.
- Best scores stay on the device. In a career, a gold medal earns +1 TP, at most once every 3 matchdays.

### Phones and tablets

- **Opening it**: start the game with `make up-lan`, then on the phone or tablet (same Wi-Fi) open `http://<the computer's Wi-Fi address>:5195`.
- **Menus**: on a phone, and on a tablet held upright, the sections sit in a tab bar at the bottom of the screen like a mobile game, with a slim club header at the top; the HUD numbers scroll sideways.
- **Live matches by touch**: on a touch screen a pad appears over the pitch: a stick on the left (touch anywhere in the left half) and buttons on the right (Pass, Shoot, Through ball, Lob, Sprint, Skill; in defence they become Switch, Tackle, Slide and Press). The ✋ button in the match bar shows or hides it, and it steps aside by itself when you use a controller. Prompts and the tutorial name the touch buttons.
- **Landscape**: held upright, the match pauses behind a "turn your screen" card and carries on when you turn the device. Starting a match asks for full screen in landscape where the browser allows it (Android, iPad); the ⛶ button asks again.
- **Add to Home Screen**: the game has an app icon and opens full screen from the home screen (on an iPhone, Safari → Share → Add to Home Screen gives the full screen).

### One career, one world

Every career is a separate world: its own clubs, players, legends, fixtures, transfer market, news and history. A career is
tied to one club for good — to manage another club, start a new career.

### Troubleshooting

- **`error getting credentials` during `make up`**: the Docker credential helper can't be reached (often a locked keychain). Open Docker Desktop and sign in (or sign out and back in), then try again.
- **Another device can't connect for LAN play**: start the game with `make up-lan` (plain `make up` keeps it on this computer only); both devices must be on the same network; check the address shown in the lobby (run `make up-lan` again if your Wi-Fi address changed) and allow incoming connections in the macOS firewall.
- **The game gets slower after many seasons, or after deleting many careers**: run `make vacuum` while nobody is playing. It compacts the database tables (a few seconds).
- **An older save holds a legend version and his modern self** (from before legend versions merged): `docker compose exec api /api merge-versions <career id>` merges them the way a signing would; the legend takes the shirt number the fans know.
- **Career creation is slow**: the first career on a fresh database takes a few seconds while the planner statistics warm up; later ones take about 2 s.

## Gameplay

**Accounts**: you sign up and log in, and sessions are kept in a cookie. Each account can have several careers. *Season 1* is a career's first season.

**Season calendar (54 matchdays, one match per day)**
- **Domestic league**: each country has 3 divisions of 20 clubs (60 per country, 240 in total). Each division plays home and away over 38 rounds. The bottom 3 of each division swap places with the top 3 of the division below.
- **Domestic cup**: all 60 clubs in the country play straight knockout (first round → last 32 → last 16 → quarter-final → semi-final → final). The 4 biggest clubs enter at the last 32. Draws go to penalties.
- **Continental cup**: the top 8 of each of the 4 top divisions (32 clubs) are split into 8 groups of 4. The top 2 of each group go through to the last 16, then the quarter-final, semi-final and final.
- **Off-season**: up to 4 friendlies for money. Then "Start new season", where promotion and relegation are applied, players get a year older and veterans retire.
- **Unpaid wages**: if the budget goes negative, the highest-paid players hand in transfer requests. If they aren't sold within about 2 matchdays, they leave on their own for another club. The fee (60% of their value) goes into the club's budget.
- **Squad size and game over**: a squad holds up to 50 players. There's no season limit, so you can play forever as long as the club stays solvent. Each extra player adds to the wage bill, though. If walk-outs leave the club with fewer than 10 players, you are sacked and the career ends. The save stays read-only so you can still look back at history and stats.
- **Age**: everyone gets a year older at the start of a new season. Nothing declines before 32; from 32 pace and physical fade, from 34 the other attributes follow, and older players tire faster. A better training centre and fitness coach slow this down. Most players retire between 35 and 37.
- **Legends and custom players** never age, decline or retire, but they improve slowly and TP upgrades cost double. A legend kept at your club gains +1 potential each season, so with time he can reach the same 99 ceiling as the best modern players.
- **Icons** (legends and custom players) can be pushed past 99, up to 110, and it shows in both simulated and live matches. A legend card from your own club's history arrives with +2–3 on every attribute. About half the seasons, the shop opens an **icon pick** once for five matchdays: three icons at a premium (often one from your club's past), sign one or pass.
- **Legend versions**: a legend card is one era of a person, and some of today's stars are the same person as a legend (same name, ignoring case and accents: Mbapé, Vini Juniór, Courtoa/Courtoá and others). Custom players are only themselves.
  - **Card floor**: while his modern self is still playing (at any club), a new legend card is never weaker than him, moved along the career curve to the card's age. The Icon card is at least the modern player as he is today, and a younger era card sits a little below him. This applies to market arrivals, the icon pick and the Legends catalogue. Cards already signed keep their numbers.
  - **Merge**: sign a version while his modern self is in your squad (not on loan) and the two merge: only the legend stays. Every attribute becomes the higher of the two +1 (up to 110). His limit breaks to the higher potential +2, +1 more if the modern player is 78+ or +2 more if he is 85+. He takes the modern player's shirt number. The modern player leaves quietly: no fee, no fans upset, his records kept. It works the other way too: sign the modern player (or have him come back from a loan) while you own a version of him, and he merges into the version that plays. The signing shows a notice, and the club log records it. Computer clubs never merge.
  - **Several versions, one per match**: you may own several versions of one person, but only one of them is in a match-day squad (starting XI and bench). It is the club version (his card from your club's era, home mark ⌂) when he is fit, otherwise the best-rated one. The line-up screen refuses a second version.
  - **Easier limit breaks**: a legend card can break his limit at any level, not only when he is close to his potential. It is still once a season, up to 110.
- **Famous names play where their real selves do**: a legend card plays his role at his peak and is built for it (Messo on the right wing, Trent at right-back, Makelelé holding midfield). Each version plays the role of his era where it differs (Ronalda RW at Sporting and United, LW at Real, ST at Juventus; Maldinni CB in 2005), and the Legends screen shows every card's role. Every legend is one real person under one parody name: made-up names (a second Bale called Gareth Bailey-Spurs, a Rodri clone) gave way to real players (David Ginolá, Fernandinho Rozza, Rui Costta, Diego Costta), and a legend never shares a name a generated regen could have (Thiago Silvaa). Today's stars carry their real role in the club data too (Salha RW, Vini LW, Mbapé ST, Rodrí DM, Reece Jamés RB), whatever their numbers or their shirt. Their numbers stay as they were, so in an older save only the label moves. Everyone else's role comes from his attributes.
- **Staff market** changes every matchday: three to six candidates per role (a few famous names always stay), now and then someone with skill 16–20. Every coach has a special skill (two from skill 15), such as Motivator, Tactician, Big-match coach, Finishing, Set pieces, Youth development, Organiser, Recovery, Injury prevention, Veteran care, Shot-stopping, Quick healing, Talent eye and Negotiator. Each one affects simulated and live matches, training, injuries, morale, ageing or negotiations; hover a chip on the Staff page to see what it does.
- **Staff room** (Team → Coaching staff): your coaches, scout and medical team are people.
  - **Age, character, contract**: each has an age, one of five personalities (Loyal, Ambitious, Teacher, Fiery, Calm) and a contract to the end of a given season. From matchday 30 of his last season he asks for a new deal (1–3 more seasons; if you don't answer, the board signs him for 2). You choose the length when you hire (1–3 seasons plus the rest of the current one). Sacking stays free; a role left empty for 6 matchdays gets a modest stand-in from the board until the end of the season.
  - **Morale** (how he gets on with you): results, pay, bonuses (3 weeks' wage for +12, once every 10 matchdays) and your decisions move it. At 80+ he works as one skill point better, at 30 or below one worse, and below 18 he may walk out.
  - **Experience**: every matchday, a win and a cup tie add experience; a full bar is +1 skill (young coaches have the most room; a second speciality at 15). Coaches of 64+ may retire at the end of a season (never in their first one); you can pay 8 weeks' wage to keep one a year longer.
  - **Past his peak**: his ceiling is a guide, not a wall. At or past it each point takes three times the experience (a gold bar), and his ceiling moves up with him; only 20, the top of the scale, stops him. An **advanced course** (12 weeks' wage, once a season, offered at his ceiling or one point below it) lifts the ceiling by 2 under 50 or by 1 from 50, and the experience he banked at his peak then counts at the usual rate. A head coach of 56 at his peak of 18 reaches 20 in about 3 good seasons with a course each season, about 9 on experience alone.
  - **Decisions**: about seven cards a season, each choice showing its effects, with a default after a few days: another club wants your coach (take the fee, counter with a 25% raise and a coin-flip by his mood, or refuse), the head coach and an assistant argue (training load, a youngster, tactics), a camp or clinic (money for a few days of faster growth or fresh legs), the head coach wants a signing in his weakest position, a coach wants games for a benched prospect, a famous coach out of work wants your job (hire him, or he signs elsewhere).
  - **Mentoring**: each coach mentors one player aged 23 or under (two for a Teacher or from skill 14), who grows 10–29% faster (full with the right specialist, 75% with the head or fitness coach, half outside the coach's field). The mentor shows on the player's card.
  - **The assistant's notes**: the head coach's verdict on the last match and what to work on, who is in form, who needs a rest, which youngster needs minutes, who improved this week.
- **Needs your attention** (Home page, Inbox, and the day report after every match): a list of what needs you, each with a quick fix. It covers a coach who is unhappy or fed up (pay him a bonus from the list), contracts running out (open renewal talks from the list), talks waiting for an answer, unhappy players, a budget in the red, empty staff roles, and decisions waiting in the staff or medical room.
- **Contracts**: modern players sign for 2–4 seasons. From mid-season, anyone in his last year asks to renew via the Inbox: agree a wage and a length (1–5 seasons), or he leaves for free when the season ends. A renewal follows what he is worth today: a rising player asks for the market rate (at most double his old wage in one go), a veteran past his best accepts a pay cut. "Renew" on the Squad page opens talks early, and any open talks can be answered right in the player's panel (or in the Inbox). Icons are signed for good.
- **Hidden development**: every modern player is secretly a flop, slow, normal, fast or a wonderkid. Flops train at a crawl and their ceiling drops each summer. Asking prices swing too: some players are bargains, some are hyped, young talents most of all. The class shows once a good scout or five games for your club reveal it.
- **Next generation**: when a star (78+) retires, a teenage "Jr." with a similar ceiling turns up at a club in your league, so the world never runs dry.
- **Sponsors and money**: five sponsor slots (main shirt, sleeve, stadium name, kit maker, partner), each with a target bonus and a league-position clause (three matchdays below it and the sponsor walks). You can end a deal by paying an exit fee, and better offers arrive mid-season. Sponsors sometimes put up a hot bonus on a match ("win this one: +€2M"). Shirt sales grow with your stars, icons most of all. The board sets a season objective with a bonus or a cut.
- **Chance cards**: every few matchdays a board-game style card lands: sold-out shirts, an Asia tour, fines, tax audits, lawsuits, or choices such as "pay the fine or appeal (50/50 cleared or doubled)".
- **Billionaire takeover**: rarely, an investor offers €50–200M on condition you reach Europe (or win promotion) within two seasons; miss it and they pull half back out.
- **Loans and shares**: banks lend up to €3M per reputation point (the bigger the loan, the lower the rate, from 10% down to 5%, over a longer term). You can sell up to 49% of the club in 10% blocks; shareholders take a dividend from every matchday's revenue, and buying a block back is a negotiation.
- **Facilities wear out**: anything above level 1 slips a level after one to three seasons unless you upgrade it again.
- **Inbox**: wage demands, renewals, chance-card choices, sponsor offers, the icon pick and takeover bids all wait in the Inbox page. You get a short message when something new arrives. The Inbox shows this season only (last season's awards and news are in the club's history), and anything about a player you have just sold, swapped or released leaves the Inbox at once.
  - **Mail tags**: every mail about a person starts with two tags, so you never answer the wrong one. The first says who it is about: *Player* (green), *Icon* (gold, for legend cards and players you designed) or *Coach* (blue; physio, doctor and scout get their own word). The second says what it is: *Transfer bid*, *Wants a raise*, *Contract renewal*, *Wants to play*, and for the staff *Retiring*, *Clash*, *Training idea*, *Wants a signing* (your coach asks you to buy someone), *Youth tip* or *Wants to join*. A club after one of your coaches is a *Transfer bid* too. The card's left edge has the who colour, an icon's card glows gold, and the same tags mark the *Needs your attention* lines. Buttons that cannot be undone name what they do on the second click: "Sell icon Andrés Iniestra · €123M", "Release …", "Let … go", "List … for sale".
- **Wage demands**: across a season, 1–4 ordinary players ask for a raise: most often those who have outgrown their wage (one raise is at most +60%, so a fast riser may ask again later), otherwise 8–20%. Players already paid what they are worth don't ask. Well-paid players, legends and custom players ask for a small 4–10% raise about once every one or two seasons (at most two of them a season), and are easy to talk round. Staff at a winning club ask now and then. You can accept, haggle (twice at most; he comes down a little each time; a bar shows the chance he agrees to your offer), refuse, or release / let him go. If you refuse or don't answer within 4 matchdays, a player loses morale and may force a move, and a coach may walk out.
- **Fitness and injuries**: injury risk rises with low fitness, high pressing, injury-prone players and midweek games (cup and continental ties between league rounds cost 25% more fitness). Ways to manage it:
  - **Substitutions**: up to 5 per match. In simulated matches the bench comes on automatically for tired or rushed players; in live matches use the ⇄ Subs button.
  - **Rotation** (Squad page): before each match, starters below 50/60/70% fitness are rested for the freshest bench player in the same slot. Your saved lineup is not changed.
  - **Bring on first** (Tactics bench list, or a player's card on the Squad page): mark up to 5 bench players you want to see play, so they get minutes and improve. When changes are made, your assistant brings them on first, around minutes 55–70, each for the most tired man in his line (a keeper for the keeper), using up to three changes a match. A marked player far below the man he would replace (under 60% of his rating in that role) stays on the bench, and the page says so. Whoever has waited longest for a game comes on first (the number on his button), so marking several shares the minutes out. It works in quick sims, in watched matches and whenever the computer plays for you; when you play yourself, the bench list puts them first and a tip around the hour offers to bring one on. The day report marks who came on this way. The quick sim rates the starting eleven, so the result is unchanged; the players you take off lose those minutes instead.
  - **Training load per player**: Rest, Recovery or Intense instead of the team intensity.
  - **Medical centre** (Finance → Facilities): each level cuts injury risk by 8% and speeds up recovery.
  - **Rush back**: a player with one week left out can play at about 85% of his level, but risks a longer setback.
- **Injuries and the medical room** (Team → Medical):
  - **18 kinds of injury in four tiers.** Light, 1–2 weeks: dead leg, ankle sprain, calf, back, concussion, finger. Medium, 2–6 weeks: hamstring, groin, knee ligament, shoulder, rib. Serious, 4–11 weeks: meniscus, metatarsal, torn ankle ligaments, pubalgia. Career-threatening, 18–38 weeks: cruciate ligament, Achilles, broken leg. Tired legs tear muscles, keepers hurt hands and shoulders, older players break worse. Long injuries carry over the summer (which heals 8 weeks).
  - **Icons are never career-threatened.** For an icon (a legend card, or a player you designed) the worst a horror tackle does is the serious injury of the same part: a torn meniscus instead of a cruciate, torn ankle ligaments instead of an Achilles, a metatarsal instead of a broken leg (1–3 months at most). Icons never keep lasting damage either.
  - **After a lay-off** a player is rusty (up to 18% below his level) until minutes and training bring him back, and he is fragile for a while: the same injury can come back, sometimes worse.
  - **Lasting damage**: serious injuries can take attributes and potential away for good (a cruciate ligament or broken leg costs pace and physical; an Achilles costs pace; a keeper's shoulder or finger costs goalkeeping), so a player may never get back to his peak. **Frequent injuries wear the body down**: past each wear threshold pace and physical slip, and he can become injury-prone.
  - **Decisions** (each has a default if you ignore it): rest, surgery or a painkilling injection for a serious injury; surgery at home or a specialist abroad for a career-threatening one; **elite surgery** for either (see below); a scan when the doctor isn't sure; easing a player back or straight into the team; the doctor's warning before a match; a player hiding a knock; flu in the dressing room; a rehab block for a worn body.
  - **Elite surgery** (very expensive): the world's best surgical team flies in. After a serious or career-threatening injury the player is back in about a third of the time (a 30-week cruciate becomes 11), with no lasting damage, hardly any setbacks and no complications. It costs 12% of his value for a career-threatening injury (€3M–25M) and 8% for a serious one (€1.5M–12M), with no discount for your medical centre. Choose it on the treatment card or later, from his bed in the treatment room, while he still has 3 weeks or more to go (it replaces the first treatment). The doctor advises it for an icon, or for a player worth €30M+ facing most of a season out, when the budget covers it three times over; left alone, the club never pays for it.
  - **Medical team**: the team doctor (diagnosis, surgery, warnings; a weak one can misread a serious injury), the physio (shorter lay-offs, fewer setbacks) and the fitness coach (prevention). The medical centre adds a scanner (level 3), a rehab pool (level 4) and a modern operating theatre (level 5). Computer clubs get the same injuries and lasting effects.

**Players**: each player has 7 attributes plus potential, fitness and morale. Squads start with about 25 players (50 at most).
- **Growth comes from playing**: players improve mostly in matches. A full 90 minutes brings the most; a substitute counts his minutes (plus a little for coming on); a good game (rated 7 or more) and big nights (European games) bring more, a friendly half as much. Daily training adds only a little (about a quarter of a match's worth), shaped by the focus, the training intensity, the training centre and the relevant coach. A gifted 17-year-old who starts every week gains about 6 overall points a season; one who comes off the bench gains 2–4; one who never plays gains 1–2. Growth slows as a player nears his potential, and from the mid-20s players improve by about a point a season. No room for a youngster in your team? Loan him out: regular football elsewhere brings him on.
- **Upgrade points (TP)** are earned on the pitch: +1 TP for every match and +1 more for a win, plus achievements, manager levels and training-ground gold medals. You can buy at most 30 TP a season (500 000 each). Spend TP on +1 to an attribute or to break a player's limit (+1 potential): only once his overall is within 2 of his potential, and once a season per player.
- **Potential is a guide, not a wall**: below it a player grows easily and a TP upgrade always takes. Past it he still grows, more slowly the further past, and an upgrade may not take: 75% at his potential, 10 points less for every point past it, never under 15% (icons: 85%, 6 points less, never under 30%); the TP are spent either way. A young legend version's potential is the player's peak, so he can grow into the player he became.
- **Assistant picks the team** (Tactics page switch): before every match the assistant fields the 11 strongest available players for your formation. Changing a player yourself switches it off.
- **Fatigue and injuries**: low fitness, high pressing and hard training all raise the injury risk. Injured players can't play.

**Chemistry (per formation)**: each position scores from 0 to 10.
- **Natural position**: up to 4 points.
- **Links with neighbouring players in the formation**: up to 3 points, for sharing a nationality or a former club.
- **Matches played for the club**: up to 3 points.
- **Formation familiarity**: added on top.

The lineup screen marks low-chemistry positions and explains why. Chemistry affects both simulated and live matches.

**Match odds**: the win / draw / loss chances on the Match Centre come from the quick simulation's own model, the one that plays the match when you simulate it: the starting elevens (attributes, positions, fitness, morale), chemistry, the coach, tactics, home advantage, the weather and the occasion (cup and continental nights, the captain, the press conference, the crowd). They update when you change the line-up, the tactics or answer the press, and the tooltip shows the expected goals.

**Lower divisions** spread like real second and third tiers: in a new career a club loses 0.75 of strength per place in Divisions 2 and 3 (it was 0.4, and a second-tier title race was nearly a coin toss), so a strong side finishes in the 80s and a weak one fights the drop. The poorest club still has €2M to spend. An existing save keeps its clubs, youth intakes and market levels. Measured over thousands of simulated matches, a side shown at 80% wins about 79% of the time, draws 14% and loses 7%; luck still counts, but less than before.

**The computer** plays according to its formation and tactics. How well it plays depends on its players' stats and chemistry. Difficulty only shifts the baseline.

**Transfers**
- **Free agents**: purchases are guaranteed to go through. The ordinary free agents are replaced after every matchday. There is nearly always a legend card (Messo, Ronalda, …) or one of your custom players on the market, and it changes every one or two matchdays, so the legend you want comes round during a season. He sits at the top of the list and the day report announces him.
- **Deals with computer clubs**: buy, sell or swap. You set your own price and see the success chance before you send the offer. Ways to raise the chance are a better price, hiring an agent, a higher club reputation, and the other club needing that position. One attempt per player per week.
- **Release**: guaranteed sale for 70% of the player's value.
- **No instant flips**: for 30 matchdays after you buy a player, other clubs pay at most what you paid for him (sales, swaps, releases and bids alike). A bargain can't be sold on straight away at full value, and a youngster has to play and grow before he is worth more.
- **Custom players**: you can design up to 20 players.

**Money**
- **Income**: tickets, TV rights, stadium advertising, sponsorship (choose one of 3 contract types: safe, balanced or performance-based), win and goal bonuses, prize money, friendlies and quests.
- **Costs**: weekly wages for players and coaches.

**Quests**: you always have 3 open quests (win streaks, clean sheets, hat-tricks, and so on). Claim the reward to get a new one.

**History**: every match played, each season's summary (league position, cup runs, top scorer, best player, champions), all-time club records and club legends.
- **Legend**: 100+ matches, 50+ goals or 40+ assists.
- **Icon**: 50+ matches, 25+ goals, 20+ assists, or an average rating of 7.5 or higher over 25+ matches.

### Kits

- **Every club has three kits** (home, away, third) in its real colours: stripes, hoops, halves, quarters, a sash, a chevron, contrast sleeves, a centre stripe or a chest band, with their own shorts and socks. Clubs in all four countries and the world leagues wear their traditional designs.
- **Kit room** (Club → Kits): design your own three kits. Pick a pattern, colours for the shirt, the pattern and trim, the shorts and the socks (30 swatches or any colour), start from 18 classic designs, swap colours or roll a random kit. You can make the home shirt your club colours (badge and screens) too. It also shows what both sides will wear in your next match.
- **In matches**: the home side wears its home kit; when the colours clash, the away side changes into its away or third kit. Before a live match you can pick your kit yourself (auto, home, away or third) and the opponent adapts. Quick matches and Legends XIs wear their clubs' kits.

### Club life, discovery and the living world

- **Press conferences** before cup ties, derbies and about one league game in five (bold / calm / mind games), settled after the result. Tired of answering? Let your assistant answer every one in the style you pick: Match centre → "Pre-match press conferences" (or the press card itself).
- **Squad life**: benched players ask for playing time (promise, ask to wait, or sell); a captain with a real effect.
- **Youth intake day** once a season (3–5 academy prospects to sign or release).
- **Derbies** against a fixed rival (same city first), with a bigger gate and bigger morale swings.
- **Weather** per match (clear, rain, snow, heat), which affects simulated and live matches.
- **Awards**: player of the month, end-of-season awards and a team of the season.
- **Manager level and XP**, with small perks.
- **International breaks**: your best players are called up.
- **Loans in and out**, and AI clubs bidding for your players (now and then, more often for a player you list for sale, and one or two late offers on Deadline Day).
- **Extra time and penalty shoot-outs** in knockout ties, simulated kick by kick (shoot-out scores are shown with the result).
- **Explore**:
  - scouting missions to 14 regions that uncover hidden gems (revealing their development class). A trip watches a few of the region's clubs (more for a better scout), and every report draws its grade first: Diamond about 2–6%, Epic about 11–20%, Rare 45%, the rest Common, a little higher for a better scout or one with a scout's eye. Scouting a region again and again does not make the top grades common;
  - 49 achievements with rewards and wearable titles;
  - a trophy room with the story of every final, records and a hall of fame;
  - your manager reputation ladder;
  - an album of all legend cards;
  - a congratulations screen when you win a trophy or get promoted.
- **The living world**: the computer's clubs buy and sell among themselves in the summer window and on matchdays 24–29, sack managers who fail, and earn money each season. Explore → News lists every move, with the headlines highlighted.
- **Fans**: a supporters' mood from 0 to 100, shown on the hub as a face with a fan chant, banner or post that changes after every matchday.
  - It moves with results against what the fans expected (derbies count double), streaks, cup runs, promotion or relegation, star signings, selling the fan favourite, and the ticket price.
  - Happy fans fill the stadium (tickets ×0.85–1.12) and buy more shirts (×0.9–1.1). At 80+ the home crowd lifts your team in simulated home games; at 20 or below it weighs on them.
- **Pre-season tour**: each summer, pick one of three cards in the off-season panel:
  - a far trip: money and shirt sales, but the squad starts tired;
  - a local tour: fans, morale and chemistry;
  - a mountain camp: costs money; fitness and fewer injuries early on.
  Skipping is fine.
- **Deadline Day**: on matchday 29, and on the first matchday of every new season (from season 2), the transfer window closes. Late bids arrive for your players, and one or two "today only" bargains appear on the hub.
- **Legends wall**: at the end of every season the fans put two current players on the wall: the most deserving ones (appearances + 20 per trophy + 10 per season) with 250 games for the club, or 7 seasons or 6 trophies with at least 150 games (a hundred-odd games makes a good servant, not a legend). Icons, who never leave or retire, get there the same way. Anyone else with such a record joins when he leaves or retires. The wall shows its active legends first, with live numbers.
  - **Retiring a number**: possible for a legend still at the club (he keeps wearing it, nobody else ever will) or one who retired here. A player who was sold or let go cannot have his number retired.
  - **Selling a legend**: the fans are upset, and if his number was retired it goes back into use.
- **Shirt numbers**: every club numbers its squad like a real one, and numbers stay low however much you buy and sell.
  - **A newcomer** keeps his old number if it is free and suits him, or takes the free classic number of his role when he is good enough to start: 1 keeper, 2 and 3 full-backs, 4 and 5 centre-backs, 6 holding midfielder, 8 midfielder, 10 playmaker, 7 and 11 wingers, 9 striker. Otherwise he wears a number his line usually wears (13 a keeper, 15 a defender, 16 a midfielder, 19 a forward) or the lowest free one from 12. A player back from a loan gets his old number back if it is free.
  - **Each new season** the squad is tidied: nobody on a number above 40 or one that doesn't suit him (a keeper on 9), and a classic number left free goes to the best player of that role, so your new first-choice striker inherits the 9.
  - **Your own pick**: open a player in the squad and choose any free number, or a teammate's (they swap). A number you pick stays through the tidying. Retired numbers are never handed out or picked.
  - Saves from before this got their numbers put in order once.
- **Golden Ball night**: after the last matchday, a ceremony reveals the Golden Boot, Golden Glove, Golden Boy, Manager of the Year and the Golden Ball (10 → 1).
  - A first Golden Ball lifts the winner by about one overall point; every winner gets full morale.
  - It lifts your club's reputation if the winner is yours.
  - Replay the nights in Explore → News.
- **International tournaments**: a World Cup after seasons 1, 5, 9… and a European Championship after seasons 3, 7….
  - 16 national teams are built from the world's best players by nation.
  - Called-up players come back tired, happier or sadder depending on how it went.
- **Cup draws**: when you are drawn in a knockout round, a short draw ceremony shows your opponent a few matchdays ahead.
- **Storylines**: title races, relegation fights, streaks, scoring races, cup shocks and managers under pressure appear in a ticker on the hub and in the world news.

### The live match

**Modes** (pre-match screen):
- **Play**: you against the computer. Both sides start from the balance of strength the quick simulation uses; on normal nothing else tilts the match, so your own play makes the difference. Hard makes the computer's side stronger. Career matches have no Easy: the result counts, so playing it can't be easier than simulating it (a saved Easy setting plays as Normal). Easy is still there in quick matches.
- **Watch**: the computer plays both sides at full length, as strong as the quick simulation has them (form, morale, fitness, home advantage), so you win, draw and lose about as often as its odds say. Difficulty plays no part. Shorter matches end level a little more often (fewer goals), longer ones a little less, and a squad can still do slightly better or worse than the odds because the live engine sees players and play styles in its own way. You can pause, run at 1×/2×/4×, take control or simulate the rest.
- **2 players**: two controllers, or keyboard + controller. Press Options/☰ on a pad to claim P1 or P2.

**Looking away**: the match keeps running when you switch to another tab, another window or another desktop; only the pause button (or the menu) stops it.
- While you are away, the computer plays for your team, and a banner says so. Press any key or button, or touch the pad, to take over again.
- If the browser froze the page (a phone in your pocket, a suspended tab), the time it missed is played through as soon as the page is back, without sound or replays.
- The same goes for quick matches. A Wi-Fi guest keeps playing and keeps getting the picture.

Other options:
- **Match length:** 3, 5 or 8 minutes.
- **Difficulty:** easy, normal or hard.
- **Camera:** four views, TV (3D), Follow, Close and Tactical. Switch with C or D-pad ←→.

**Presentation**:
- **Before kick-off:** the teams line up with crests, competition, weather, derby and the opponent's play style; any button starts.
- **During the match:** a TV scoreboard flashes each goal. After your goal, pick a celebration (knee slide, aeroplane, backflip, point to the sky: keys 1–4 or the face buttons), or the scorer picks one. Continental nights are floodlit, and the crowd wears the home colours.
- **At full time:** man of the match, ratings for both teams, stat bars, a goals timeline and every goal again (*Watch highlights*), then Save.

**Play styles and legends**:
- Teams play their style: tiki-taka keeps the ball, high pressing hunts it, counter-attacking sides sit deep and break, direct sides go long and cross.
- Legends and custom players pull off skill moves more often. Each has a signature move, shown in the pause menu, with a slow-motion moment.

**How players move and think**:
- **Pace matters**: top speed runs from about 6.8 m/s (pace 50) to 9.6 m/s (pace 99), a quick player also gets going faster, and the ball costs a dribbler only 3–8% of his speed. Fatigue slows a player by up to about 16%. A winger is not out of position on the flank of a midfield four (LW in an LM slot, and the other way round), in live and simulated matches alike.
- **The computer's attack**: it shoots when the chance is worth it (a long shot needs a long-range shooter with time and space), squares it or cuts it back to a teammate in a better position, plays one-twos around the box, and sends runners between the centre-backs and to the edge of the box against a deep defence. It carries the ball at a controlled pace and runs at full speed only on a real break.
- **The team's shape** eases between attacking and defending instead of jumping, a loose ball does not send everyone the other way, at most three players press (the centre-backs hold the line unless the ball is near the box), the same man keeps pressing and marking his man, and only midfielders and forwards come short in their half.
- **Ends**: the teams change ends at half time (and for the second half of extra time); every shoot-out kick is at the same goal.

**Help for beginners**:
- Pass assist, shot assist and auto-switch are on by default on easy and normal; change them before kick-off or in the pause menu.
- Your first live match starts with a six-step tutorial. Skip it, or replay it from the pause menu. The match plays as usual meanwhile (the result counts).
- Difficulty only changes the computer's side: easy (quick matches only) is relaxed, hard is a real fight.

**Rules**:
- Fouls are given for late or mistimed tackles and tackles from behind (a missed challenge on a quick dribbler is often one, and a clumsy one in the box gives a penalty).
- Offside: runners now and then go too early and the flag goes up (a run timed just wrong is hard for the passer to read).
- Yellow and red cards (a second yellow, or a last-man foul); sent-off players leave the pitch.
- Advantage, offside and injuries.
- A knockout tie that is level after 90 minutes goes to extra time (two short halves, heavier fatigue), then a shoot-out: five kicks each, then sudden death.

**Attacking**

| Action | Keyboard | PlayStation | Xbox |
|---|---|---|---|
| Move | WASD / arrows | left stick | left stick |
| Sprint | Shift | R2 | RT |
| Ground pass | J | ✕ | A |
| Through ball | L | △ | Y |
| Lob / cross | I | □ | X |
| Shoot (hold for power) | K | ○ | B |
| Shield / close control | Space | L2 | LT |
| Skill moves | hold U + direction | flick the right stick | flick the right stick |
| Mentality (defensive / balanced / attacking) | 1 / 2 / 3 | D-pad ↑↓ | D-pad ↑↓ |
| Camera | C | D-pad ←→ | D-pad ←→ |
| Pause and menu (stats, tactics, subs, controls, skill list) | P / Esc | Options | Menu |

Modifiers use Q (L1/LB) and E (R1/RB):

| Combination | Move |
|---|---|
| Q+J | one-two (pass and go) |
| Q+L | lofted through ball |
| E+K | finesse shot |
| Q+K | chip |
| Q+E+K | low driven shot |
| E+J | driven pass |
| E+I | low cross |
| Q+I | early cross |

- **Fake shot:** press pass while charging a shot.
- **Knuckleball:** hold shoot and press through ball (K then L): struck dead, it wobbles in the air and dips late, and keepers read it late. Best from distance.
- **Trivela:** hold shoot and press lob (K then I): the outside of the boot, it bends the other way from a finesse shot.
- **First time:** press pass or shoot before the ball arrives to play it first time (volleys and headers).

**Skill moves** depend on the way the player is facing, and their success depends on dribbling and the flair trait:
- feint, drag-back, knock-on (with sprint), stepover, Cruyff turn (↑ ↓);
- ball roll, roulette, McGeady spin, La Croqueta (→ ↓), elastico, rainbow flick.
- **Shielding** (Space / L2 / LT) is a strength contest: a stronger player holding the ball up is harder to dispossess from behind.
- The player a pass is meant for runs onto it by himself while you keep holding the direction you passed in (control jumps to him at the kick).

The full list is in the pause menu.

**Defending**

| Action | Keyboard | PlayStation | Xbox |
|---|---|---|---|
| Contain (hold) | Q | ✕ | A |
| Tackle | K | ○ | B |
| Slide tackle | L | □ | X |
| Switch to nearest / by direction | J / U + direction | L1 / right stick | LB / right stick |
| Call a teammate to press (hold) | I | R1 | RB |
| Jockey (hold) | Space | L2 | LT |
| Keeper rushes out | E | △ | Y |

**Set pieces and penalties**
- **Set pieces:** aim the reticle, with a preview of the ball's flight, and curl with the right stick or Q/E. This works for corners, free kicks (wall, direct shot or cross), throw-ins and goal kicks.
- **Penalties:** aim up/down and hold shoot for the run-up and power.
  - Panenka: Q+K, or I (□/X) on its own.
  - Stutter: Space (L2).
  - As the keeper, hold a direction to dive or press a button to go early.

**Controllers**: plug in or pair a PlayStation or Xbox controller (Bluetooth works) and press any button. This works in Chrome, Edge and Firefox through the Gamepad API. The controller also drives the menus outside matches.

If you leave mid-match, the match is saved in the browser. When you come back, the Match Centre lets you **Continue** or **Forfeit** (a forfeit counts as a 0-3 loss).
