import { describe, expect, it } from 'vitest';
import { manualRepairCost } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import type { TowerType } from '../src/shared/types';
import type { Tower } from '../src/server/sim/board';
import { moveEnemies, updateSiegeAttacks } from '../src/server/sim/enemies';
import { updateBuilders } from '../src/server/sim/towers';
import { enemyAtXY, firstTile, makeSim } from './helpers';

function place(type: TowerType, sim = makeSim('coop', 1), farFrom?: { tx: number; ty: number }): { sim: ReturnType<typeof makeSim>; tower: Tower } {
  sim.nextWaveIn = null;
  const p = sim.players.get('p0')!;
  p.money = 1_000_000;
  p.loadout = ['archer', 'builder', 'cannon', 'frost', 'sniper', 'tesla'];
  const tile = firstTile(MAPS.greenfield, TILE_BUILDABLE, (tx, ty) => !farFrom || Math.hypot(tx - farFrom.tx, ty - farFrom.ty) > 5);
  const result = sim.placeTower('p0', 0, tile.tx, tile.ty, type);
  if (!result.ok) throw new Error(result.error);
  return { sim, tower: sim.getTower(result.towerId)! };
}

describe('enemy structure attacks', () => {
  it('makes siege troops stop walking and damage a nearby tower', () => {
    const { sim, tower } = place('archer');
    const board = sim.boards[0];
    const raider = enemyAtXY(sim, board, 'raider', tower.x + 1, tower.y, 10_000);
    const dist = raider.dist;
    const hp = tower.hp;
    const siege = updateSiegeAttacks(board, 0.05);
    moveEnemies(board, 0.05, () => {}, siege.stalled);
    expect(siege.stalled.has(raider.id)).toBe(true);
    expect(raider.dist).toBe(dist);
    expect(tower.hp).toBe(hp - 18);
    expect(raider.towerTarget).toBe(tower.id);
  });

  it('destroys buildings and frees their tile for rebuilding', () => {
    const { sim, tower } = place('archer');
    const p = sim.players.get('p0')!;
    const board = sim.boards[0];
    tower.hp = 1;
    enemyAtXY(sim, board, 'raider', tower.x + 1, tower.y, 10_000);
    sim.step();
    expect(sim.getTower(tower.id)).toBeUndefined();
    expect(board.tileTower.has(tower.ty * board.map.width + tower.tx)).toBe(false);
    expect(sim.placeTower(p.id, board.id, tower.tx, tower.ty, 'archer').ok).toBe(true);
  });
});

describe('structure repairs', () => {
  it('allows a defender to pay for a full repair', () => {
    const { sim, tower } = place('cannon');
    const p = sim.players.get('p0')!;
    tower.hp = 125;
    const expected = manualRepairCost(tower.hp, tower.maxHp);
    const money = p.money;
    expect(sim.repairTower(p.id, tower.id)).toEqual({ ok: true, cost: expected });
    expect(tower.hp).toBe(tower.maxHp);
    expect(p.money).toBe(money - expected);
  });

  it('dispatches a visible builder who travels, repairs, and returns to the hut', () => {
    const first = place('builder');
    const hut = first.tower;
    const second = place('archer', first.sim, { tx: hut.tx, ty: hut.ty });
    const target = second.tower;
    target.hp = target.maxHp - 90;
    const home = { x: hut.x, y: hut.y };

    for (let i = 0; i < 40; i++) updateBuilders(first.sim.boards[0], 0.05);
    expect(Math.hypot(hut.builderX - home.x, hut.builderY - home.y)).toBeGreaterThan(0.5);
    expect(hut.builderTarget).toBe(target.id);

    for (let i = 0; i < 500; i++) updateBuilders(first.sim.boards[0], 0.05);
    expect(target.hp).toBe(target.maxHp);
    expect(hut.builderTarget).toBe(-1);
    expect(hut.builderX).toBeCloseTo(home.x, 3);
    expect(hut.builderY).toBeCloseTo(home.y, 3);

    const snap = first.sim.snapshot(null, false).boards[0];
    expect(snap.towerHp.find(([id]) => id === target.id)?.[1]).toBe(target.maxHp);
    expect(snap.builders[0][0]).toBe(hut.id);
  });
});
