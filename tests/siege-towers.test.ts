import { describe, expect, it } from 'vitest';
import { TOWERS } from '../src/shared/config';
import { isRoadAdjacent, pointOnPath, TILE_BUILDABLE } from '../src/shared/maps';
import { updateShells, updateTowers } from '../src/server/sim/towers';
import { firstTile, makeSim, spawnAt } from './helpers';

function richSiegeSim() {
  const sim = makeSim('coop', 1);
  const p = sim.players.get('p0')!;
  p.money = 100_000;
  p.loadout = ['logroller', 'catapult'];
  sim.nextWaveIn = null;
  return sim;
}

describe('Log Roller', () => {
  it('can only be built or moved directly beside the road', () => {
    const sim = richSiegeSim();
    const board = sim.boards[0];
    const beside = firstTile(board.map, TILE_BUILDABLE, (x, y) => isRoadAdjacent(board.map, x, y));
    const away = firstTile(board.map, TILE_BUILDABLE, (x, y) => !isRoadAdjacent(board.map, x, y));

    expect(sim.placeTower('p0', 0, away.tx, away.ty, 'logroller')).toMatchObject({
      ok: false,
      error: 'Must be placed directly beside the road',
    });
    const placed = sim.placeTower('p0', 0, beside.tx, beside.ty, 'logroller');
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(sim.moveTower('p0', placed.towerId, away.tx, away.ty)).toMatchObject({
      ok: false,
      error: 'Must be placed directly beside the road',
    });
  });

  it('pierces a stretch of road, damages every ground troop, pushes them back and slows them', () => {
    const sim = richSiegeSim();
    const board = sim.boards[0];
    // This square is one tile above Greenfield's opening horizontal road.
    const placed = sim.placeTower('p0', 0, 1, 2, 'logroller');
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const lead = spawnAt(sim, board, 'grunt', 2, 500);
    const middle = spawnAt(sim, board, 'grunt', 1, 500);
    const back = spawnAt(sim, board, 'grunt', 0.2, 500);
    const boss = spawnAt(sim, board, 'warlord', 1.5, 5000);
    const flyer = spawnAt(sim, board, 'bat', 1.2, 500);
    const far = spawnAt(sim, board, 'grunt', 10, 500);
    updateTowers(sim, board, 0.05);

    const level = TOWERS.logroller.levels[0];
    for (const e of [lead, middle, back]) {
      expect(e.hp).toBe(500 - level.damage);
      expect(e.slowAmt).toBeCloseTo(level.slow!);
    }
    expect(lead.dist).toBeCloseTo(2 - level.knockback!);
    expect(middle.dist).toBeCloseTo(1 - level.knockback!);
    expect(back.dist).toBe(0);
    expect(boss.slowAmt).toBeCloseTo(level.slow! * 0.5);
    expect(boss.dist).toBeCloseTo(1.5 - level.knockback! * 0.5);
    expect(flyer.hp).toBe(500);
    expect(far.hp).toBe(500);
    expect(board.fx.some((fx) => fx.k === 'log')).toBe(true);
  });
});

describe('Catapult', () => {
  it('can be built anywhere and defaults to the first visible part of the road', () => {
    const sim = richSiegeSim();
    const board = sim.boards[0];
    const far = firstTile(board.map, TILE_BUILDABLE, (x, y) => x > 20 && y < 6);
    const placed = sim.placeTower('p0', 0, far.tx, far.ty, 'catapult');
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const tower = sim.getTower(placed.towerId)!;
    const expected = pointOnPath(board.map.paths[0], 1);
    expect(tower.targetX).toBeCloseTo(expected.x);
    expect(tower.targetY).toBeCloseTo(expected.y);
  });

  it('accepts an owner-selected impact tile and applies heavy splash control there', () => {
    const sim = richSiegeSim();
    const board = sim.boards[0];
    const build = firstTile(board.map, TILE_BUILDABLE, (x, y) => x > 20 && y < 6);
    const placed = sim.placeTower('p0', 0, build.tx, build.ty, 'catapult');
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    expect(sim.setGroundTarget('p0', placed.towerId, 5, 3)).toEqual({ ok: true });
    expect(sim.setGroundTarget('p0', placed.towerId, -1, 3)).toMatchObject({ ok: false });
    const nearA = spawnAt(sim, board, 'grunt', 6, 1000);
    const nearB = spawnAt(sim, board, 'grunt', 5.2, 1000);
    const outside = spawnAt(sim, board, 'grunt', 3.5, 1000);

    updateTowers(sim, board, 0.05);
    expect(board.shells).toHaveLength(1);
    expect(board.shells[0].kind).toBe(2);
    for (let i = 0; i < 100 && board.shells.length; i++) updateShells(sim, board, 0.05);

    const level = TOWERS.catapult.levels[0];
    for (const e of [nearA, nearB]) {
      expect(e.hp).toBe(1000 - level.damage);
      expect(e.slowAmt).toBeCloseTo(level.slow!);
    }
    expect(nearA.dist).toBeCloseTo(6 - level.knockback!);
    expect(nearB.dist).toBeCloseTo(5.2 - level.knockback!);
    expect(outside.hp).toBe(1000);
  });
});
