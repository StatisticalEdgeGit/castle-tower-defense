// Board state: one defended copy of a map (co-op: one shared board; FFA: one per player;
// 2v2: one per team).
import type { Fx } from '../../shared/protocol';
import type { EnemyDef } from '../../shared/config';
import { tileAt, TILE_BUILDABLE, type GameMap } from '../../shared/maps';
import type { EnemyType, TargetMode, TowerType } from '../../shared/types';

export interface Enemy {
  id: number;
  type: EnemyType;
  typeIdx: number;
  def: EnemyDef;
  path: number;
  dist: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  armor: number;
  speed: number;
  bounty: number;
  lives: number;
  /** current effective slow fraction (already reduced by slow resistance) */
  slowAmt: number;
  slowTime: number;
  sent: boolean;
  senderId: string | null;
  alive: boolean;
}

export interface Tower {
  id: number;
  boardId: number;
  type: TowerType;
  level: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  owner: string;
  invested: number;
  targeting: TargetMode;
  /** seconds until next shot (may go slightly negative to preserve fractional fire timing) */
  cooldown: number;
  angle: number;
  targetId: number;
  /** per-player stat multiplier (card level hook): damage, or income for mines */
  mult: number;
  kills: number;
  damage: number;
}

export interface Shell {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  targetId: number;
  speed: number;
  damage: number;
  splash: number;
  tower: Tower;
}

export interface QueuedSpawn {
  at: number;
  type: EnemyType;
  hp: number;
  bountyMult: number;
  sent: boolean;
  senderId: string | null;
  /** part of the AI wave (co-op "wave cleared" waits for these) */
  wave: boolean;
}

export interface Board {
  id: number;
  map: GameMap;
  defenders: string[];
  lives: number;
  maxLives: number;
  alive: boolean;
  eliminatedAt: number | null;
  eliminatedWave: number | null;
  enemies: Enemy[];
  towers: Tower[];
  shells: Shell[];
  queue: QueuedSpawn[];
  towersVersion: number;
  fx: Fx[];
  spawnCounter: number;
  /** tile index → tower */
  tileTower: Map<number, Tower>;
}

export function createBoard(id: number, map: GameMap, defenders: string[], lives: number): Board {
  return {
    id,
    map,
    defenders: defenders.slice(),
    lives,
    maxLives: lives,
    alive: true,
    eliminatedAt: null,
    eliminatedWave: null,
    enemies: [],
    towers: [],
    shells: [],
    queue: [],
    towersVersion: 1,
    fx: [],
    spawnCounter: 0,
    tileTower: new Map(),
  };
}

/** Returns an error string if a tower cannot be placed at (tx, ty), otherwise null. */
export function placementError(board: Board, tx: number, ty: number): string | null {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return 'Invalid tile';
  if (tx < 0 || ty < 0 || tx >= board.map.width || ty >= board.map.height) return 'Out of bounds';
  const t = tileAt(board.map, tx, ty);
  if (t !== TILE_BUILDABLE) return t === 1 ? "Can't build on the path" : "Can't build there";
  if (board.tileTower.has(ty * board.map.width + tx)) return 'Tile occupied';
  return null;
}

export function remainingDistance(board: Board, e: Enemy): number {
  return board.map.paths[e.path].length - e.dist;
}

/** Insert keeping the queue sorted by spawn time (stable for equal times). */
export function enqueueSpawn(board: Board, s: QueuedSpawn): void {
  const q = board.queue;
  let i = q.length;
  while (i > 0 && q[i - 1].at > s.at) i--;
  q.splice(i, 0, s);
}
