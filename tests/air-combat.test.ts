import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import { ENEMY_TYPES, type TowerType } from '../src/shared/types';
import { generateWave } from '../src/shared/waves';
import { canTowerTarget, updateTowers } from '../src/server/sim/towers';
import { enemyAtXY, firstTile, makeSim } from './helpers';

function oneShot(type: TowerType, enemyType: 'grunt' | 'bat'): number {
  const sim = makeSim('coop', 1);
  sim.nextWaveIn = null;
  const p = sim.players.get('p0')!;
  p.money = 1_000_000;
  p.loadout = [type];
  const board = sim.boards[0];
  const { tx, ty } = firstTile(MAPS.greenfield, TILE_BUILDABLE, (x, y) => x === 10 && y === 10);
  const placed = sim.placeTower('p0', 0, tx, ty, type);
  if (!placed.ok) throw new Error(placed.error);
  const tower = sim.getTower(placed.towerId)!;
  const enemy = enemyAtXY(sim, board, enemyType, tower.x + 1, tower.y, 1000);
  updateTowers(sim, board, 0.05);
  return 1000 - enemy.hp;
}

describe('ground and air combat', () => {
  it('keeps ground-only towers from acquiring flyers', () => {
    const sim = makeSim('coop', 1);
    const bat = enemyAtXY(sim, sim.boards[0], 'bat', 10, 10, 100);
    for (const type of ['cannon', 'frost', 'flame', 'mortar', 'venom', 'prism'] as TowerType[]) {
      expect(canTowerTarget(type, bat), type).toBe(false);
    }
  });

  it('lets Archer hit air at 55%, specialists at full damage, and Crossbow at 165%', () => {
    expect(oneShot('archer', 'grunt')).toBeCloseTo(10);
    expect(oneShot('archer', 'bat')).toBeCloseTo(5.5);
    expect(oneShot('tesla', 'bat')).toBeCloseTo(22);
    expect(oneShot('sniper', 'bat')).toBeCloseTo(90);
    expect(oneShot('crossbow', 'grunt')).toBeCloseTo(24);
    expect(oneShot('crossbow', 'bat')).toBeCloseTo(39.6);
  });
});

describe('boss encounters', () => {
  it('has exactly 15 regular enemy types and five bosses', () => {
    expect(ENEMY_TYPES.filter((type) => !ENEMIES[type].boss)).toHaveLength(15);
    expect(ENEMY_TYPES.filter((type) => ENEMIES[type].boss)).toHaveLength(5);
  });

  it('introduces five distinct bosses, with bosses three and five in the air', () => {
    const expected = ['warlord', 'titan', 'stormRoc', 'colossus', 'voidDragon'] as const;
    const found = expected.map((_, i) => generateWave((i + 1) * 10).find((g) => ENEMIES[g.type].boss)?.type);
    expect(found).toEqual(expected);
    expect(ENEMIES[expected[0]].movement).toBe('ground');
    expect(ENEMIES[expected[1]].movement).toBe('ground');
    expect(ENEMIES[expected[2]].movement).toBe('air');
    expect(ENEMIES[expected[3]].movement).toBe('ground');
    expect(ENEMIES[expected[4]].movement).toBe('air');
    expect(ENEMIES.voidDragon.hp).toBeGreaterThan(ENEMIES.colossus.hp);
  });
});
