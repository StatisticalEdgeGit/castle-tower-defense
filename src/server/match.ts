// Match orchestration: owns a GameSim, runs it at TICK_RATE on the wall clock and
// broadcasts snapshots to the room channel. Intents arrive here already authenticated.
import crypto from 'node:crypto';
import { TICK_RATE } from '../shared/config';
import { EV, type MatchPlayerInfo, type MatchResults, type MatchStartInfo } from '../shared/protocol';
import type { PackId, TargetMode, TowerType } from '../shared/types';
import { userChannel, type IO, type Result, type Sock } from './io';
import { GameSim, type Ruleset, type SimPlayerInit } from './sim/game';

export interface MatchSeat {
  id: string;
  name: string;
  guest: boolean;
  color: number;
  team: number;
  loadout?: TowerType[];
  troops?: PackId[];
  towerMult?: Partial<Record<TowerType, number>>;
  cardLevels?: Partial<Record<TowerType, number>>;
  bot?: boolean;
  icon?: string;
  level?: number;
  emotes?: string[];
}

export interface MatchHooks {
  onEnd(results: MatchResults, match: Match): void;
}

const TICK_MS = 1000 / TICK_RATE;

export class Match {
  readonly id = crypto.randomBytes(6).toString('hex');
  readonly sim: GameSim;
  readonly info: MatchStartInfo;
  private timer: NodeJS.Timeout | null = null;
  private lastVersions: number[] = [];
  private t0 = 0;
  private ticksDone = 0;
  private ended = false;
  private readonly startedAt = Date.now();

  constructor(
    private readonly io: IO,
    readonly channel: string,
    readonly rules: Ruleset,
    seats: MatchSeat[],
    private readonly hooks: MatchHooks,
  ) {
    const inits: SimPlayerInit[] = seats.map((s) => ({
      id: s.id,
      name: s.name,
      colorIndex: s.color,
      team: s.team,
      guest: s.guest,
      loadout: s.loadout,
      troops: s.troops,
      towerMult: s.towerMult,
      cardLevels: s.cardLevels,
      bot: s.bot,
    }));
    const seatById = new Map(seats.map((s) => [s.id, s]));
    this.sim = new GameSim(rules, inits);
    const players: MatchPlayerInfo[] = this.sim.order.map((id) => {
      const p = this.sim.players.get(id)!;
      return {
        id,
        name: p.name,
        guest: p.guest,
        color: p.colorIndex,
        team: p.team,
        boardId: p.boardId,
        loadout: p.loadout.slice(),
        troops: p.troops.slice(),
        bot: p.bot,
        icon: seatById.get(id)?.icon ?? 'shield',
        level: seatById.get(id)?.level ?? 1,
        emotes: seatById.get(id)?.emotes ?? [],
      };
    });
    this.info = {
      matchId: this.id,
      mode: rules.mode,
      mapId: rules.mapId,
      difficulty: rules.difficulty,
      finalWave: rules.finalWave,
      ranked: rules.ranked,
      endless: rules.mode === 'coop' && rules.finalWave === null,
      vsBot: players.some((p) => p.bot),
      players,
      boards: this.sim.boards.map((b) => ({ id: b.id, defenders: b.defenders.slice(), maxLives: b.maxLives })),
      waveSeed: rules.waveSeed,
    };
  }

  get over(): boolean {
    return this.ended;
  }

  start(): void {
    this.io.to(this.channel).emit(EV.matchStart, this.info);
    this.lastVersions = this.sim.boards.map(() => -1);
    this.broadcast();
    this.t0 = performance.now();
    this.ticksDone = 0;
    this.schedule();
  }

  private schedule(): void {
    if (this.ended) return;
    const nextAt = this.t0 + (this.ticksDone + 1) * TICK_MS;
    const delay = Math.max(0, nextAt - performance.now());
    this.timer = setTimeout(() => this.loop(), delay);
  }

  private loop(): void {
    this.timer = null;
    if (this.ended) return;
    const due = Math.floor((performance.now() - this.t0) / TICK_MS) - this.ticksDone;
    if (due <= 0) {
      this.schedule();
      return;
    }
    // catch up at most a few ticks if the event loop stalled, then resync the clock
    const run = Math.min(due, 5);
    for (let i = 0; i < run && !this.ended; i++) {
      this.tick();
      this.ticksDone++;
    }
    if (due > 5) this.ticksDone = Math.floor((performance.now() - this.t0) / TICK_MS);
    this.schedule();
  }

  /** called after every sim step (ranked bots act here) */
  readonly onStep: (() => void)[] = [];

  private stepOnce(): void {
    this.sim.step();
    for (const f of this.onStep) f();
  }

  private tick(): void {
    const steps = this.sim.speed;
    for (let s = 0; s < steps && this.sim.phase !== 'over'; s++) this.stepOnce();
    this.broadcast();
    if (this.sim.phase === 'over') this.end();
  }

  private broadcast(): void {
    this.sim.seq++;
    const snap = this.sim.snapshot(this.lastVersions, true);
    this.lastVersions = this.sim.boards.map((b) => b.towersVersion);
    this.io.to(this.channel).emit(EV.matchSnap, snap);
  }

  /** Full state for a (re)connecting socket. */
  sendFull(sock: Sock): void {
    sock.emit(EV.matchStart, this.info);
    sock.emit(EV.matchSnap, this.sim.snapshot(null, false));
  }

  /** Test hook: simulate `seconds` instantly (snapshots resume on the next tick). */
  fastForward(seconds: number): void {
    const steps = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < steps && this.sim.phase !== 'over'; i++) this.stepOnce();
    for (const b of this.sim.boards) b.fx = [];
    this.broadcast();
    if (this.sim.phase === 'over') this.end();
  }

  // ── intents ───────────────────────────────────────────────────────────────
  placeTower(uid: string, p: { boardId?: unknown; tx?: unknown; ty?: unknown; type?: unknown }): Result<{ towerId?: number }> {
    if (!p || typeof p !== 'object') return { ok: false, error: 'Bad request' };
    const boardId = typeof p.boardId === 'number' ? p.boardId : this.sim.players.get(uid)?.boardId ?? -1;
    if (typeof p.tx !== 'number' || typeof p.ty !== 'number' || typeof p.type !== 'string') return { ok: false, error: 'Bad request' };
    return this.sim.placeTower(uid, boardId, p.tx, p.ty, p.type as TowerType);
  }

  upgradeTower(uid: string, p: { towerId?: unknown }): Result {
    if (!p || typeof p.towerId !== 'number') return { ok: false, error: 'Bad request' };
    return this.sim.upgradeTower(uid, p.towerId);
  }

  sellTower(uid: string, p: { towerId?: unknown }): Result {
    if (!p || typeof p.towerId !== 'number') return { ok: false, error: 'Bad request' };
    return this.sim.sellTower(uid, p.towerId);
  }

  repairTower(uid: string, p: { towerId?: unknown }): Result<{ cost?: number }> {
    if (!p || typeof p.towerId !== 'number') return { ok: false, error: 'Bad request' };
    return this.sim.repairTower(uid, p.towerId);
  }

  moveTower(uid: string, p: { towerId?: unknown; tx?: unknown; ty?: unknown }): Result {
    if (!p || typeof p.towerId !== 'number' || typeof p.tx !== 'number' || typeof p.ty !== 'number') return { ok: false, error: 'Bad request' };
    return this.sim.moveTower(uid, p.towerId, p.tx, p.ty);
  }

  setTargeting(uid: string, p: { towerId?: unknown; mode?: unknown }): Result {
    if (!p || typeof p.towerId !== 'number' || typeof p.mode !== 'string') return { ok: false, error: 'Bad request' };
    return this.sim.setTargeting(uid, p.towerId, p.mode as TargetMode);
  }

  setGroundTarget(uid: string, p: { towerId?: unknown; tx?: unknown; ty?: unknown }): Result {
    if (!p || typeof p.towerId !== 'number' || typeof p.tx !== 'number' || typeof p.ty !== 'number') return { ok: false, error: 'Bad request' };
    return this.sim.setGroundTarget(uid, p.towerId, p.tx, p.ty);
  }

  sendTroops(uid: string, p: { packId?: unknown; targetPlayerId?: unknown }): Result {
    if (!p || typeof p.packId !== 'string') return { ok: false, error: 'Bad request' };
    const target = typeof p.targetPlayerId === 'string' ? p.targetPlayerId : undefined;
    return this.sim.sendTroops(uid, p.packId as PackId, target);
  }

  ready(uid: string, p: { value?: unknown }): Result {
    return this.sim.setReady(uid, typeof p?.value === 'boolean' ? p.value : undefined);
  }

  speedVote(uid: string, p: { value?: unknown }): Result {
    const player = this.sim.players.get(uid);
    const hadVoted = player?.speedVote ?? false;
    const result = this.sim.setSpeedVote(uid, typeof p?.value === 'boolean' ? p.value : undefined);
    if (result.ok && !hadVoted && player?.speedVote) {
      this.io
        .to(this.channel)
        .except(userChannel(uid))
        .emit(EV.toast, { kind: 'info', text: `${player.name} wants to speed up — press ×2 to agree` });
    }
    return result;
  }

  setConnected(uid: string, connected: boolean): void {
    this.sim.setConnected(uid, connected);
  }

  markLeft(uid: string): void {
    this.sim.markLeft(uid);
    if (this.sim.phase === 'over' && !this.ended) {
      this.broadcast();
      this.end();
    }
  }

  results(): MatchResults {
    const r = this.sim.result;
    const outcome = r?.outcome ?? (this.rules.mode === 'coop' ? 'defeat' : 'versus');
    return {
      matchId: this.id,
      mode: this.rules.mode,
      mapId: this.rules.mapId,
      difficulty: this.rules.difficulty,
      outcome,
      ranked: this.rules.ranked,
      endless: this.info.endless,
      vsBot: this.info.vsBot,
      winners: r?.winners ?? [],
      wave: this.sim.wave,
      wavesSurvived: r?.wavesSurvived ?? Math.max(0, this.sim.wave - 1),
      durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      players: this.info.players.map((pi) => {
        const sp = this.sim.players.get(pi.id)!;
        return {
          ...pi,
          stats: {
            kills: sp.stats.kills,
            damage: Math.round(sp.stats.damage),
            earned: Math.round(sp.stats.earned),
            sent: sp.stats.sent,
            built: sp.stats.built,
            builtBy: { ...sp.stats.builtBy },
            damageBy: Object.fromEntries(Object.entries(sp.stats.damageBy).map(([k, v]) => [k, Math.round(v ?? 0)])),
          },
          eliminatedWave: sp.eliminatedWave,
        };
      }),
    };
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const results = this.results();
    this.io.to(this.channel).emit(EV.matchOver, results);
    this.hooks.onEnd(results, this);
  }

  /** Conclude immediately with whatever state the sim is in (results + hooks still run). */
  concludeNow(): void {
    if (this.ended) return;
    this.sim.forceFinish();
    this.broadcast();
    this.end();
  }

  /** Stop without results (room deleted). */
  dispose(): void {
    this.ended = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
