// Target acquisition for towers.
import type { TargetMode } from '../../shared/types';
import type { Board, Enemy } from './board';

/**
 * Pick a target within `range` of (x, y).
 *  first     – closest to the exit (least remaining path distance)
 *  last      – furthest from the exit
 *  strong    – highest current HP (ties → first)
 *  close     – nearest to the tower (ties → first)
 */
export function selectTarget(
  board: Board,
  x: number,
  y: number,
  range: number,
  mode: TargetMode,
  minRange = 0,
  eligible: (enemy: Enemy) => boolean = () => true,
): Enemy | null {
  const r2 = range * range;
  const min2 = minRange * minRange;
  let best: Enemy | null = null;
  let bestKey = 0;
  let bestRemain = 0;
  for (const e of board.enemies) {
    if (!e.alive || !eligible(e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2 || d2 < min2) continue;
    const remain = board.map.paths[e.path].length - e.dist;
    let key: number;
    switch (mode) {
      case 'first':
        key = -remain;
        break;
      case 'last':
        key = remain;
        break;
      case 'strong':
        key = e.hp;
        break;
      case 'close':
        key = -d2;
        break;
    }
    if (
      best === null ||
      key > bestKey + 1e-9 ||
      (Math.abs(key - bestKey) <= 1e-9 && (remain < bestRemain - 1e-9 || (Math.abs(remain - bestRemain) <= 1e-9 && e.id < best.id)))
    ) {
      best = e;
      bestKey = key;
      bestRemain = remain;
    }
  }
  return best;
}

export function enemiesInRadius(board: Board, x: number, y: number, r: number, eligible: (enemy: Enemy) => boolean = () => true): Enemy[] {
  const r2 = r * r;
  const out: Enemy[] = [];
  for (const e of board.enemies) {
    if (!e.alive || !eligible(e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r2) out.push(e);
  }
  return out;
}

/** Nearest living enemy to (x, y) within r that is not in `exclude`. */
export function nearestEnemy(
  board: Board,
  x: number,
  y: number,
  r: number,
  exclude: Set<number>,
  eligible: (enemy: Enemy) => boolean = () => true,
): Enemy | null {
  const r2 = r * r;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of board.enemies) {
    if (!e.alive || exclude.has(e.id) || !eligible(e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && (d2 < bestD - 1e-9 || (Math.abs(d2 - bestD) <= 1e-9 && best && e.id < best.id))) {
      best = e;
      bestD = d2;
    }
  }
  return best;
}
