# Castle Tower Defense

A multiplayer tower defense for 1–4 players — play **with** each other (co-op) or
**against** each other (free-for-all or 2v2 teams, sending troops at your opponents).
Everything runs locally: one Node server hosts the game for your PC and anyone on your
LAN. Nothing is deployed anywhere.

- Server-authoritative simulation (20 ticks/s) — clients only send intents and render.
- Accounts, guests, friends with live presence, in-app invites, invite links, public game browser.
- 4 maps ("levels"), 6 towers × 3 levels, 7 enemy types incl. a boss, 3 difficulties.

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
| `npm run play` | `build` + `start` — the one-command way to test |
| `npm run dev` | server with `tsx watch` on 4777 **and** Vite dev server on **5180** (hot reload). Open http://localhost:5180 |
| `npm run build` | build the client to `dist/client` |
| `npm start` | start the server (serves `dist/client` if it exists) |
| `npm test` | unit + integration + balance tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run balance` | print the co-op balance table (`-- --all-maps` for every map) |

Data (accounts, sessions, friends, stats) is stored in `data/db.json` (gitignored, written
atomically). Delete it to start fresh. `PORT` and `DB_PATH` env vars override the defaults.

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
| Cannon (2) | $200 | shells travel and explode (splash) |
| Frost (3) | $150 | slows (strongest slow wins, no stacking; bosses take half); L2 splash, L3 pulse hits everything in range |
| Sniper (4) | $300 | range 7, ignores armor |
| Tesla (5) | $350 | chains 3/5/7 targets, −20% per jump |
| Gold Mine (6) | $250 | +$25/60/110 to its owner each wave, max 3 per player |

Each attacking tower has a targeting mode (First / Last / Strongest / Closest). Selling
refunds 70% of everything invested. Armor reduces each hit but a hit always does at least
20% damage. Enemies: Grunt, Runner, Swarmling, Knight (armored), Brute, Healer (heals
nearby enemies), and the Warlord boss every 10th wave.

## Controls

| Input | Action |
| --- | --- |
| `1`–`6` or click a shop card | choose a tower to build (ghost + range preview, green = valid) |
| Left click | place tower / select tower · **Shift**-click to keep placing |
| Right click / `Esc` | cancel build or selection |
| `U` / `S` | upgrade / sell the selected tower (expensive sells ask to confirm) |
| `Space` | co-op: Ready / call the next wave |
| `Enter` | open chat |
| Click an opponent mini-board | versus: make it your send target (when eliminated: spectate it) |

## Project layout

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts
src/shared/    config.ts (ALL balance numbers), maps.ts, waves.ts, types.ts, protocol.ts, rng.ts
src/server/    index.ts (entry), app.ts (express + socket.io), db.ts (JSON store), auth.ts,
               social.ts (friends/presence/invites), rooms.ts (lobbies), match.ts (match loop),
               io.ts (socket types, rate limiter)
src/server/sim/ game.ts (GameSim), board.ts, enemies.ts, towers.ts, targeting.ts, economy.ts,
               bot.ts (headless greedy bot), balance.ts (fast-forward harness)
src/client/    index.html, main.tsx, net.ts, store.ts, styles.css
src/client/ui/ App, AuthScreen, MainMenu, Lobby, GameScreen, Results, FriendsPanel, components
src/client/game/ renderer.ts (canvas), art.ts (vector art), input.ts, interpolation.ts, gameState.ts
scripts/balance.ts
tests/         sim.test.ts (unit), integration.test.ts (real server + sockets), balance.test.ts
```

The client renders snapshots ~1.7 ticks in the past and interpolates enemies/shells by id
between the two bracketing snapshots, so movement is smooth at any frame rate.
