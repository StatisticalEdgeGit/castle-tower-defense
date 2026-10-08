// Ranked matchmaking: one in-memory queue per ladder. Pairs the closest trophies within an
// acceptable gap (starts at ±100, widens +50 every 3 s). If nobody fits within the bot
// timeout (12 s), empty seats — opponents and, in 2v2, teammates — are filled with bots
// whose trophies are close to the searcher's.
import { BOT_NAMES, ICONS, MATCHMAKING, RANKED_RULES, rankedMaps, STARTER_EMOTES } from '../../shared/progression';
import type { RankedMode, VsInfo, VsSide } from '../../shared/progProtocol';
import { EV } from '../../shared/protocol';
import { mulberry32 } from '../../shared/rng';
import type { MapId, PackId, TowerType } from '../../shared/types';
import type { Match } from '../match';
import type { Room, RoomManager } from '../rooms';
import { Bot, botLoadout, botProfileForTrophies } from '../sim/bot';
import { makeRuleset, type Ruleset } from '../sim/game';
import type { Social } from '../social';
import type { Clock } from './profile';

export interface Searcher {
  userId: string;
  name: string;
  trophies: number;
  level: number;
  icon: string;
  arena: number;
}

export interface QueueEntry {
  id: string;
  mode: RankedMode;
  members: Searcher[];
  avg: number;
  since: number;
}

export interface BotSeat {
  id: string;
  name: string;
  trophies: number;
  level: number;
  icon: string;
  arena: number;
  cardLevel: number;
  loadout: TowerType[];
  troops: PackId[];
  skill: number;
  thinkEvery: number;
  aggression: number;
}

export interface MatchmakerOptions {
  botTimeoutSec?: number;
  vsSplashSec?: number;
  tickMs?: number;
  rankedOverrides?: Partial<Ruleset>;
}

type Seat = { kind: 'human'; s: Searcher } | { kind: 'bot'; b: BotSeat };

let entrySeq = 0;
let botSeq = 0;

export class Matchmaker {
  private queues: Record<RankedMode, QueueEntry[]> = { duel: [], team: [] };
  private timer: NodeJS.Timeout | null = null;
  readonly bots = new Map<string, BotSeat>();
  /** roomId → bot ids (cleanup) */
  private roomBots = new Map<string, string[]>();
  private rng = mulberry32(Date.now() >>> 0);
  readonly botTimeoutSec: number;
  readonly vsSplashSec: number;

  constructor(
    private readonly rooms: RoomManager,
    private readonly social: Social,
    private readonly clock: Clock,
    private readonly opts: MatchmakerOptions = {},
    private readonly onStatus: (userId: string) => void = () => {},
  ) {
    this.botTimeoutSec = opts.botTimeoutSec ?? MATCHMAKING.botTimeoutSec;
    this.vsSplashSec = opts.vsSplashSec ?? MATCHMAKING.vsSplashSec;
    this.timer = setInterval(() => this.tick(), opts.tickMs ?? 500);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── queue management ─────────────────────────────────────────────────────
  entryOf(userId: string): QueueEntry | null {
    for (const mode of ['duel', 'team'] as RankedMode[]) {
      const e = this.queues[mode].find((x) => x.members.some((m) => m.userId === userId));
      if (e) return e;
    }
    return null;
  }

  enqueue(mode: RankedMode, members: Searcher[]): QueueEntry {
    for (const m of members) this.cancel(m.userId, false);
    const entry: QueueEntry = {
      id: `q${++entrySeq}`,
      mode,
      members,
      avg: members.reduce((a, m) => a + m.trophies, 0) / members.length,
      since: this.clock.now(),
    };
    this.queues[mode].push(entry);
    for (const m of members) this.onStatus(m.userId);
    return entry;
  }

  /** Remove the user's whole entry (their party leaves the queue with them). */
  cancel(userId: string, notify = true): boolean {
    const e = this.entryOf(userId);
    if (!e) return false;
    this.queues[e.mode] = this.queues[e.mode].filter((x) => x !== e);
    if (notify) for (const m of e.members) this.onStatus(m.userId);
    return true;
  }

  gap(e: QueueEntry, now: number): number {
    const waited = Math.max(0, (now - e.since) / 1000);
    return MATCHMAKING.gapStart + MATCHMAKING.gapGrowth * Math.floor(waited / MATCHMAKING.gapEverySec);
  }

  private waited(e: QueueEntry, now: number): number {
    return (now - e.since) / 1000;
  }

  // ── pairing ─────────────────────────────────────────────────────────────
  tick(): void {
    const now = this.clock.now();
    this.tickDuel(now);
    this.tickTeam(now);
  }

  private take(mode: RankedMode, entries: QueueEntry[]): void {
    this.queues[mode] = this.queues[mode].filter((e) => !entries.includes(e));
  }

  private tickDuel(now: number): void {
    const q = this.queues.duel.slice().sort((a, b) => a.since - b.since);
    const used = new Set<QueueEntry>();
    for (const a of q) {
      if (used.has(a)) continue;
      let best: QueueEntry | null = null;
      let bestDiff = Infinity;
      for (const b of q) {
        if (b === a || used.has(b)) continue;
        const diff = Math.abs(a.avg - b.avg);
        if (diff <= Math.max(this.gap(a, now), this.gap(b, now)) && diff < bestDiff) {
          best = b;
          bestDiff = diff;
        }
      }
      if (best) {
        used.add(a).add(best);
        this.take('duel', [a, best]);
        this.launch('duel', [{ kind: 'human', s: a.members[0] }], [{ kind: 'human', s: best.members[0] }]);
      } else if (this.waited(a, now) >= this.botTimeoutSec) {
        used.add(a);
        this.take('duel', [a]);
        this.launch('duel', [{ kind: 'human', s: a.members[0] }], [{ kind: 'bot', b: this.makeBot(a.avg) }]);
      }
    }
  }

  private tickTeam(now: number): void {
    const q = this.queues.team.slice().sort((a, b) => a.since - b.since);
    const used = new Set<QueueEntry>();
    const within = (x: QueueEntry, y: QueueEntry, avg: number) => Math.abs(avg - y.avg) <= Math.max(this.gap(x, now), this.gap(y, now));
    for (const a of q) {
      if (used.has(a)) continue;
      const mine: QueueEntry[] = [a];
      // teammate for a solo
      if (a.members.length === 1) {
        const mate = q
          .filter((b) => b !== a && !used.has(b) && b.members.length === 1 && within(a, b, a.avg))
          .sort((x, y) => Math.abs(x.avg - a.avg) - Math.abs(y.avg - a.avg))[0];
        if (mate) mine.push(mate);
      }
      const teamAvg = mine.flatMap((e) => e.members).reduce((s, m) => s + m.trophies, 0) / mine.reduce((n, e) => n + e.members.length, 0);
      // opponents: a party, or two solos
      const free = q.filter((b) => !used.has(b) && !mine.includes(b));
      let opp: QueueEntry[] = [];
      const party = free.filter((b) => b.members.length === 2 && within(a, b, teamAvg)).sort((x, y) => Math.abs(x.avg - teamAvg) - Math.abs(y.avg - teamAvg))[0];
      if (party) opp = [party];
      else {
        const solos = free.filter((b) => b.members.length === 1 && within(a, b, teamAvg)).sort((x, y) => Math.abs(x.avg - teamAvg) - Math.abs(y.avg - teamAvg));
        opp = solos.slice(0, 2);
      }
      const mineCount = mine.reduce((n, e) => n + e.members.length, 0);
      const oppCount = opp.reduce((n, e) => n + e.members.length, 0);
      const full = mineCount === 2 && oppCount === 2;
      if (!full && this.waited(a, now) < this.botTimeoutSec) continue;
      for (const e of [...mine, ...opp]) used.add(e);
      this.take('team', [...mine, ...opp]);
      const sideA: Seat[] = mine.flatMap((e) => e.members.map((s) => ({ kind: 'human' as const, s })));
      const sideB: Seat[] = opp.flatMap((e) => e.members.map((s) => ({ kind: 'human' as const, s })));
      while (sideA.length < 2) sideA.push({ kind: 'bot', b: this.makeBot(teamAvg) });
      while (sideB.length < 2) sideB.push({ kind: 'bot', b: this.makeBot(teamAvg) });
      this.launch('team', sideA, sideB);
    }
  }

  // ── bots ────────────────────────────────────────────────────────────────
  makeBot(nearTrophies: number, taken: Set<string> = new Set()): BotSeat {
    const trophies = Math.max(0, Math.round(nearTrophies + (this.rng() - 0.5) * 120));
    const prof = botProfileForTrophies(trophies);
    const used = new Set([...this.bots.values()].map((b) => b.name));
    const names = BOT_NAMES.filter((n) => !used.has(n) && !taken.has(n));
    const name = (names.length ? names : BOT_NAMES)[Math.floor(this.rng() * (names.length || BOT_NAMES.length))];
    const { towers, troops } = botLoadout(prof.arena);
    const bot: BotSeat = {
      id: `bot_${++botSeq}_${Math.floor(this.rng() * 1e6).toString(36)}`,
      name,
      trophies,
      level: Math.max(1, Math.min(50, prof.arena * 4 + 1 + Math.floor(this.rng() * 4))),
      icon: ICONS[Math.floor(this.rng() * ICONS.length)].id,
      arena: prof.arena,
      cardLevel: prof.cardLevel,
      loadout: towers,
      troops,
      skill: prof.skill,
      thinkEvery: prof.thinkEvery,
      aggression: prof.aggression,
    };
    this.bots.set(bot.id, bot);
    return bot;
  }

  // ── launching ───────────────────────────────────────────────────────────
  /** Create the ranked room, show the VS splash, then start the match. */
  launch(mode: RankedMode, sideA: Seat[], sideB: Seat[]): Room | null {
    const humans = [...sideA, ...sideB].filter((s): s is { kind: 'human'; s: Searcher } => s.kind === 'human').map((h) => h.s);
    if (!humans.length) return null;
    const lowerArena = Math.min(...humans.map((h) => h.arena));
    const maps = rankedMaps(lowerArena);
    const mapId: MapId = maps[Math.floor(this.rng() * maps.length)] ?? 'greenfield';
    const seat = (s: Seat, team: number) =>
      s.kind === 'human'
        ? { user: { id: s.s.userId, name: s.s.name, guest: false }, team, bot: false }
        : { user: { id: s.b.id, name: s.b.name, guest: false }, team, bot: true };
    const room = this.rooms.createRankedRoom(mode, mapId, [...sideA.map((s) => seat(s, 0)), ...sideB.map((s) => seat(s, 1))]);
    const botIds = [...sideA, ...sideB].filter((s) => s.kind === 'bot').map((s) => (s as { b: BotSeat }).b.id);
    this.roomBots.set(room.id, botIds);
    const vs = (s: Seat): VsSide =>
      s.kind === 'human'
        ? { id: s.s.userId, name: s.s.name, level: s.s.level, trophies: s.s.trophies, arena: s.s.arena, icon: s.s.icon, bot: false }
        : { id: s.b.id, name: s.b.name, level: s.b.level, trophies: s.b.trophies, arena: s.b.arena, icon: s.b.icon, bot: true };
    const teams: [VsSide[], VsSide[]] = [sideA.map(vs), sideB.map(vs)];
    for (const h of humans) {
      const mySide: 0 | 1 = teams[0].some((x) => x.id === h.userId) ? 0 : 1;
      const info: VsInfo = { mode, mapId, teams, mySide, startsIn: this.vsSplashSec };
      this.social.emitTo(h.userId, EV.mmFound, info);
      this.onStatus(h.userId);
    }
    const start = () => {
      if (!this.rooms.rooms.has(room.id) || room.state !== 'waiting') return;
      this.startRanked(room, mode, mapId);
    };
    if (this.vsSplashSec > 0) setTimeout(start, this.vsSplashSec * 1000);
    else start();
    return room;
  }

  rankedRules(mode: RankedMode, mapId: MapId): Ruleset {
    return makeRuleset(mode === 'duel' ? 'ffa' : 'teams', mapId, RANKED_RULES.difficulty, {
      firstWaveDelay: RANKED_RULES.firstWaveDelay,
      waveInterval: RANKED_RULES.waveInterval,
      escalation: { startWave: RANKED_RULES.escalationStartWave, hpPerWave: RANKED_RULES.escalationHpPerWave },
      ranked: true,
      ...this.opts.rankedOverrides,
    });
  }

  private startRanked(room: Room, mode: RankedMode, mapId: MapId): Match {
    const match = this.rooms.startMatch(room, this.rankedRules(mode, mapId), (m) => {
      const b = this.bots.get(m.id);
      if (!b) return {};
      const cardLevels: Partial<Record<TowerType, number>> = {};
      for (const t of b.loadout) cardLevels[t] = b.cardLevel;
      return { loadout: b.loadout, troops: b.troops, cardLevels, icon: b.icon, level: b.level, emotes: STARTER_EMOTES, bot: true };
    });
    const drivers: Bot[] = [];
    let seed = 1;
    for (const m of room.members) {
      const b = this.bots.get(m.id);
      if (!b) continue;
      drivers.push(new Bot(match.sim, b.id, { sends: true, skill: b.skill, thinkEvery: b.thinkEvery, aggression: b.aggression, seed: (Date.now() + seed++ * 7919) >>> 0 }));
    }
    if (drivers.length) match.onStep.push(() => drivers.forEach((d) => d.update()));
    return match;
  }

  botTrophies(id: string): number | null {
    return this.bots.get(id)?.trophies ?? null;
  }

  /** Forget the bots of a finished ranked room. */
  releaseRoom(roomId: string): void {
    for (const id of this.roomBots.get(roomId) ?? []) this.bots.delete(id);
    this.roomBots.delete(roomId);
  }
}
