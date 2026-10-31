# Castle Tower Defense

A multiplayer tower defense for 1–4 players — play **with** each other (co-op) or
**against** each other (free-for-all or 2v2 teams, sending troops at your opponents).
Everything runs locally: one Node server hosts the game for your PC and anyone on your
LAN. Nothing is deployed anywhere.

- Server-authoritative simulation (20 ticks/s) — clients only send intents and render.
- Accounts, guests, friends with live presence, in-app invites, invite links, public game browser.
- 4 maps ("levels"), 15 towers × 3 levels, 15 regular enemy types + 5 bosses, 3 difficulties.
- A Supercell-style meta game: two ranked trophy ladders (Duel 1v1 and Team 2v2) with
  matchmaking + bot backfill, 7 arenas, a Trophy Road, card collection & levels, loadouts,
  reward drops, chests, player levels, daily/weekly quests, a season pass, a daily shop,
  emotes, co-op campaign stars, Endless co-op and leaderboards. **No real-money purchases
  exist anywhere — gems are earned in-game only.**

## Quick start

Requires Node 20+ (tested with Node 24).

```bash
npm install
npm run play        # builds the client, then starts the server on port 4777
```

Open **http://localhost:4777**. The server log also prints a `LAN:` URL for every network
interface (the most likely "real" Wi-Fi/Ethernet address first).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run play` | `build` + `start` with `DEV_TOOLS=1` — the one-command way to test |
| `npm run dev` | server with `tsx watch` on 4777 (`DEV_TOOLS=1`) **and** Vite dev server on **5180** (hot reload). Open http://localhost:5180 |
| `npm run build` | build the client to `dist/client` |
| `npm start` | start the server (serves `dist/client` if it exists); dev tools **off** unless `DEV_TOOLS=1` |
| `npm test` | unit + integration + balance tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run balance` | co-op balance tables + ranked bot-vs-bot win rates (`-- --all-maps`, `-- --games 200`, `-- --skip-coop`, `-- --skip-ranked`) |

Data (accounts, sessions, friends, stats, progression) is stored in `data/db.json`
(gitignored, written atomically). Delete it to start fresh. `PORT` and `DB_PATH` env vars
override the defaults.

## Testing multiplayer on one PC

Each browser **tab** has its own identity (the login token lives in `sessionStorage`), and the
last login is remembered in `localStorage` so a brand-new tab logs in automatically.

1. Tab 1: register (or play as a guest) and create a game.
2. Tab 2: open the app. It will auto-login as your last account — click **Switch account**
   (top right) and register a second account or play as a guest. *Switch account* only
   forgets the identity in that tab; *Log out* also invalidates the session.
3. Join with the room code, the invite link, or (for accounts) add each other as friends and
   use the in-app **Invite** button.

A private/incognito window works too (it has its own storage).

## Playing with friends on your LAN

1. Run `npm run play` on your PC.
2. In the lobby, the **LAN link** is shown prominently when you're viewing the page on
   `localhost` (a `localhost` link is useless to anyone else). Send that link — e.g.
   `http://192.168.1.20:4777/join/ABC234` — or the 6-character room code.
3. If the address shown is wrong (VPN/virtual adapters), pick another one from the dropdown
   under the link.

**Windows Firewall:** the first time Node listens on the network Windows asks whether to
allow it. Tick **Private networks** and click *Allow*. If you dismissed it, allow
`node.exe` in *Windows Defender Firewall → Allow an app through firewall*, or run (as admin):

```powershell
New-NetFirewallRule -DisplayName "Castle TD 4777" -Direction Inbound -Protocol TCP -LocalPort 4777 -Action Allow -Profile Private
```

Your network must be set to *Private* (not *Public*) in Windows network settings. In dev mode
LAN devices use port 5180 instead.

## Social features

- **Accounts**: username 3–16 chars (`A–Z a–z 0–9 _`, case-insensitive unique), password ≥ 4
  chars (hashed with scrypt + per-user salt). **Guests** pick a display name; they can join
  by link/code and play normally but can't have friends and their stats aren't saved.
- **Friends**: send by username, accept/decline, cancel, remove. If two people request each
  other the request auto-accepts. Presence is live: offline / online / in lobby / in game.
- **Invites**: in a lobby, every online friend has an *Invite* button. The friend gets a
  popup ("*X invited you to Co-op on Greenfield*") with Accept/Decline; invites expire after
  60 s or when the room disappears.
- **Invite links**: `<origin>/join/<CODE>`. Opening one logs you in (or asks you to) and
  joins automatically; full, missing and already-started rooms show a clear error.
- **Public games**: the host can make a room *Public*; it then appears in *Browse public
  games* for everyone with the app (live updates).
- **Stats**: games played, wins and best co-op wave per map + difficulty.

## Lobbies

Up to 4 players, colours blue / red / green / yellow. The host picks mode, map and
difficulty, can kick, and starts when every other player is ready:

- Co-op: 1–4 players · FFA: 2–4 · Teams: 2–4 split into two non-empty teams.

If the host leaves, the next player becomes host; empty rooms are deleted. If you refresh or
drop, your slot is held (60 s in a match, 20 s in a lobby) and you're put straight back into
the match. Your towers keep firing while you're away.

## Game modes

1. **Co-op** — everyone defends one shared board. Build anywhere; towers show their owner's
   colour and only the owner can upgrade/sell them. Shared lives, separate wallets. Win by
   surviving the map's final wave (Greenfield 20, Canyon Run 25, Crossroads 30, The Spiral 40).
   Everyone pressing **Ready** starts the next wave early (+10% of the wave bonus); **×2**
   speed applies when every player has it on.
2. **Versus — Free-for-all** — each player defends their own copy of the map; identical AI
   waves hit every board at the same time (first at 25 s, then every 30 s). Spend money to
   **send troops** at an opponent (pick the target from the dropdown or click their
   mini-board; default is the next alive player clockwise). Troops arrive after a 2 s
   "INCOMING" warning. Last player standing wins; eliminated players can keep spectating.
3. **Versus — Teams 2v2** — each team shares a board (co-op style) and sends at the other
   team's board. Last team standing wins.

## Balancing model

`k` = number of players defending a board, `defenderScale(k) = 1 + 0.6·(k−1)` (1.0, 1.6, 2.2, 2.8).

| Thing on a board with k defenders | Scaling |
| --- | --- |
| AI wave enemy **count** | × defenderScale(k) (spawn spacing ÷ defenderScale, same wave length) |
| Enemy HP | × (1 + 0.05·(k−1)) — a small tax for coordination benefits |
| Troops **sent** to the board | × defenderScale(k) of the *target* — "armies are bigger when you're together"; sent units use the current wave's HP scaling |
| Kill bounty | goes into a pot split evenly between the defenders → team bounty income scales with enemy count |
| Start cash per player | soloStart × defenderScale(k) / k |
| Wave bonus per player | soloBonus(wave) × defenderScale(k) / k |
| Board lives | base lives × defenderScale(k) (rounded) |

So total team resources scale exactly with the enemy count, and a dollar spent on sending
buys the same threat-per-defending-dollar whatever the team size — 2v2 and FFA stay
symmetric. Two details: counts are rounded (1 boss × 1.6 = 2 bosses) and each unit's HP is
multiplied by exact/rounded (0.8 here) so the total HP is exact; and lives scale with
defenderScale too, otherwise 2.8× as many enemies would make a 4-player board 2.8× more
fragile to the same leak *fraction*.

Sent troops pay only 50% bounty (`sentBountyFactor`), and every send permanently raises the
sender's **income**, paid at each wave start on top of the wave bonus — the classic
"eco vs. defence" trade-off. Difficulty: Easy (HP ×0.8, 40 lives, +20% cash), Normal
(×1.0, 25 lives), Hard (×1.3, 15 lives, −10% cash). HP grows each wave and accelerates
after wave 30 so long versus games end.

All numbers live in [`src/shared/config.ts`](src/shared/config.ts). `npm run balance` runs a
headless greedy bot (fast-forward, no wall clock) per player:

```
Co-op balance — Greenfield (final wave 20), greedy bot per player
players |           Easy |         Normal |           Hard
      1 |   WIN 20 (40♥) |   WIN 20 (25♥) |       lost @15
      2 |   WIN 20 (64♥) |   WIN 20 (40♥) |    WIN 20 (2♥)
      3 |   WIN 20 (64♥) |   WIN 20 (26♥) |       lost @15
      4 |   WIN 20 (74♥) |   WIN 20 (19♥) |       lost @15
do-nothing player (Normal): survived 2 wave(s), lost on wave 3
```

## Towers & enemies

| Tower | Cost | Notes |
| --- | --- | --- |
| Archer (1) | $100 | fast single target |
| Crossbow | $175 | anti-air specialist; ×1.65 damage to air, can still shoot ground |
| Builder Hut | $225 | dispatches a worker who travels to damaged buildings and repairs them |
| Cannon (2) | $200 | shells travel and explode (splash) |
| Frost (3) | $150 | ground only; slows (strongest slow wins, no stacking); L2 splash, L3 ground pulse |
| Sniper (4) | $300 | ground + air, range 7, ignores armor |
| Tesla (5) | $350 | ground + air; chains 3/5/7 targets, −20% per jump |
| Gold Mine (6) | $250 | +$25/60/110 to its owner each wave, max 3 per player |

Each attacking tower has a targeting mode (First / Last / Strongest / Closest). Selling
refunds 70% of everything invested. Armor reduces each hit but a hit always does at least
20% damage. Archer, Tesla, Sniper and Crossbow can target flying enemies; Archer deals 55%
damage to air, Tesla and Sniper deal full damage, and Crossbow deals 165%. Other attacking
towers are ground-only.

Every defensive building has structure HP. Raiders, Shades, Stone Golems, Siege Titans and
Dread Colossi stop near buildings to attack them; a destroyed building frees its tile for
rebuilding. Select any damaged allied building to pay for an instant full repair. Builder Hut
workers automatically travel across the map to the most damaged allied structure, repair it
over time, and return home when no building needs work.

The 15 regular types are Grunt, Runner, Swarmling, Knight, Brute, Healer, Splitter,
Splitling, Shieldbearer, Raider, Stone Golem, Shade, Cave Bat, Harpy and Armored Drake.
Cave Bats, Harpies and Armored Drakes fly. Boss waves introduce Warlord (10), Siege Titan
(20), Storm Roc (30, flying), Dread Colossus (40), then the toughest boss, Void Dragon
(50, flying). Later boss waves continue using the Void Dragon encounter.

## Controls

| Input | Action |
| --- | --- |
| `1`–`6` or click a shop card | choose a tower to build (ghost + range preview, green = valid) |
| Left click | place tower / select tower · **Shift**-click to keep placing |
| Right click / `Esc` | cancel build or selection |
| `U` / `S` | upgrade / sell the selected tower (expensive sells ask to confirm) |
| `Space` | co-op: Ready / call the next wave |
| `E` | emote wheel (3 s cooldown; everyone in the match sees it) |
| `Enter` | open chat |
| `` ` `` (backtick) | toggle the Dev panel (only when the server runs with `DEV_TOOLS=1`) |
| Click an opponent mini-board | versus: make it your send target (when eliminated: spectate it) |

## Progression & competitive layer

After logging in you land on the **home hub**: top bar (icon, level + XP bar, coins, gems,
Duel/2v2 trophies) and a bottom nav — **Shop · Collection · Battle · Social · Progress** —
with red badges wherever something is claimable or upgradable. Guests can still play friendly
lobbies; everything below needs an account. All numbers live in
[`src/shared/progression.ts`](src/shared/progression.ts); all rules run on the server
(`src/server/progression/`), the client only asks.

### Ranked, trophies, arenas
- **Ranked Duel (1v1)** uses the FFA versus rules with 2 players; **Ranked 2v2** uses the team
  rules. Ranked ruleset: first wave at 15 s, waves every 20 s, Normal difficulty, and from
  wave 19 on every wave gets ×1.15 HP ("sudden death") — matches run ~6–9 minutes.
  The map is random from those unlocked in the lower player's arena. Ranked uses your real
  card levels.
- Two ladders (`duel`, `team`) with highest-ever values. Win = `clamp(30 + (opp − me)/25, 20, 40)`,
  loss = −`clamp(26 + (me − opp)/25, 15, 35)`, losses halved under 300 trophies. In 2v2 `opp`
  is the opposing team's average. You can never drop below the gate of an arena you've reached.
- **Arenas** (by the higher ladder, permanent once reached): Meadow Outpost 0, Canyon Fort 300,
  Frost Keep 700, Thunder Peak 1200, Shadow Citadel 1800, Dragon Spire 2600, Legendary Arena
  3500. Each adds towers/troops to the drop pool and maps to the ranked rotation.
- **Matchmaking**: in-memory queue per ladder, closest trophies within ±100, widening +50 every
  3 s. 2v2: queue solo (random teammate), as a party (invite a friend from the Battle tab or
  the 🤝 button in the friends list), or press **"Queue ranked 2v2 together"** in a 2-player
  lobby. Disconnecting/forfeiting a ranked match is a loss (reconnecting within 60 s is fine).
- **Bot backfill**: if no human fits within **12 s**, empty seats — opponents *and* 2v2
  teammates — are filled with bots (plausible names, trophies within ±60 of yours, card levels
  and loadouts appropriate to their arena). Bots build, upgrade, set targeting and send troops
  with an eco-vs-defence heuristic; their reaction delay, tile choice and card level scale with
  trophies. Bot matches award trophies normally (`botMatchesAwardTrophies: true`) and the
  results screen shows a "vs bot" tag. Bots never appear on leaderboards. This is how you can
  test ranked alone: just press BATTLE and wait 12 s.
- **Trophy Road** (Progress tab): ~40 nodes up to 4000, progressed by best Duel + best 2v2
  trophies — coins, gems, chests, guaranteed tower and troop unlocks, icons, emotes, and big
  arena milestones.

### Cards, levels, loadouts
- 15 towers. New: **Crossbow** (anti-air specialist), **Builder Hut** (mobile automatic repairs), **Flamethrower** (cone + burn, melts swarms), **Mortar** (range 8, min range 2,
  huge splash, lobbed shells that lead the target), **Venom** (stacking armour-piercing poison),
  **Prism** (beam that ramps up to ×4–6 on one target), **War Totem** (+15% damage / +10% fire
  rate to towers within 2 tiles; several totems don't stack), **Log Roller** (roadside-only piercing
  logs with knockback and slow), and **Catapult** (global, manually aimed heavy splash).
- Rarities: Common (Archer, Cannon, Frost), Rare (Sniper, Gold Mine, Flamethrower), Epic (Tesla,
  Mortar, Venom), Legendary (Prism, War Totem). Starter set: Archer, Cannon, Frost, Sniper.
- Card levels 1–10 (copies + coins, Clash-Royale curve; rarer cards need fewer copies). Each
  level = +5% damage (Gold Mine +5% income, War Totem +1% to both buffs); upgrading gives XP.
- **Loadout** (Collection tab): up to 6 towers (hotkeys 1–6 follow the order) + an army of up to
  5 troop packs; click a card then a slot, or drag & drop. Only unlocked cards are allowed.
- Troop cards only unlock (no levels): starters Grunt, Runner, Swarmling, Brute; unlockables
  Knight, Healer, Warlord, **Splitter** (splits into 3 fast splitlings on death) and
  **Shieldbearer** (once grants nearby enemies a 30%-max-HP shield).
- Friendly lobbies have an **Equal levels** host toggle (default ON for versus, OFF for co-op):
  everyone's towers count as level 5 (you still need a tower unlocked to bring it). In co-op each
  player brings their own loadout; the lobby shows everyone's towers.

### Rewards loop
- **Reward drops** (Starr-Drop style): every ranked/versus win and every co-op victory grants a
  drop (max 8 per day, counter on the Battle tab). Tap it — each tap may climb Common → Rare →
  Epic → Mythic → Legendary — then it reveals coins, arena-pool card copies, gems, a chance at a
  NEW tower/troop, or a cosmetic. Seeded server-side RNG.
- **Chests** (Silver, Gold, Magic, Legendary) from Trophy Road, level-ups and the pass: open
  instantly with a card-by-card flip, copy count-ups, NEW bursts and progress to the next level.
- **Player level / XP** from matches, card upgrades and quests; level-ups give a chest + gems.
- **Quests**: 3 dailies (rotate at local midnight, 1 free reroll) and 3 weeklies; rewards coins,
  XP and pass tokens; progress shows on the results screen with "Quest complete!" toasts.
- **Tower Pass**: 30 tiers per 28-day season, free + premium track. Premium costs 500 *earned*
  gems. Season end: trophies above 1500 lose half the excess, a reward by peak arena, the pass
  resets and the leaderboards keep "last season's top 3".
- **Shop**: free daily gift, 6 daily offers (arena-gated tower cards for coins, a chest for gems,
  a cosmetic for gems), gem → coin bundles, "refreshes in hh:mm". Gems cannot be bought.
- **Cosmetics**: profile icons and emotes (4 starter emotes, more from rewards).
- **Co-op campaign**: 1★ Easy, 2★ Normal, 3★ Hard per map; 2★ unlocks the next map; first-clear
  rewards. **Endless co-op** (unlocks after any 2★) has no final wave and feeds a leaderboard.
- **Sandbox**: unrestricted custom co-op/FFA/2v2 with every turret and troop, every map and
  equal levels by default. Sandbox matches do not award stars, trophies, quests or progression.
- **Leaderboards** (Social tab): Duel, Team and Endless (best run per team composition, per map),
  Global/Friends and This season/All time, top 100 with your own rank pinned.

### Dev panel (local testing)
`npm run play` and `npm run dev` start the server with `DEV_TOOLS=1`. In the app press
<kbd>`</kbd> (backtick) or click **🛠 Dev** / **DEV** to open the panel. It can grant coins, gems,
XP, pass tokens, a reward drop, a chest, copies of one card or of all cards; unlock everything;
set Duel / 2v2 trophies; reset daily quests/drops/shop; end the season now; start a bot ranked
Duel or 2v2 instantly; fast-forward the current match (+60 s / +10 min); and reset your
progression. All of it goes through `/api/dev/*`, which answers **403** unless the server runs
with `DEV_TOOLS=1` (plain `npm start` has it off).

### Balance (fast-forward, `npm run balance`)

Co-op with the **starter loadout** (identical with the classic six — the bot rarely needs Tesla
and never builds mines) is the table above. Ranked bot-vs-bot under ranked rules, both bots
sending troops, 80 games per row, seats alternated, maps rotated, only card levels differ:

```
       matchup | favoured win % |          draws |     avg length |      avg waves
      L5 vs L5 |            58% |              1 |        7.1 min |           21.0
 L6 vs L5 (+1) |            71% |              0 |        7.2 min |           21.3
 L8 vs L5 (+3) |            88% |              0 |        7.2 min |           21.3
L10 vs L5 (+5) |            91% |              0 |        7.2 min |           21.4
```

Equal levels is a coin flip within noise (a 200-game run gives 53.5%). Level differences matter a
lot between two *identical* bots (any edge snowballs); trophy matchmaking pairs similar
collections, and Friendly lobbies can switch on Equal levels.

## Project layout

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts
src/shared/    config.ts (ALL match balance numbers), progression.ts (ALL meta-game numbers),
               maps.ts, waves.ts, types.ts, protocol.ts, progProtocol.ts, rng.ts
src/server/    index.ts (entry), app.ts (express + socket.io), db.ts (JSON store), auth.ts,
               social.ts (friends/presence/invites), rooms.ts (lobbies), match.ts (match loop),
               io.ts (socket types, rate limiter)
src/server/sim/ game.ts (GameSim), board.ts, enemies.ts, towers.ts, targeting.ts, economy.ts,
               bot.ts (headless bot / ranked opponent), balance.ts (fast-forward harness)
src/server/progression/ profile.ts, trophies.ts, rewards.ts, quests.ts, season.ts, leaderboard.ts,
               matchRewards.ts, matchmaking.ts, service.ts (sockets, room hooks, /api/dev)
src/client/    index.html, main.tsx, net.ts, store.ts, styles.css
src/client/ui/ App, AuthScreen, Lobby, GameScreen, Results, FriendsPanel, MainMenu (friendly-lobby
               panels), components
src/client/ui/hub/ Home (top bar + bottom nav), BattleTab, CollectionTab, ProgressTab, ShopTab,
               SocialTab, overlays (matchmaking, VS), reveals (drops, chests, level-ups), DevPanel
src/client/game/ renderer.ts (canvas), art.ts (vector art), input.ts, interpolation.ts, gameState.ts
scripts/balance.ts
tests/         sim.test.ts, sim-phase2.test.ts, progression.test.ts (unit),
               integration.test.ts, ranked.test.ts (real server + sockets), balance.test.ts
```

The client renders snapshots ~1.7 ticks in the past and interpolates enemies/shells by id
between the two bracketing snapshots, so movement is smooth at any frame rate.
