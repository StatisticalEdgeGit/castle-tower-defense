// Client-side placement rules and the range preview shared by the board and the confirm bar.
import { ECONOMY, TOWERS } from '../../shared/config';
import { isRoadAdjacent, TILE_BUILDABLE } from '../../shared/maps';
import { pathCoverage, type PathCoverage } from '../../shared/reach';
import type { TowerType } from '../../shared/types';
import { game, type UiState } from './gameState';

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
}

export interface RangePreview {
  tx: number;
  ty: number;
  type: TowerType;
  level: number;
  range: number;
  minRange: number;
  maxRange: number;
  kind: 'attack' | 'buff' | 'none';
  ok: boolean;
  reason?: string;
  /** null when this tower does not shoot at the road (mine, totem) */
  reaches: boolean | null;
  closest: number;
  coverage: PathCoverage | null;
  /** road covered only after the tower is fully upgraded */
  maxCoverage: PathCoverage | null;
  movingId: number | null;
}

interface Radii {
  range: number;
  minRange: number;
  maxRange: number;
  kind: RangePreview['kind'];
}

/** Range measured from the centre of the square, matching the simulation. */
export function towerRadii(type: TowerType, level: number): Radii {
  const def = TOWERS[type];
  const lvl = def.levels[Math.max(0, Math.min(2, level - 1))];
  const max = def.levels[2];
  if (def.groundTarget) return { range: 0, minRange: 0, maxRange: 0, kind: 'none' };
  if (def.support) {
    return {
      range: lvl.buffRadius ?? lvl.range,
      minRange: 0,
      maxRange: max.buffRadius ?? max.range,
      kind: 'buff',
    };
  }
  if (!def.attacks || (lvl.range ?? 0) <= 0) return { range: 0, minRange: 0, maxRange: 0, kind: 'none' };
  return { range: lvl.range, minRange: lvl.minRange ?? 0, maxRange: max.range, kind: 'attack' };
}

/** Mirror of the server's placement rules, plus an optional tower to ignore while moving. */
export function placementCheck(
  boardId: number,
  tx: number,
  ty: number,
  type: TowerType,
  opts: { ignoreTowerId?: number; moving?: boolean } = {},
): PlacementCheck {
  const map = game.map;
  const latest = game.latest;
  if (!map || !latest || !game.info) return { ok: false };
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return { ok: false, reason: 'Out of bounds' };
  const me = game.me();
  const myInfo = game.myInfo();
  if (!me || !myInfo) return { ok: false };
  if (!me.alive) return { ok: false, reason: 'Eliminated' };
  if (myInfo.boardId !== boardId) return { ok: false, reason: 'Not your board' };
  if (map.tiles[ty * map.width + tx] !== TILE_BUILDABLE) return { ok: false, reason: "Can't build here" };
  const occ = game.towerAt(boardId, tx, ty);
  if (occ && occ.id !== opts.ignoreTowerId) return { ok: false, reason: 'Occupied' };
  if (TOWERS[type].roadside && !isRoadAdjacent(map, tx, ty)) return { ok: false, reason: 'Must be directly beside the road' };
  if (!opts.moving && type === 'mine') {
    const mines = (game.towers.get(boardId) ?? []).filter((t) => t.owner === game.myId && t.type === 'mine').length;
    if (mines >= ECONOMY.maxMinesPerPlayer) return { ok: false, reason: 'Max 3 mines' };
  }
  if (!opts.moving && me.money < TOWERS[type].levels[0].cost) return { ok: false, reason: 'Not enough money' };
  return { ok: true };
}

/** Live ghost: the pointer tile, or the last square locked in for confirm. */
export function placementPreview(boardId: number, ui: UiState): RangePreview | null {
  const map = game.map;
  if (!map) return null;

  let type: TowerType | null = null;
  let level = 1;
  let tile: { tx: number; ty: number } | null = null;
  let movingId: number | null = null;
  let ignoreTowerId: number | undefined;
  let moving = false;

  if (ui.buildType) {
    if (ui.viewBoard !== boardId) return null;
    type = ui.buildType;
    tile = ui.hover ?? ui.staged;
  } else if (ui.moveTowerId !== null) {
    const tw = game.findTower(ui.moveTowerId);
    if (!tw || tw.boardId !== boardId) return null;
    type = tw.type;
    level = tw.level;
    movingId = tw.id;
    ignoreTowerId = tw.id;
    moving = true;
    tile = ui.hover ?? ui.staged ?? { tx: tw.tx, ty: tw.ty };
  } else if (ui.selectedTower !== null) {
    const tw = game.findTower(ui.selectedTower);
    if (!tw || tw.boardId !== boardId) return null;
    type = tw.type;
    level = tw.level;
    tile = { tx: tw.tx, ty: tw.ty };
  }

  if (!type || !tile) return null;
  const radii = towerRadii(type, level);
  // Inspecting an existing tower only draws reach. Legality matters while placing or moving.
  const check =
    ui.buildType || ui.moveTowerId !== null
      ? placementCheck(boardId, tile.tx, tile.ty, type, { ignoreTowerId, moving })
      : { ok: true };
  const coverage = radii.kind === 'attack' ? pathCoverage(map, tile.tx, tile.ty, radii.range, radii.minRange) : null;
  const showMax = radii.kind === 'attack' && radii.maxRange > radii.range + 0.05;
  const maxCoverage = showMax ? pathCoverage(map, tile.tx, tile.ty, radii.maxRange, radii.minRange) : null;
  return {
    tx: tile.tx,
    ty: tile.ty,
    type,
    level,
    ...radii,
    ok: check.ok,
    reason: check.reason,
    reaches: coverage ? coverage.reaches : null,
    closest: coverage?.closest ?? Infinity,
    coverage,
    maxCoverage,
    movingId,
  };
}

/** Short line for the confirm bar. Explains a circle that overlaps the road square but misses the centreline. */
export function reachLabel(p: RangePreview): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (!p.ok) return { text: p.reason ?? "Can't place here", tone: 'bad' };
  if (p.kind === 'none') return { text: 'Confirm to place this square', tone: 'muted' };
  if (p.kind === 'buff') return { text: `Buffs towers whose centres sit inside ${p.range} tiles of this square's centre`, tone: 'ok' };
  if (p.minRange > 0 && p.closest < p.minRange && !p.reaches) {
    return { text: `The road is inside the ${p.minRange}-tile minimum range, so this mortar cannot hit it`, tone: 'warn' };
  }
  if (p.reaches) {
    const near = p.closest < 0.05 ? 'on top of the road' : `${p.closest.toFixed(1)} tiles from the road`;
    return { text: `Reaches the road · turret centre is ${near} (range ${p.range})`, tone: 'ok' };
  }
  if ((p.coverage?.grazed.length ?? 0) > 0) {
    return {
      text: `Circle touches the road square, but enemies walk the middle — ${p.closest.toFixed(1)} tiles away, range is ${p.range}`,
      tone: 'warn',
    };
  }
  return { text: `Does not reach the road · closest point is ${p.closest.toFixed(1)} tiles away, range is ${p.range}`, tone: 'warn' };
}
