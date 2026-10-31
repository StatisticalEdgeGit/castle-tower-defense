import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W } from '../src/shared/config';
import { MAPS, TILE_PATH } from '../src/shared/maps';

describe('expanded maps', () => {
  it('uses the larger board footprint on every map', () => {
    expect([GRID_W, GRID_H]).toEqual([28, 16]);
    expect(GRID_W * GRID_H).toBeGreaterThan(24 * 14);
    for (const map of Object.values(MAPS)) {
      expect([map.width, map.height], map.name).toEqual([GRID_W, GRID_H]);
      expect(map.tiles.length, map.name).toBe(GRID_W * GRID_H);
    }
  });

  it('keeps every in-bounds route segment marked as road', () => {
    for (const map of Object.values(MAPS)) {
      for (const path of map.paths) {
        expect(path.points.length, map.name).toBeGreaterThan(1);
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1];
          const b = path.points[i];
          expect(a.x === b.x || a.y === b.y, `${map.name} segment ${i}`).toBe(true);
          const ax = a.x - 0.5;
          const ay = a.y - 0.5;
          const bx = b.x - 0.5;
          const by = b.y - 0.5;
          const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          for (let step = 0; step <= steps; step++) {
            const x = ax + Math.sign(bx - ax) * step;
            const y = ay + Math.sign(by - ay) * step;
            if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
            expect(map.tiles[y * map.width + x], `${map.name} road at ${x},${y}`).toBe(TILE_PATH);
          }
        }
      }
    }
  });
});
