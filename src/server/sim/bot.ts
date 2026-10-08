// Headless greedy bot. Used by the balance test / `npm run balance` (fast-forward, no
// wall clock) and as a building block for AI opponents.
//
// Strategy: every `thinkEvery` ticks, evaluate "build tower T at the best free tile" and
// "upgrade tower X" by (utility gained) / cost, where utility ≈ dps × type factor ×
// a saturating function of how much path the tower covers. Take the best action if
// affordable, otherwise save for it.
import { SEND_PACKS, TOWERS } from '../../shared/config';
import { pointOnPath, TILE_BUILDABLE, type GameMap } from '../../shared/maps';
import { mulberry32 } from '../../shared/rng';
import { PACK_IDS, type PackId, type TowerType } from '../../shared/types';
import type { Tower } from './board';
import type { GameSim } from './game';

const SAMPLE_STEP = 0.25;
const covCache = new Map<string, Float32Array>();

/** Path length (tiles) within `range` of each tile centre, cached per map+range. */
export function coverageMap(map: GameMap, range: number): Float32Array {
  const key = `${map.id}:${range}`;
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
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.tiles[ty * map.width + tx] !== TILE_BUILDABLE) continue;
      let n = 0;
      for (const s of samples) {
        const dx = s.x - (tx + 0.5);
        const dy = s.y - (ty + 0.5);
        if (dx * dx + dy * dy <= r2) n++;
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
};

function levelDps(type: TowerType, level: number): number {
  const l = TOWERS[type].levels[level - 1];
  let dps = l.damage * l.rate;
  if (type === 'tesla') dps *= 1 + 0.6 * ((l.chains ?? 1) - 1) * 0.5;
  if (type === 'frost') dps = 22 + level * 10; // value of the slow, not the damage
  return dps;
}

export interface BotOptions {
  /** ticks between decisions */
  thinkEvery?: number;
  /** 0..1: 1 = always best tile, lower = picks among worse tiles */
  skill?: number;
  /** versus: allowed to send troops */
  sends?: boolean;
  /** fraction of spare money it is willing to spend on sends */
  aggression?: number;
  seed?: number;
  /** towers the bot is allowed to use (defaults to the sim loadout) */
  towers?: TowerType[];
  /** never build gold mines */
  noMines?: boolean;
}

export class Bot {
  private readonly thinkEvery: number;
  private readonly skill: number;
  private readonly sends: boolean;
  private readonly aggression: number;
  private readonly rng: () => number;
  private readonly offset: number;
  private saving: string | null = null;

  constructor(
    private readonly sim: GameSim,
    readonly pid: string,
    opts: BotOptions = {},
  ) {
    this.thinkEvery = opts.thinkEvery ?? 10;
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
    // several actions per think if rich
    for (let i = 0; i < 4; i++) if (!this.think()) break;
    if (this.sends) this.trySend();
  }

  private utility(type: TowerType, level: number, cov: number): number {
    const w = this.sim.wave;
    let f = TYPE_FACTOR[type];
    // prepare for boss waves (every 10th) with long-range armor-piercing damage
    if (type === 'sniper' && w % 10 >= 6) f *= 1.5;
    if (type === 'cannon' && w >= 5) f *= 1.15;
    if (type === 'archer' && w >= 12) f *= 0.85; // knights' armor
    return levelDps(type, level) * f * (1 - Math.exp(-cov / 6));
  }

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
      if (type === 'sniper' && sim.wave < 4) continue;
      const cov = coverageMap(map, def.levels[0].range);
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
      const factor = 1;
      const value = (this.utility(type, 1, pick.c) * factor) / def.levels[0].cost;
      const tx = pick.i % map.width;
      const ty = Math.floor(pick.i / map.width);
      actions.push({
        value,
        cost: def.levels[0].cost,
        key: `b:${type}:${pick.i}`,
        run: () => {
          const r = sim.placeTower(this.pid, board.id, tx, ty, type);
          if (r.ok && type === 'sniper') sim.setTargeting(this.pid, r.towerId, 'strong');
          return r.ok;
        },
      });
    }

    // upgrade candidates
    for (const t of mine) {
      if (t.level >= 3 || !TOWERS[t.type].attacks) continue;
      const def = TOWERS[t.type];
      const covNow = coverageMap(map, def.levels[t.level - 1].range)[t.ty * map.width + t.tx];
      const covNext = coverageMap(map, def.levels[t.level].range)[t.ty * map.width + t.tx];
      const gain = this.utility(t.type, t.level + 1, covNext) - this.utility(t.type, t.level, covNow);
      const cost = def.levels[t.level].cost;
      // slight preference for upgrading once the board is filling up
      const fill = Math.min(1.3, 0.9 + mine.length / 25);
      actions.push({ value: (gain / cost) * fill, cost, key: `u:${t.id}`, run: () => sim.upgradeTower(this.pid, t.id).ok });
    }

    if (!actions.length) return false;
    actions.sort((a, b) => b.value - a.value);
    const best = actions[0];
    if (p.money >= best.cost) {
      this.saving = null;
      return best.run();
    }
    // can't afford the best: buy something cheaper only if we're very early / empty
    if (mine.length < 2) {
      const cheap = actions.find((a) => a.cost <= p.money);
      if (cheap) return cheap.run();
    }
    this.saving = best.key;
    return false;
  }

  private trySend(): void {
    const sim = this.sim;
    const p = sim.players.get(this.pid)!;
    const reserve = 150 + sim.wave * 15;
    const spare = p.money - reserve;
    if (spare <= 0 || this.rng() > this.aggression) return;
    const options = PACK_IDS.filter((id: PackId) => {
      const pack = SEND_PACKS[id];
      return p.troops.includes(id) && sim.wave >= pack.unlockWave && pack.cost <= spare && p.cooldowns[id] <= sim.time;
    });
    if (!options.length) return;
    const id = options[options.length - 1];
    sim.sendTroops(this.pid, id);
  }
}

export function towerValueForBot(t: Tower): number {
  return levelDps(t.type, t.level);
}
