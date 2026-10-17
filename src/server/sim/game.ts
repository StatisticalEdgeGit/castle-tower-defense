// The authoritative match simulation. Pure (no sockets, no wall clock): call step() at
// TICK_RATE and feed it validated intents. Used by match.ts (live games), the balance
// bot (fast-forward) and the unit tests.
import {
  defenderScale,
  DIFFICULTY,
  DT,
  ECONOMY,
  MAX_PLAYERS,
  SEND_PACKS,
  TIMING,
  TOWERS,
  WAVES,
} from '../../shared/config';
import { MAPS, type GameMap } from '../../shared/maps';
import type {
  BoardSnap,
  EnemyTuple,
  PlayerMatchStats,
  PlayerSnap,
  ShellTuple,
  Snapshot,
  TowerSnap,
} from '../../shared/protocol';
import {
  PACK_IDS,
  TARGET_MODES,
  TOWER_TYPES,
  type Difficulty,
  type GameMode,
  type MapId,
  type MatchPhase,
  type PackId,
  type TargetMode,
  type TowerType,
} from '../../shared/types';
import { generateWave } from '../../shared/waves';
import { createBoard, enqueueSpawn, placementError, type Board, type Enemy, type Tower } from './board';
import {
  boardLives,
  earlyCallBonus,
  enemyHp,
  scaledSendCount,
  scaleWaveForBoard,
  sellRefund,
  startingCash,
  waveBonus,
  type Escalation,
} from './economy';
import { applyDots, applyHealers, applyShieldbearers, createEnemy, createSplitChildren, moveEnemies } from './enemies';
import { applyTotemBuffs, beamRamp, updateShells, updateTowers, type SimContext } from './towers';
import { levelStatMult, MAX_CARD_LEVEL } from '../../shared/progression';
import { ENEMY_FLAG } from '../../shared/types';

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Everything that defines how a match plays (phase 2 ranked/endless plug in here). */
export interface Ruleset {
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  /** seconds before wave 1 */
  firstWaveDelay: number;
  /** versus: seconds between AI waves */
  waveInterval: number;
  /** co-op: countdown after a wave is cleared */
  betweenWaves: number;
  /** co-op: surviving this wave wins; null = endless (versus / endless co-op) */
  finalWave: number | null;
  /** optional HP escalation (e.g. ranked "sudden death") */
  escalation: Escalation | null;
  ranked: boolean;
  waveSeed: number;
  allowSpeedVote: boolean;
  /** base lives per board (scaled by defenderScale(k) for multi-defender boards) */
  lives: number;
}

export function makeRuleset(mode: GameMode, mapId: MapId, difficulty: Difficulty, overrides: Partial<Ruleset> = {}): Ruleset {
  const versus = mode !== 'coop';
  return {
    mode,
    mapId,
    difficulty,
    firstWaveDelay: versus ? TIMING.versusFirstWave : TIMING.coopFirstWave,
    waveInterval: TIMING.versusWaveInterval,
    betweenWaves: TIMING.coopBetweenWaves,
    finalWave: versus ? null : MAPS[mapId].finalWave,
    escalation: null,
    ranked: false,
    waveSeed: WAVES.seed,
    allowSpeedVote: !versus,
    lives: DIFFICULTY[difficulty].lives,
    ...overrides,
  };
}

export interface SimPlayerInit {
  id: string;
  name: string;
  colorIndex: number;
  team: number;
  guest?: boolean;
  /** towers this player may build (default: all) */
  loadout?: TowerType[];
  /** packs this player may send (default: all) */
  troops?: PackId[];
  /** per-tower stat multiplier override (tests / tools). Default: from cardLevels. */
  towerMult?: Partial<Record<TowerType, number>>;
  /** card level (1–10) per tower: +5% damage per level (mine: income, totem: +1% buff). */
  cardLevels?: Partial<Record<TowerType, number>>;
  /** a bot seat (excluded from leaderboards/rewards by the server) */
  bot?: boolean;
}

export interface SimPlayer {
  id: string;
  name: string;
  colorIndex: number;
  team: number;
  guest: boolean;
  boardId: number;
  money: number;
  income: number;
  ready: boolean;
  speedVote: boolean;
  alive: boolean;
  connected: boolean;
  left: boolean;
  loadout: TowerType[];
  troops: PackId[];
  towerMult: Record<TowerType, number>;
  cardLevels: Record<TowerType, number>;
  bot: boolean;
  /** sim time at which each pack is available again */
  cooldowns: Record<PackId, number>;
  stats: PlayerMatchStats;
  eliminatedWave: number | null;
}

export interface SimResult {
  outcome: 'victory' | 'defeat' | 'versus';
  winners: string[];
  wave: number;
  wavesSurvived: number;
  time: number;
}

export class GameSim implements SimContext {
  readonly rules: Ruleset;
  readonly map: GameMap;
  readonly players = new Map<string, SimPlayer>();
  /** player ids in seat order (clockwise) */
  readonly order: string[] = [];
  readonly boards: Board[] = [];
  time = 0;
  tick = 0;
  wave = 0;
  phase: MatchPhase = 'prep';
  nextWaveIn: number | null;
  result: SimResult | null = null;
  seq = 0;
  private idCounter = 1;
  private towerById = new Map<number, Tower>();

  constructor(rules: Ruleset, inits: SimPlayerInit[]) {
    if (inits.length < 1 || inits.length > MAX_PLAYERS) throw new Error('bad player count');
    this.rules = rules;
    this.map = MAPS[rules.mapId];
    const sorted = inits.slice().sort((a, b) => a.colorIndex - b.colorIndex);
    for (const p of sorted) this.order.push(p.id);

    // ── boards ──
    const groups: string[][] = [];
    if (rules.mode === 'coop') groups.push(sorted.map((p) => p.id));
    else if (rules.mode === 'ffa') for (const p of sorted) groups.push([p.id]);
    else {
      for (const team of [0, 1]) {
        const ids = sorted.filter((p) => p.team === team).map((p) => p.id);
        if (ids.length === 0) throw new Error('both teams need at least one player');
        groups.push(ids);
      }
    }
    groups.forEach((ids, i) => this.boards.push(createBoard(i, this.map, ids, boardLives(rules.lives, ids.length))));

    for (const init of sorted) {
      const boardId = this.boards.findIndex((b) => b.defenders.includes(init.id));
      const k = this.boards[boardId].defenders.length;
      const cardLevels = Object.fromEntries(
        TOWER_TYPES.map((t) => [t, Math.max(1, Math.min(MAX_CARD_LEVEL, Math.round(init.cardLevels?.[t] ?? 1)))]),
      ) as Record<TowerType, number>;
      // totem levels boost its buff instead of a damage multiplier (see towers.ts)
      const towerMult = Object.fromEntries(
        TOWER_TYPES.map((t) => [t, init.towerMult?.[t] ?? (t === 'totem' ? 1 : levelStatMult(cardLevels[t]))]),
      ) as Record<TowerType, number>;
      this.players.set(init.id, {
        id: init.id,
        name: init.name,
        colorIndex: init.colorIndex,
        team: rules.mode === 'teams' ? init.team : rules.mode === 'coop' ? 0 : boardId,
        guest: !!init.guest,
        boardId,
        money: startingCash(k, rules.difficulty),
        income: ECONOMY.startingIncome,
        ready: false,
        speedVote: false,
        alive: true,
        connected: true,
        left: false,
        loadout: (init.loadout ?? [...TOWER_TYPES]).slice(0, 6),
        troops: (init.troops ?? [...PACK_IDS]).slice(),
        towerMult,
        cardLevels,
        bot: !!init.bot,
        cooldowns: Object.fromEntries(PACK_IDS.map((p) => [p, 0])) as Record<PackId, number>,
        stats: { kills: 0, damage: 0, earned: 0, sent: 0, built: 0, builtBy: {}, damageBy: {} },
        eliminatedWave: null,
      });
    }
    this.nextWaveIn = rules.firstWaveDelay;
  }

  // ── SimContext ────────────────────────────────────────────────────────────
  nextId(): number {
    return this.idCounter++;
  }

  onHit(board: Board, tower: Tower | null, e: Enemy, dealt: number): void {
    if (tower) {
      tower.damage += dealt;
      const owner = this.players.get(tower.owner);
      if (owner) {
        owner.stats.damage += dealt;
        owner.stats.damageBy[tower.type] = (owner.stats.damageBy[tower.type] ?? 0) + dealt;
      }
    }
    if (e.alive && e.hp <= 0) {
      e.alive = false;
      if (e.def.splitInto) {
        for (const c of createSplitChildren(() => this.nextId(), e)) board.enemies.push(c);
        board.fx.push({ k: 'pulse', x: round2(e.x), y: round2(e.y), r: 0.6 });
      }
      if (tower) {
        tower.kills++;
        const owner = this.players.get(tower.owner);
        if (owner) owner.stats.kills++;
      }
      const recipients = this.activeDefenders(board);
      const share = recipients.length ? e.bounty / recipients.length : 0;
      for (const p of recipients) this.give(p, share);
      board.fx.push({ k: 'death', x: round2(e.x), y: round2(e.y), e: e.typeIdx, b: Math.round(share * 10) / 10 });
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  get versus(): boolean {
    return this.rules.mode !== 'coop';
  }

  boardK(boardId: number): number {
    return this.boards[boardId].defenders.length;
  }

  /** defenders that are still in the match (bounty pot is split between these) */
  activeDefenders(board: Board): SimPlayer[] {
    const all = board.defenders.map((id) => this.players.get(id)!).filter(Boolean);
    const active = all.filter((p) => !p.left);
    return active.length ? active : [];
  }

  private give(p: SimPlayer, amount: number): void {
    if (amount <= 0) return;
    p.money += amount;
    p.stats.earned += amount;
  }

  private activePlayers(): SimPlayer[] {
    return [...this.players.values()].filter((p) => p.connected && !p.left);
  }

  get speed(): number {
    if (!this.rules.allowSpeedVote || this.versus) return 1;
    const act = this.activePlayers();
    return act.length > 0 && act.every((p) => p.speedVote) ? TIMING.fastSpeed : 1;
  }

  getTower(id: number): Tower | undefined {
    return this.towerById.get(id);
  }

  playerBoard(pid: string): Board | null {
    const p = this.players.get(pid);
    return p ? this.boards[p.boardId] : null;
  }

  mineIncome(p: SimPlayer): number {
    let sum = 0;
    for (const t of this.boards[p.boardId].towers) {
      if (t.owner === p.id && t.type === 'mine') sum += (TOWERS.mine.levels[t.level - 1].income ?? 0) * t.mult;
    }
    return sum;
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  step(): void {
    if (this.phase === 'over') return;
    this.time += DT;
    this.tick++;

    if (!this.versus && this.nextWaveIn !== null && this.allReady()) {
      this.startWave(true);
    } else if (this.nextWaveIn !== null) {
      this.nextWaveIn -= DT;
      if (this.nextWaveIn <= 1e-9) this.startWave(false);
    }

    for (const b of this.boards) {
      if (!b.alive) continue;
      this.stepBoard(b, DT);
    }

    // eliminations / defeat
    for (const b of this.boards) {
      if (b.alive && b.lives <= 0) this.eliminate(b);
    }
    if (this.rules.mode === 'coop') {
      const b = this.boards[0];
      if (!b.alive) {
        this.finish('defeat', [], this.wave - 1);
        return;
      }
      if (this.phase === 'running' && b.queue.length === 0 && b.enemies.length === 0) this.onWaveCleared();
    } else {
      this.checkVersusEnd();
    }
  }

  private stepBoard(b: Board, dt: number): void {
    // spawn
    while (b.queue.length && b.queue[0].at <= this.time + 1e-9) {
      const s = b.queue.shift()!;
      b.enemies.push(createEnemy(this.nextId(), b, s));
    }
    applyHealers(b, dt);
    moveEnemies(b, dt, (e) => {
      b.lives = Math.max(0, b.lives - e.lives);
      b.fx.push({ k: 'leak', x: round2(e.x), y: round2(e.y), n: e.lives });
    });
    for (const p of applyShieldbearers(b)) b.fx.push({ k: 'shieldup', x: round2(p.x), y: round2(p.y), r: p.r });
    applyDots(b, dt, (tower, e, dealt) => this.onHit(b, tower, e, dealt));
    applyTotemBuffs(b);
    updateTowers(this, b, dt);
    updateShells(this, b, dt);
    if (b.enemies.some((e) => !e.alive)) b.enemies = b.enemies.filter((e) => e.alive);
  }

  private allReady(): boolean {
    const act = this.activePlayers();
    return act.length > 0 && act.every((p) => p.ready);
  }

  private startWave(early: boolean): void {
    if (early) {
      for (const p of this.players.values()) {
        if (p.left || !p.alive) continue;
        this.give(p, earlyCallBonus(this.wave, this.boardK(p.boardId)));
      }
    }
    this.wave++;
    // payouts at wave start: (versus) previous wave bonus, income, gold mines
    for (const p of this.players.values()) {
      if (p.left || !p.alive) continue;
      const k = this.boardK(p.boardId);
      let pay = p.income + this.mineIncome(p);
      if (this.versus && this.wave >= 2) pay += waveBonus(this.wave - 1, k);
      this.give(p, pay);
    }
    const groups = generateWave(this.wave, this.rules.waveSeed);
    const boss = groups.some((g) => g.type === 'warlord');
    for (const b of this.boards) {
      if (!b.alive) continue;
      const k = b.defenders.length;
      for (const g of scaleWaveForBoard(groups, k)) {
        const hp = Math.round(enemyHp(g.type, this.wave, this.rules.difficulty, k, this.rules.escalation) * g.hpComp);
        for (let i = 0; i < g.count; i++) {
          enqueueSpawn(b, {
            at: this.time + g.delay + i * g.spacing,
            type: g.type,
            hp,
            bountyMult: 1,
            sent: false,
            senderId: null,
            wave: true,
          });
        }
      }
      b.fx.push({ k: 'wave', wave: this.wave, boss });
    }
    for (const p of this.players.values()) p.ready = false;
    this.phase = 'running';
    this.nextWaveIn = this.versus ? this.rules.waveInterval : null;
  }

  private onWaveCleared(): void {
    for (const p of this.players.values()) {
      if (p.left) continue;
      this.give(p, waveBonus(this.wave, this.boardK(p.boardId)));
    }
    if (this.rules.finalWave !== null && this.wave >= this.rules.finalWave) {
      this.finish('victory', [...this.players.keys()], this.wave);
      return;
    }
    this.phase = 'between';
    this.nextWaveIn = this.rules.betweenWaves;
  }

  private eliminate(b: Board): void {
    b.alive = false;
    b.lives = 0;
    b.eliminatedAt = this.time;
    b.eliminatedWave = this.wave;
    b.enemies = [];
    b.queue = [];
    b.shells = [];
    for (const id of b.defenders) {
      const p = this.players.get(id);
      if (p) {
        p.alive = false;
        p.eliminatedWave = this.wave;
      }
    }
  }

  private checkVersusEnd(): void {
    const alive = this.boards.filter((b) => b.alive);
    if (this.boards.length >= 2 && alive.length <= 1) {
      let winners: string[];
      if (alive.length === 1) winners = alive[0].defenders.slice();
      else {
        const last = Math.max(...this.boards.map((b) => b.eliminatedAt ?? 0));
        winners = this.boards.filter((b) => b.eliminatedAt === last).flatMap((b) => b.defenders);
      }
      this.finish('versus', winners, this.wave);
    } else if (this.boards.length === 1 && alive.length === 0) {
      this.finish('versus', [], this.wave);
    }
  }

  private finish(outcome: SimResult['outcome'], winners: string[], wavesSurvived: number): void {
    this.phase = 'over';
    this.nextWaveIn = null;
    this.result = { outcome, winners, wave: this.wave, wavesSurvived: Math.max(0, wavesSurvived), time: this.time };
  }

  /** End the match right now (e.g. every human forfeited a ranked game). */
  forceFinish(): void {
    if (this.phase === 'over') return;
    this.finish(this.versus ? 'versus' : 'defeat', [], Math.max(0, this.wave - 1));
  }

  // ── connection state ──────────────────────────────────────────────────────
  setConnected(pid: string, connected: boolean): void {
    const p = this.players.get(pid);
    if (p) p.connected = connected;
  }

  /** Player permanently left (reconnect grace expired / forfeit). Their towers keep firing. */
  markLeft(pid: string): void {
    const p = this.players.get(pid);
    if (!p || p.left) return;
    p.left = true;
    p.connected = false;
    if (this.versus && this.phase !== 'over') {
      const b = this.boards[p.boardId];
      if (b.alive && b.defenders.every((id) => this.players.get(id)?.left)) {
        this.eliminate(b);
        this.checkVersusEnd();
      }
    }
  }

  // ── intents ───────────────────────────────────────────────────────────────
  private actor(pid: string): SimPlayer | string {
    if (this.phase === 'over') return 'The game is over';
    const p = this.players.get(pid);
    if (!p) return 'Not in this match';
    if (p.left) return 'You left this match';
    if (!p.alive) return 'You have been eliminated';
    return p;
  }

  placeTower(pid: string, boardId: number, tx: number, ty: number, type: TowerType): Result<{ towerId: number }> {
    const p = this.actor(pid);
    if (typeof p === 'string') return fail(p);
    if (!(TOWER_TYPES as readonly string[]).includes(type)) return fail('Unknown tower');
    if (!p.loadout.includes(type)) return fail('That tower is not in your loadout');
    const board = this.boards[boardId];
    if (!board || !board.defenders.includes(pid)) return fail('You can only build on your own board');
    if (!board.alive) return fail('Board eliminated');
    const err = placementError(board, tx, ty);
    if (err) return fail(err);
    if (type === 'mine') {
      const mines = board.towers.filter((t) => t.owner === pid && t.type === 'mine').length;
      if (mines >= ECONOMY.maxMinesPerPlayer) return fail(`Max ${ECONOMY.maxMinesPerPlayer} gold mines`);
    }
    const cost = TOWERS[type].levels[0].cost;
    if (p.money < cost) return fail('Not enough money');
    p.money -= cost;
    const t: Tower = {
      id: this.nextId(),
      boardId,
      type,
      level: 1,
      tx,
      ty,
      x: tx + 0.5,
      y: ty + 0.5,
      owner: pid,
      invested: cost,
      targeting: type === 'sniper' ? 'strong' : 'first',
      cooldown: 0,
      angle: -Math.PI / 2,
      targetId: -1,
      mult: p.towerMult[type] ?? 1,
      cardLevel: p.cardLevels[type] ?? 1,
      buffDmg: 0,
      buffRate: 0,
      beamTarget: -1,
      beamTime: 0,
      kills: 0,
      damage: 0,
      freeMove: true,
    };
    board.towers.push(t);
    board.tileTower.set(ty * board.map.width + tx, t);
    this.towerById.set(t.id, t);
    board.towersVersion++;
    p.stats.built++;
    p.stats.builtBy[type] = (p.stats.builtBy[type] ?? 0) + 1;
    board.fx.push({ k: 'build', x: t.x, y: t.y });
    return { ok: true, towerId: t.id };
  }

  private ownedTower(pid: string, towerId: number): { p: SimPlayer; t: Tower; board: Board } | string {
    const p = this.actor(pid);
    if (typeof p === 'string') return p;
    const t = this.towerById.get(towerId);
    if (!t) return 'Tower not found';
    if (t.owner !== pid) return 'Only the owner can do that';
    return { p, t, board: this.boards[t.boardId] };
  }

  upgradeTower(pid: string, towerId: number): Result {
    const o = this.ownedTower(pid, towerId);
    if (typeof o === 'string') return fail(o);
    const { p, t, board } = o;
    if (t.level >= 3) return fail('Already max level');
    const cost = TOWERS[t.type].levels[t.level].cost;
    if (p.money < cost) return fail('Not enough money');
    p.money -= cost;
    t.level++;
    t.invested += cost;
    board.towersVersion++;
    board.fx.push({ k: 'build', x: t.x, y: t.y });
    return { ok: true };
  }

  sellTower(pid: string, towerId: number): Result<{ refund: number }> {
    const o = this.ownedTower(pid, towerId);
    if (typeof o === 'string') return fail(o);
    const { p, t, board } = o;
    const refund = sellRefund(t.invested);
    p.money += refund;
    board.towers = board.towers.filter((x) => x !== t);
    board.tileTower.delete(t.ty * board.map.width + t.tx);
    this.towerById.delete(t.id);
    board.towersVersion++;
    board.fx.push({ k: 'sell', x: t.x, y: t.y, v: refund });
    return { ok: true, refund };
  }

  /** Slide an owned tower onto another buildable square. Allowed once, and it costs nothing. */
  moveTower(pid: string, towerId: number, tx: number, ty: number): Result {
    const o = this.ownedTower(pid, towerId);
    if (typeof o === 'string') return fail(o);
    const { t, board } = o;
    if (!t.freeMove) return fail('This tower was already moved');
    if (!board.alive) return fail('Board eliminated');
    if (t.tx === tx && t.ty === ty) return fail('Already there');
    const key = (x: number, y: number) => y * board.map.width + x;
    board.tileTower.delete(key(t.tx, t.ty));
    const err = placementError(board, tx, ty);
    if (err) {
      board.tileTower.set(key(t.tx, t.ty), t);
      return fail(err);
    }
    t.tx = tx;
    t.ty = ty;
    t.x = tx + 0.5;
    t.y = ty + 0.5;
    t.freeMove = false;
    t.targetId = -1;
    t.beamTarget = -1;
    board.tileTower.set(key(tx, ty), t);
    board.towersVersion++;
    board.fx.push({ k: 'build', x: t.x, y: t.y });
    return { ok: true };
  }

  setTargeting(pid: string, towerId: number, mode: TargetMode): Result {
    const o = this.ownedTower(pid, towerId);
    if (typeof o === 'string') return fail(o);
    if (!(TARGET_MODES as readonly string[]).includes(mode)) return fail('Unknown targeting mode');
    if (!TOWERS[o.t.type].attacks) return fail('This tower does not attack');
    o.t.targeting = mode;
    o.board.towersVersion++;
    return { ok: true };
  }

  /** Default FFA target: next alive player clockwise on another board. */
  defaultTarget(pid: string): string | null {
    const p = this.players.get(pid);
    if (!p) return null;
    const n = this.order.length;
    const start = this.order.indexOf(pid);
    for (let i = 1; i < n; i++) {
      const q = this.players.get(this.order[(start + i) % n])!;
      if (q.boardId !== p.boardId && this.boards[q.boardId].alive) return q.id;
    }
    return null;
  }

  sendTroops(pid: string, packId: PackId, targetPlayerId?: string): Result<{ count: number; targetBoard: number }> {
    if (!this.versus) return fail('Sending troops is versus only');
    const p = this.actor(pid);
    if (typeof p === 'string') return fail(p);
    const pack = SEND_PACKS[packId];
    if (!pack) return fail('Unknown pack');
    if (!p.troops.includes(packId)) return fail('That troop is not in your army');
    if (this.wave < pack.unlockWave) return fail(`Unlocks at wave ${pack.unlockWave}`);
    if (p.cooldowns[packId] > this.time + 1e-9) return fail('On cooldown');
    if (p.money < pack.cost) return fail('Not enough money');

    let targetBoard: Board | null = null;
    if (targetPlayerId) {
      const q = this.players.get(targetPlayerId);
      if (q && q.boardId !== p.boardId && this.boards[q.boardId].alive) targetBoard = this.boards[q.boardId];
      else if (q && q.boardId === p.boardId) return fail("Can't send troops to your own board");
    }
    if (!targetBoard) {
      const def = this.defaultTarget(pid);
      if (def) targetBoard = this.boards[this.players.get(def)!.boardId];
    }
    if (!targetBoard) return fail('No opponent to send to');

    p.money -= pack.cost;
    p.income += pack.income;
    p.cooldowns[packId] = this.time + pack.cooldown;
    const k = targetBoard.defenders.length;
    const ds = defenderScale(k);
    const hpWave = Math.max(1, this.wave);
    let total = 0;
    let at = this.time + TIMING.sendWarning;
    for (const u of pack.units) {
      const n = scaledSendCount(u.count, k);
      // same rounding compensation as AI waves: total HP = count × ds exactly
      const hpComp = (u.count * ds) / n;
      const hp = Math.round(enemyHp(u.type, hpWave, this.rules.difficulty, k, this.rules.escalation) * hpComp);
      for (let i = 0; i < n; i++) {
        enqueueSpawn(targetBoard, {
          at,
          type: u.type,
          hp,
          bountyMult: ECONOMY.sentBountyFactor,
          sent: true,
          senderId: pid,
          wave: false,
        });
        at += TIMING.sendSpacing / ds;
      }
      total += n;
    }
    p.stats.sent += total;
    targetBoard.fx.push({ k: 'inc', from: pid, pack: packId, count: total, delay: TIMING.sendWarning });
    return { ok: true, count: total, targetBoard: targetBoard.id };
  }

  setReady(pid: string, value?: boolean): Result {
    if (this.versus) return fail('No ready-up in versus');
    const p = this.actor(pid);
    if (typeof p === 'string') return fail(p);
    p.ready = value ?? !p.ready;
    return { ok: true };
  }

  setSpeedVote(pid: string, value?: boolean): Result {
    if (this.versus || !this.rules.allowSpeedVote) return fail('Speed-up is co-op only');
    const p = this.players.get(pid);
    if (!p || p.left) return fail('Not in this match');
    if (this.phase === 'over') return fail('The game is over');
    p.speedVote = value ?? !p.speedVote;
    return { ok: true };
  }

  // ── snapshots ─────────────────────────────────────────────────────────────
  towerSnaps(b: Board): TowerSnap[] {
    return b.towers.map((t) => ({
      id: t.id,
      type: t.type,
      level: t.level,
      tx: t.tx,
      ty: t.ty,
      owner: t.owner,
      targeting: t.targeting,
      invested: t.invested,
      kills: t.kills,
      freeMove: t.freeMove,
      mult: t.mult,
    }));
  }

  /**
   * Build a snapshot. `knownVersions[boardId]` = towersVersion the receivers already have;
   * towers are included only for boards whose version differs. `drainFx` clears fx queues
   * (do this exactly once per broadcast).
   */
  snapshot(knownVersions: number[] | null, drainFx: boolean): Snapshot {
    const players: PlayerSnap[] = this.order.map((id) => {
      const p = this.players.get(id)!;
      return {
        id,
        money: Math.floor(p.money + 1e-6),
        income: Math.round(p.income),
        ready: p.ready,
        speedVote: p.speedVote,
        alive: p.alive,
        connected: p.connected && !p.left,
        cds: PACK_IDS.map((k) => Math.max(0, Math.round((p.cooldowns[k] - this.time) * 10) / 10)),
      };
    });
    const boards: BoardSnap[] = this.boards.map((b) => {
      const enemies: EnemyTuple[] = b.enemies
        .filter((e) => e.alive)
        .map((e) => [
          e.id,
          e.typeIdx,
          round2(e.x),
          round2(e.y),
          Math.max(0, Math.round((e.hp / e.maxHp) * 100) / 100),
          (e.slowTime > 0 ? ENEMY_FLAG.slowed : 0) |
            (e.shield > 0 ? ENEMY_FLAG.shielded : 0) |
            (e.burnTime > 0 ? ENEMY_FLAG.burning : 0) |
            (e.poisonTime > 0 && e.poisonStacks > 0 ? ENEMY_FLAG.poisoned : 0),
        ]);
      const shells: ShellTuple[] = b.shells.map((s) => [s.id, round2(s.x), round2(s.y), s.kind]);
      const aim: number[] = [];
      const beams: number[] = [];
      for (const t of b.towers) {
        if (t.targetId >= 0) aim.push(t.id, Math.round(t.angle * 100));
        if (t.beamTarget >= 0 && TOWERS[t.type].beam) {
          beams.push(t.id, t.beamTarget, Math.round(beamRamp(TOWERS[t.type].levels[t.level - 1], t.beamTime) * 100));
        }
      }
      const snap: BoardSnap = {
        id: b.id,
        lives: b.lives,
        alive: b.alive,
        enemies,
        towersVersion: b.towersVersion,
        shells,
        aim,
        beams,
        buffed: b.towers.filter((t) => t.buffDmg > 0).map((t) => t.id),
        fx: drainFx ? b.fx : b.fx.slice(),
      };
      if (!knownVersions || knownVersions[b.id] !== b.towersVersion) snap.towers = this.towerSnaps(b);
      if (drainFx) b.fx = [];
      return snap;
    });
    return {
      seq: this.seq,
      time: Math.round(this.time * 100) / 100,
      phase: this.phase,
      wave: this.wave,
      nextWaveIn: this.nextWaveIn === null ? null : Math.max(0, Math.round(this.nextWaveIn * 10) / 10),
      speed: this.speed,
      players,
      boards,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
