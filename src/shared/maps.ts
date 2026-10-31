// Map ("level") definitions. Paths are axis-aligned waypoint lists in TILE coordinates; an
// enemy walks through tile centres (tile + 0.5). Waypoints may lie one tile outside the grid
// so enemies walk in from / out of the edge.
import { COOP_FINAL_WAVE, GRID_H, GRID_W } from './config';
import type { MapDecoration, MapId, Point } from './types';
import { mulberry32 } from './rng';

export const TILE_BUILDABLE = 0;
export const TILE_PATH = 1;
export const TILE_BLOCKED = 2;

export interface MapTheme {
  grassA: string;
  grassB: string;
  path: string;
  pathEdge: string;
  water: string;
  accent: string;
}

interface MapDef {
  id: MapId;
  name: string;
  badge: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  blurb: string;
  /** waypoint lists (tile coords) */
  paths: [number, number][][];
  /** explicit water rectangles [x, y, w, h] */
  water?: [number, number, number, number][];
  /** explicit rocks/trees */
  props?: [number, number, 'rock' | 'tree'][];
  /** random tree/rock scatter density on tiles ≥2 away from the path */
  scatter: number;
  /** probability a scattered prop is a rock (else tree) */
  rockRatio: number;
  seed: number;
  theme: MapTheme;
}

export interface PathData {
  /** waypoint centres in tile units */
  points: Point[];
  /** cumulative distance at each waypoint */
  cum: number[];
  length: number;
}

export interface GameMap {
  id: MapId;
  name: string;
  badge: MapDef['badge'];
  blurb: string;
  finalWave: number;
  width: number;
  height: number;
  /** GRID_W*GRID_H, TILE_BUILDABLE | TILE_PATH | TILE_BLOCKED */
  tiles: Uint8Array;
  decorations: MapDecoration[];
  paths: PathData[];
  /** distinct end points (the base) */
  exits: Point[];
  entries: Point[];
  theme: MapTheme;
}

/** True when a build square shares an edge with at least one road square. */
export function isRoadAdjacent(map: GameMap, tx: number, ty: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = tx + dx;
    const y = ty + dy;
    if (x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y * map.width + x] === TILE_PATH) return true;
  }
  return false;
}

const DEFS: MapDef[] = [
  {
    id: 'greenfield',
    name: 'Greenfield',
    badge: 'Easy',
    blurb: 'A long, winding road through peaceful meadows.',
    paths: [
      [
        [-1, 3],
        [5, 3],
        [5, 12],
        [11, 12],
        [11, 4],
        [17, 4],
        [17, 11],
        [23, 11],
        [23, 7],
        [28, 7],
      ],
    ],
    water: [[25, 11, 3, 5]],
    props: [
      [1, 7, 'tree'],
      [2, 11, 'tree'],
      [8, 0, 'rock'],
      [20, 8, 'tree'],
    ],
    scatter: 0.12,
    rockRatio: 0.25,
    seed: 11,
    theme: { grassA: '#2f6b3a', grassB: '#336f3e', path: '#a8875a', pathEdge: '#7d6340', water: '#2a6fa8', accent: '#5fbf6a' },
  },
  {
    id: 'canyon',
    name: 'Canyon Run',
    badge: 'Medium',
    blurb: 'A zig-zag gorge. Rocky walls limit where you can build.',
    paths: [
      [
        [-1, 2],
        [6, 2],
        [6, 6],
        [12, 6],
        [12, 10],
        [18, 10],
        [18, 13],
        [23, 13],
        [23, 8],
        [28, 8],
      ],
    ],
    props: [
      [8, 2, 'rock'],
      [9, 4, 'rock'],
      [14, 7, 'rock'],
      [15, 8, 'rock'],
      [2, 3, 'rock'],
      [3, 4, 'rock'],
      [20, 12, 'rock'],
      [21, 11, 'rock'],
      [25, 12, 'rock'],
      [14, 13, 'rock'],
    ],
    scatter: 0.3,
    rockRatio: 0.8,
    seed: 23,
    theme: { grassA: '#8a5a35', grassB: '#93613a', path: '#d8b77d', pathEdge: '#a7834f', water: '#3a7aa0', accent: '#e0a060' },
  },
  {
    id: 'crossroads',
    name: 'Crossroads',
    badge: 'Hard',
    blurb: 'Two roads, one gate. Enemies alternate between entrances.',
    paths: [
      [
        [-1, 3],
        [7, 3],
        [7, 8],
        [19, 8],
        [19, 3],
        [24, 3],
        [24, 12],
        [28, 12],
      ],
      [
        [-1, 13],
        [12, 13],
        [12, 8],
        [19, 8],
        [19, 3],
        [24, 3],
        [24, 12],
        [28, 12],
      ],
    ],
    water: [
      [0, 7, 3, 3],
      [14, 11, 3, 2],
    ],
    scatter: 0.14,
    rockRatio: 0.4,
    seed: 37,
    theme: { grassA: '#2b5f4c', grassB: '#2f6551', path: '#9c8a6a', pathEdge: '#6f6248', water: '#2a6c9a', accent: '#56c2a0' },
  },
  {
    id: 'spiral',
    name: 'The Spiral',
    badge: 'Expert',
    blurb: 'A short spiral into the heart of a lake. Little room to build.',
    paths: [
      [
        [28, 4],
        [22, 4],
        [22, 12],
        [8, 12],
        [8, 6],
        [15, 6],
        [15, 10],
        [11, 10],
      ],
    ],
    water: [
      [0, 0, 4, 16],
      [4, 0, 2, 2],
      [4, 14, 3, 2],
      [10, 7, 3, 2],
      [23, 12, 5, 4],
      [24, 6, 4, 2],
    ],
    scatter: 0.08,
    rockRatio: 0.6,
    seed: 41,
    theme: { grassA: '#33415e', grassB: '#374664', path: '#8e86a8', pathEdge: '#615b7c', water: '#1f4f86', accent: '#a58cff' },
  },
];

function buildPath(wps: [number, number][]): PathData {
  const points = wps.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x !== b.x && a.y !== b.y) throw new Error('paths must be axis-aligned');
    cum.push(cum[i - 1] + Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
  }
  return { points, cum, length: cum[cum.length - 1] };
}

/** Position along a path at distance d (clamped). Also returns the unit direction. */
export function pointOnPath(path: PathData, d: number): { x: number; y: number; dx: number; dy: number } {
  const { points, cum } = path;
  if (d <= 0) {
    const a = points[0];
    const b = points[1];
    return { x: a.x, y: a.y, dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
  }
  if (d >= path.length) {
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    return { x: b.x, y: b.y, dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
  }
  // binary search the segment
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo + 1];
  const t = (d - cum[lo]) / (cum[lo + 1] - cum[lo]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
}

function buildMap(def: MapDef): GameMap {
  const tiles = new Uint8Array(GRID_W * GRID_H);
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
  const paths = def.paths.map(buildPath);
  // mark path tiles
  for (const wps of def.paths) {
    for (let i = 1; i < wps.length; i++) {
      const [ax, ay] = wps[i - 1];
      const [bx, by] = wps[i];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 0; s <= steps; s++) {
        const x = ax + Math.sign(bx - ax) * s;
        const y = ay + Math.sign(by - ay) * s;
        if (inGrid(x, y)) tiles[y * GRID_W + x] = TILE_PATH;
      }
    }
  }
  const decorations: MapDecoration[] = [];
  const block = (x: number, y: number, kind: MapDecoration['kind']) => {
    if (!inGrid(x, y)) return;
    const i = y * GRID_W + x;
    if (tiles[i] !== TILE_BUILDABLE) return;
    tiles[i] = TILE_BLOCKED;
    decorations.push({ x, y, kind });
  };
  for (const [wx, wy, ww, wh] of def.water ?? []) {
    for (let y = wy; y < wy + wh; y++) for (let x = wx; x < wx + ww; x++) block(x, y, 'water');
  }
  for (const [x, y, kind] of def.props ?? []) block(x, y, kind);
  // seeded scatter, only on tiles at least 2 tiles (Chebyshev) from any path tile
  const rng = mulberry32(def.seed * 7919);
  const nearPath = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (inGrid(nx, ny) && tiles[ny * GRID_W + nx] === TILE_PATH) return true;
      }
    return false;
  };
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const r = rng();
      const kindRoll = rng();
      if (r < def.scatter && !nearPath(x, y)) block(x, y, kindRoll < def.rockRatio ? 'rock' : 'tree');
    }
  }
  const clampPt = (p: Point) => ({
    x: Math.min(GRID_W - 0.5, Math.max(0.5, p.x)),
    y: Math.min(GRID_H - 0.5, Math.max(0.5, p.y)),
  });
  const exits: Point[] = [];
  const entries: Point[] = [];
  for (const p of paths) {
    const e = clampPt(p.points[p.points.length - 1]);
    if (!exits.some((q) => q.x === e.x && q.y === e.y)) exits.push(e);
    entries.push(clampPt(p.points[0]));
  }
  return {
    id: def.id,
    name: def.name,
    badge: def.badge,
    blurb: def.blurb,
    finalWave: COOP_FINAL_WAVE[def.id],
    width: GRID_W,
    height: GRID_H,
    tiles,
    decorations,
    paths,
    exits,
    entries,
    theme: def.theme,
  };
}

export const MAPS: Record<MapId, GameMap> = Object.fromEntries(DEFS.map((d) => [d.id, buildMap(d)])) as Record<MapId, GameMap>;
export const MAP_IDS: MapId[] = DEFS.map((d) => d.id);

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && (MAP_IDS as string[]).includes(v);
}

export function tileAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return TILE_BLOCKED;
  return map.tiles[ty * map.width + tx];
}
