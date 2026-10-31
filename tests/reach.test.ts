import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/shared/maps';
import { pathCoverage, towerCenter } from '../src/shared/reach';
import { selectTarget } from '../src/server/sim/targeting';
import { enemyAtXY, makeSim } from './helpers';

const map = MAPS.greenfield;

describe('pathCoverage', () => {
  it('measures range from the centre of the square to the road centreline', () => {
    // Greenfield's first road runs through tile centres at y = 3.5, including x = 5.5.
    // A turret on square (7, 3) stands at (7.5, 3.5), exactly 2 tiles from that point.
    const c = towerCenter(7, 3);
    expect(c).toEqual({ x: 7.5, y: 3.5 });
    const hit = pathCoverage(map, 7, 3, 2);
    expect(hit.closest).toBeCloseTo(2, 5);
    expect(hit.reaches).toBe(true);
    expect(hit.reached).toContain(3 * map.width + 5);

    const miss = pathCoverage(map, 7, 3, 1.6);
    expect(miss.reaches).toBe(false);
    expect(miss.closest).toBeCloseTo(2, 5);
    // The circle still overlaps path square (5, 3): its right edge is x = 6, and the
    // turret centre is only 1.5 tiles from that edge, inside the 1.6 range.
    expect(miss.grazed).toContain(3 * map.width + 5);
    expect(miss.reached).not.toContain(3 * map.width + 5);
  });

  it('agrees with turret targeting for an enemy on the centreline', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const enemy = enemyAtXY(sim, b, 'grunt', 5.5, 3.5);
    const { x, y } = towerCenter(7, 3);
    expect(selectTarget(b, x, y, 2, 'first')?.id).toBe(enemy.id);
    expect(selectTarget(b, x, y, 1.6, 'first')).toBeNull();
    expect(pathCoverage(map, 7, 3, 2).reaches).toBe(true);
    expect(pathCoverage(map, 7, 3, 1.6).reaches).toBe(false);
  });

  it('treats a mortar hole as a miss even when the outer circle covers the square', () => {
    // Square (6, 3) is 1 tile from the road centre. Minimum range 3 hides that point,
    // but a long range still reaches the road farther along.
    const cov = pathCoverage(map, 6, 3, 8, 3);
    expect(cov.closest).toBeCloseTo(1, 5);
    expect(cov.reaches).toBe(true);
    const near = 3 * map.width + 5;
    expect(cov.reached).not.toContain(near);
    expect(cov.grazed).toContain(near);
  });
});
