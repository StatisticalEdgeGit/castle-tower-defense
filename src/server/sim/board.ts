// Board state: one defended copy of a map (co-op: one shared board; FFA: one per player;
// 2v2: one per team).
import type { Fx } from '../../shared/protocol';
import { TOWERS, type EnemyDef } from '../../shared/config';
import { isRoadAdjacent, tileAt, TILE_BUILDABLE, type GameMap } from '../../shared/maps';
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
  /** HP multiplier this enemy spawned with (children of splitters inherit it) */
  hpMult: number;
  /** damage absorbed before HP (shieldbearer pulse) */
  shield: number;
  /** shieldbearer: its one-time pulse has fired */
  pulsed: boolean;
  burnDps: number;
  burnTime: number;
  burnTower: Tower | null;
  poisonStacks: number;
  poisonDps: number;
  poisonTime: number;
  poisonTower: Tower | null;
  /** Siege combat state. -1 means the enemy is walking normally. */
  towerTarget: number;
  towerAttackCooldown: number;
  towerScanCooldown: number;
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
  /** card level the tower was built with (1–10) */
  cardLevel: number;
  /** strongest War Totem buffs currently applying to this tower */
  buffDmg: number;
  buffRate: number;
  /** prism beam state */
  beamTarget: number;
  beamTime: number;
  kills: number;
  damage: number;
  /** owner may slide this tower onto another square once, for free */
  freeMove: boolean;
  /** Buildings can be attacked, repaired, and destroyed. */
  hp: number;
  maxHp: number;
  /** Worker state (used by Builder Huts; harmless defaults on other towers). */
  builderX: number;
  builderY: number;
  builderTarget: number;
  builderRepairing: boolean;
  /** Persistent impact coordinate used by manually aimed towers. */
  targetX: number;
  targetY: number;
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
  /** cannon shells follow their target; mortar shells fly to a fixed point */
  homing: boolean;
  /** 0 = cannon shell, 1 = mortar shell (client visuals) */
  kind: number;
  slow: number;
  slowDuration: number;
  knockback: number;
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
export function placementError(board: Board, tx: number, ty: number, type?: TowerType): string | null {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return 'Invalid tile';
  if (tx < 0 || ty < 0 || tx >= board.map.width || ty >= board.map.height) return 'Out of bounds';
  const t = tileAt(board.map, tx, ty);
  if (t !== TILE_BUILDABLE) return t === 1 ? "Can't build on the path" : "Can't build there";
  if (board.tileTower.has(ty * board.map.width + tx)) return 'Tile occupied';
  if (type && TOWERS[type].roadside && !isRoadAdjacent(board.map, tx, ty)) return 'Must be placed directly beside the road';
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
