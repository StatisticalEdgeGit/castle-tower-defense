// Whether a tower on a grid square can actually hit the road.
//
// Towers shoot from the centre of their square (tx + 0.5, ty + 0.5). Enemies walk the
// centreline of path squares, not the edges. A range circle can overlap a path square
// and still miss every enemy, because the centreline sits half a tile in from the edge.
import { TILE_PATH, type GameMap } from './maps';

export interface CoverageSpan {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PathCoverage {
  /** closest distance from the tower centre to the path enemies walk */
  closest: number;
  /** some point on that path lies inside [minRange, range] */
  reaches: boolean;
  /** path-tile indices where an enemy on the centreline is in range */
  reached: number[];
  /** path-tile indices the circle overlaps, but the centreline there is not in range */
  grazed: number[];
  /** centreline pieces that are actually in range (tile units) */
  spans: CoverageSpan[];
}

/** Centre of the placement square. This is the origin of the range circle. */
export function towerCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx + 0.5, y: ty + 0.5 };
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function distToRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const x = Math.max(x0, Math.min(px, x1));
  const y = Math.max(y0, Math.min(py, y1));
  return Math.hypot(px - x, py - y);
}

/** Positions along an axis, measured from `origin`, whose distance to the tower is inside the annulus. */
function annulusIntervals(origin: number, delta: number, minRange: number, range: number, a0: number, a1: number): [number, number][] {
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const outer = diskInterval(origin, delta, range);
  if (!outer) return [];
  const clipped = clipInterval(outer, lo, hi);
  if (!clipped) return [];
  if (minRange <= 0) return [clipped];
  const inner = diskInterval(origin, delta, minRange);
  if (!inner) return [clipped];
  const hole = clipInterval(inner, clipped[0], clipped[1]);
  if (!hole) return [clipped];
  const spans: [number, number][] = [];
  if (hole[0] > clipped[0] + 1e-6) spans.push([clipped[0], hole[0]]);
  if (clipped[1] > hole[1] + 1e-6) spans.push([hole[1], clipped[1]]);
  return spans;
}

function diskInterval(origin: number, delta: number, radius: number): [number, number] | null {
  const h2 = radius * radius - delta * delta;
  if (h2 < 0) return null;
  const h = Math.sqrt(h2);
  return [origin - h, origin + h];
}

function clipInterval(span: [number, number], lo: number, hi: number): [number, number] | null {
  const a = Math.max(span[0], lo);
  const b = Math.min(span[1], hi);
  if (b < a) return null;
  return [a, b];
}

function markSpan(tiles: Set<number>, width: number, height: number, a: number, b: number, fixed: number, horizontal: boolean): void {
  if (b < a) return;
  const n = Math.max(1, Math.ceil((b - a) / 0.05));
  for (let k = 0; k <= n; k++) {
    const p = a + ((b - a) * k) / n;
    const ix = horizontal ? Math.floor(p) : Math.floor(fixed);
    const iy = horizontal ? Math.floor(fixed) : Math.floor(p);
    if (ix >= 0 && iy >= 0 && ix < width && iy < height) tiles.add(iy * width + ix);
  }
}

/**
 * Compare a tower square with the road enemies actually walk.
 * `range` and `minRange` are in tiles, measured from the centre of `(tx, ty)`.
 */
export function pathCoverage(map: GameMap, tx: number, ty: number, range: number, minRange = 0): PathCoverage {
  const { x: cx, y: cy } = towerCenter(tx, ty);
  const r = Math.max(0, range);
  const minR = Math.max(0, minRange);
  const reachedTiles = new Set<number>();
  const spans: CoverageSpan[] = [];
  let closest = Infinity;
  let reaches = false;
  const w = map.width;
  const h = map.height;

  for (const path of map.paths) {
    const pts = path.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const d = distToSeg(cx, cy, a.x, a.y, b.x, b.y);
      if (d < closest) closest = d;
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const intervals = horizontal
        ? annulusIntervals(cx, a.y - cy, minR, r, a.x, b.x)
        : annulusIntervals(cy, a.x - cx, minR, r, a.y, b.y);
      for (const [p0, p1] of intervals) {
        // A zero-length span is a tangent hit. The sim treats distance == range as in range.
        if (p1 < p0 - 1e-9) continue;
        reaches = true;
        if (horizontal) {
          spans.push({ x1: p0, y1: a.y, x2: p1, y2: a.y });
          markSpan(reachedTiles, w, h, p0, p1, a.y, true);
        } else {
          spans.push({ x1: a.x, y1: p0, x2: a.x, y2: p1 });
          markSpan(reachedTiles, w, h, p0, p1, a.x, false);
        }
      }
    }
  }

  const grazed: number[] = [];
  if (r > 0) {
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== TILE_PATH || reachedTiles.has(i)) continue;
      const px = i % w;
      const py = (i / w) | 0;
      if (distToRect(cx, cy, px, py, px + 1, py + 1) <= r + 1e-4) grazed.push(i);
    }
  }

  return {
    closest: Number.isFinite(closest) ? closest : Infinity,
    reaches,
    reached: [...reachedTiles],
    grazed,
    spans,
  };
}
