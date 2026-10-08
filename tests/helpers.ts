import { ENEMIES } from '../src/shared/config';
import { MAPS, pointOnPath, TILE_BUILDABLE, TILE_PATH, type GameMap } from '../src/shared/maps';
import type { EnemyType, GameMode, MapId, Difficulty } from '../src/shared/types';
import type { Board, Enemy } from '../src/server/sim/board';
import { createEnemy } from '../src/server/sim/enemies';
import { GameSim, makeRuleset, type Ruleset, type SimPlayerInit } from '../src/server/sim/game';

export function players(n: number, team?: (i: number) => number): SimPlayerInit[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i, team: team ? team(i) : 0 }));
}

export function makeSim(mode: GameMode, n: number, opts: { mapId?: MapId; difficulty?: Difficulty; rules?: Partial<Ruleset>; team?: (i: number) => number } = {}) {
  const rules = makeRuleset(mode, opts.mapId ?? 'greenfield', opts.difficulty ?? 'normal', opts.rules);
  return new GameSim(rules, players(n, opts.team));
}

/** Put an enemy on `board` at path distance `dist` (bypasses the spawn queue). */
export function spawnAt(sim: GameSim, board: Board, type: EnemyType, dist: number, hp?: number, path = 0): Enemy {
  const before = board.spawnCounter;
  const e = createEnemy(sim.nextId(), board, { at: 0, type, hp: hp ?? ENEMIES[type].hp, bountyMult: 1, sent: false, senderId: null, wave: true });
  board.spawnCounter = before;
  e.path = path;
  e.dist = dist;
  const p = pointOnPath(board.map.paths[path], dist);
  e.x = p.x;
  e.y = p.y;
  board.enemies.push(e);
  return e;
}

/** Place an enemy at an exact position (for geometry-only tests). */
export function enemyAtXY(sim: GameSim, board: Board, type: EnemyType, x: number, y: number, hp?: number): Enemy {
  const e = spawnAt(sim, board, type, 1, hp);
  e.x = x;
  e.y = y;
  return e;
}

export function firstTile(map: GameMap, kind: number, pred: (x: number, y: number) => boolean = () => true): { tx: number; ty: number } {
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) if (map.tiles[y * map.width + x] === kind && pred(x, y)) return { tx: x, ty: y };
  throw new Error('no tile');
}

export const greenfield = MAPS.greenfield;
export { TILE_BUILDABLE, TILE_PATH };

export function stepFor(sim: GameSim, seconds: number): void {
  const n = Math.round(seconds * 20);
  for (let i = 0; i < n; i++) sim.step();
}
