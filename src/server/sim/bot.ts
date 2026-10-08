// Headless bot. Used by the balance tests / `npm run balance` (fast-forward, no wall clock)
// and as the ranked backfill opponent / teammate.
//
// Building: every `thinkEvery` ticks, evaluate "build tower T at the best free tile" and
// "upgrade tower X" by (utility gained) / cost, where utility ≈ dps × type factor × a
// saturating function of how much path the tower covers. Take the best action if
// affordable, otherwise save for it. War Totems go where they buff the most dps.
// Sending (versus): an eco-vs-defence heuristic — only send money the defence doesn't
// need, prefer high income-per-cost packs early and raw threat later, and hold back
// while our own board is leaking.
import { SEND_PACKS, TOWERS } from '../../shared/config';
import { pointOnPath, TILE_BUILDABLE, type GameMap } from '../../shared/maps';
import { arenaForTrophies, BOT_LEVEL_BY_ARENA, towerPool, troopPool } from '../../shared/progression';
import { mulberry32 } from '../../shared/rng';
import { PACK_IDS, type PackId, type TargetMode, type TowerType } from '../../shared/types';
import type { Tower } from './board';
import type { GameSim } from './game';

const SAMPLE_STEP = 0.25;
const covCache = new Map<string, Float32Array>();

/** Path length (tiles) within `range` of each tile centre, cached per map+range. */
export function coverageMap(map: GameMap, range: number, minRange = 0): Float32Array {
  const key = `${map.id}:${range}:${minRange}`;
  let cov = covCache.get(key);
  if (cov) return cov;
  cov = new Float32Array(map.width * map.height);
  const samples: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const path of map.paths) {
    for (let d = 0; d <= path.length; d += SAMPLE_STEP) {
      const { x, y } = pointOnPath(path, d);
      if (x < 0 || y < 0 || x > map.width || y > map.height) continue;
      const k = `${x.toFixed(2)},${y.toFixed(2)}`;
      if (seen.has(k)) continue; // merged path sections count once
      seen.add(k);
      samples.push({ x, y });
    }
  }
  const r2 = range * range;
  const m2 = minRange * minRange;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.tiles[ty * map.width + tx] !== TILE_BUILDABLE) continue;
      let n = 0;
      for (const s of samples) {
        const dx = s.x - (tx + 0.5);
        const dy = s.y - (ty + 0.5);
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && d2 >= m2) n++;
      }
      cov[ty * map.width + tx] = n * SAMPLE_STEP;
    }
  }
  covCache.set(key, cov);
  return cov;
}

const TYPE_FACTOR: Record<TowerType, number> = {
  archer: 1.0,
  cannon: 1.7,
  frost: 1.5,
  sniper: 1.15,
  tesla: 1.6,
  mine: 0,
  flame: 1.35,
  mortar: 1.25,
  venom: 1.3,
  prism: 1.2,
  totem: 0,
};

/** Rough effective dps used for bot decisions (not used by the sim). */
export function levelDps(type: TowerType, level: number): number {
  const l = TOWERS[type].levels[level - 1];
  let dps = l.damage * l.rate;
  switch (type) {
    case 'tesla':
      dps *= 1 + 0.6 * ((l.chains ?? 1) - 1) * 0.5;
      break;
    case 'frost':
      dps = 22 + level * 10; // value of the slow, not the damage
      break;
    case 'flame':
      dps = dps * 1.8 + (l.burnDps ?? 0) * 1.5;
      break;
    case 'mortar':
      dps *= 2.2;
      break;
    case 'venom':
      dps += (l.poisonDps ?? 0) * (l.poisonMaxStacks ?? 1) * 0.8;
      break;
    case 'prism':
      dps = l.damage * (1 + (l.rampMax ?? 1)) * 0.5;
      break;
    case 'mine':
    case 'totem':
      dps = 0;
      break;
  }
  return dps;
}

const PREFERRED_MODE: Partial<Record<TowerType, TargetMode>> = { sniper: 'strong', prism: 'strong', mortar: 'first' };

export interface BotOptions {
  /** ticks between decisions (reaction delay) */
  thinkEvery?: number;
  /** 0..1: 1 = always best tile, lower = picks among worse tiles */
  skill?: number;
  /** versus: allowed to send troops */
  sends?: boolean;
  /** 0..1: how much spare money it is willing to spend on sends */
  aggression?: number;
  seed?: number;
}

/** Bot strength for a trophy count: reaction delay, placement quality, card level. */
export function botProfileForTrophies(trophies: number): { skill: number; thinkEvery: number; aggression: number; cardLevel: number; arena: number } {
  const t = Math.max(0, Math.min(1, trophies / 3500));
  const arena = arenaForTrophies(trophies);
  return {
    skill: 0.6 + 0.35 * t,
    thinkEvery: Math.round(16 - 9 * t),
    aggression: 0.35 + 0.35 * t,
    cardLevel: BOT_LEVEL_BY_ARENA[arena] ?? 1,
    arena,
  };
}

/** Arena-appropriate loadout and army for a bot. */
export function botLoadout(arena: number): { towers: TowerType[]; troops: PackId[] } {
  const pool = towerPool(arena);
  const order: TowerType[] = ['archer', 'frost', 'sniper', 'cannon', 'tesla', 'venom', 'flame', 'mortar', 'prism', 'totem'];
  const towers = order.filter((t) => pool.includes(t)).slice(0, 6);
  const troops = troopPool(arena).slice(-5);
  return { towers, troops };
}

export class Bot {
  private readonly thinkEvery: number;
  private readonly skill: number;
  private readonly sends: boolean;
  private readonly aggression: number;
  private readonly rng: () => number;
  private readonly offset: number;
  private lastLives = -1;
  private leakCooldown = 0;

  constructor(
    private readonly sim: GameSim,
    readonly pid: string,
    opts: BotOptions = {},
  ) {
    this.thinkEvery = Math.max(1, opts.thinkEvery ?? 10);
    this.skill = opts.skill ?? 1;
    this.sends = opts.sends ?? false;
    this.aggression = opts.aggression ?? 0.35;
    this.rng = mulberry32(opts.seed ?? 1234);
    this.offset = Math.floor(this.rng() * this.thinkEvery);
  }

  update(): void {
    if ((this.sim.tick + this.offset) % this.thinkEvery !== 0) return;
    const p = this.sim.players.get(this.pid);
    if (!p || !p.alive || p.left || this.sim.phase === 'over') return;
    const board = this.sim.boards[p.boardId];
    if (this.lastLives >= 0 && board.lives < this.lastLives) this.leakCooldown = 3;
    else if (this.leakCooldown > 0) this.leakCooldown--;
    this.lastLives = board.lives;
    // several actions per think if rich
    for (let i = 0; i < 4; i++) if (!this.think()) break;
    if (this.sends && this.sim.versus) this.trySend();
  }

  private utility(type: TowerType, level: number, cov: number): number {
    const w = this.sim.wave;
    let f = TYPE_FACTOR[type];
    // prepare for boss waves (every 10th) with long-range / ramping damage
    if ((type === 'sniper' || type === 'prism') && w % 10 >= 6) f *= 1.5;
    if ((type === 'cannon' || type === 'flame' || type === 'mortar') && w >= 5) f *= 1.15;
    if (type === 'archer' && w >= 12) f *= 0.85; // knights' armor
    return levelDps(type, level) * f * (1 - Math.exp(-cov / 6));
  }

  /** Cheapest "next good thing" the defence wants — what we keep in reserve before sending. */
  private nextDefenceCost = 100;

  private think(): boolean {
    const sim = this.sim;
    const p = sim.players.get(this.pid)!;
    const board = sim.boards[p.boardId];
    const map = board.map;
    const mine = board.towers.filter((t) => t.owner === this.pid);
    const counts: Partial<Record<TowerType, number>> = {};
    for (const t of mine) counts[t.type] = (counts[t.type] ?? 0) + 1;
    // frost only pays off next to damage dealers: at most 1 frost per 4 damage towers on the board
    const boardFrost = board.towers.filter((t) => t.type === 'frost').length;
    const boardDamage = board.towers.filter((t) => TOWERS[t.type].attacks && t.type !== 'frost').length;
    const frostAllowed = boardFrost < Math.floor(boardDamage / 4) && (counts.frost ?? 0) < 2;

    type Action = { value: number; cost: number; run: () => boolean; key: string };
    const actions: Action[] = [];

    // build candidates
    for (const type of p.loadout) {
      if (type === 'mine') continue;
      const def = TOWERS[type];
      if (type === 'frost' && !frostAllowed) continue;
      if (type === 'tesla' && sim.wave < 8) continue;
      if ((type === 'sniper' || type === 'prism' || type === 'mortar') && sim.wave < 4) continue;
      if (type === 'totem') {
        const a = this.totemAction(board.id, mine);
        if (a) actions.push(a);
        continue;
      }
      const cov = coverageMap(map, def.levels[0].range, def.levels[0].minRange ?? 0);
      const tiles: { i: number; c: number }[] = [];
      for (let i = 0; i < cov.length; i++) {
        if (cov[i] <= 0 || board.tileTower.has(i)) continue;
        tiles.push({ i, c: cov[i] });
      }
      if (!tiles.length) continue;
      tiles.sort((a, b) => b.c - a.c || a.i - b.i);
      // lower skill → choose from a wider band of tiles
      const band = Math.max(1, Math.round((1 - this.skill) * Math.min(tiles.length, 20)));
      const pick = tiles[Math.floor(this.rng() * band)];
      const value = (this.utility(type, 1, pick.c) * p.towerMult[type]) / def.levels[0].cost;
      const tx = pick.i % map.width;
      const ty = Math.floor(pick.i / map.width);
      actions.push({
        value,
        cost: def.levels[0].cost,
        key: `b:${type}:${pick.i}`,
        run: () => {
          const r = sim.placeTower(this.pid, board.id, tx, ty, type);
          const mode = PREFERRED_MODE[type];
          if (r.ok && mode) sim.setTargeting(this.pid, r.towerId, mode);
          return r.ok;
        },
      });
    }

    // upgrade candidates
    for (const t of mine) {
      if (t.level >= 3 || !TOWERS[t.type].attacks) continue;
      const def = TOWERS[t.type];
      const covNow = coverageMap(map, def.levels[t.level - 1].range, def.levels[t.level - 1].minRange ?? 0)[t.ty * map.width + t.tx];
      const covNext = coverageMap(map, def.levels[t.level].range, def.levels[t.level].minRange ?? 0)[t.ty * map.width + t.tx];
      const gain = (this.utility(t.type, t.level + 1, covNext) - this.utility(t.type, t.level, covNow)) * t.mult;
      const cost = def.levels[t.level].cost;
      // slight preference for upgrading once the board is filling up
      const fill = Math.min(1.3, 0.9 + mine.length / 25);
      actions.push({ value: (gain / cost) * fill, cost, key: `u:${t.id}`, run: () => sim.upgradeTower(this.pid, t.id).ok });
    }

    if (!actions.length) return false;
    actions.sort((a, b) => b.value - a.value);
    const best = actions[0];
    this.nextDefenceCost = best.cost;
    if (p.money >= best.cost) return best.run();
    // can't afford the best: buy something cheaper only if we're very early / empty
    if (mine.length < 2) {
      const cheap = actions.find((a) => a.cost <= p.money);
      if (cheap) return cheap.run();
    }
    return false;
  }

  private totemAction(boardId: number, mine: Tower[]): { value: number; cost: number; run: () => boolean; key: string } | null {
    const sim = this.sim;
    const attackers = mine.filter((t) => TOWERS[t.type].attacks);
    if (attackers.length < 5) return null;
    if (mine.some((t) => t.type === 'totem') && attackers.length < 12) return null;
    const board = sim.boards[boardId];
    const map = board.map;
    const lvl = TOWERS.totem.levels[0];
    const r2 = (lvl.buffRadius ?? 2) ** 2;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== TILE_BUILDABLE || board.tileTower.has(i)) continue;
      const x = (i % map.width) + 0.5;
      const y = Math.floor(i / map.width) + 0.5;
      let score = 0;
      for (const t of attackers) {
        const dx = t.x - x;
        const dy = t.y - y;
        if (dx * dx + dy * dy <= r2 && t.buffDmg < (lvl.buffDmg ?? 0)) score += levelDps(t.type, t.level) * t.mult;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    const value = (bestScore * ((lvl.buffDmg ?? 0) + (lvl.buffRate ?? 0)) * 0.9) / lvl.cost;
    const tx = best % map.width;
    const ty = Math.floor(best / map.width);
    return { value, cost: lvl.cost, key: `t:${best}`, run: () => sim.placeTower(this.pid, boardId, tx, ty, 'totem').ok };
  }

  private trySend(): void {
    const sim = this.sim;
    const p = sim.players.get(this.pid)!;
    if (this.leakCooldown > 0) return; // we're leaking: defence first
    const board = sim.boards[p.boardId];
    // danger: enemies already past 70% of the path
    const danger = board.enemies.filter((e) => e.alive && e.dist > board.map.paths[e.path].length * 0.7).length;
    if (danger > 2) return;
    const reserve = this.nextDefenceCost * 0.6 + sim.wave * 12;
    const spare = (p.money - reserve) * this.aggression * 2;
    if (spare <= 0 || this.rng() > 0.5 + this.aggression * 0.5) return;
    const options = PACK_IDS.filter((id: PackId) => {
      const pack = SEND_PACKS[id];
      return p.troops.includes(id) && sim.wave >= pack.unlockWave && pack.cost <= spare && p.cooldowns[id] <= sim.time + 1e-9;
    });
    if (!options.length) return;
    // early: best income per coin (eco); later: biggest affordable threat
    const early = sim.wave < 10;
    options.sort((a, b) => {
      const pa = SEND_PACKS[a];
      const pb = SEND_PACKS[b];
      return early ? pb.income / pb.cost - pa.income / pa.cost || pb.cost - pa.cost : pb.cost - pa.cost;
    });
    sim.sendTroops(this.pid, options[0]);
  }
}
