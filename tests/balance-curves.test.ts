// Locks the upgrade and send curves so eco, armor, and splash breakpoints stay real.
import { describe, expect, it } from 'vitest';
import { Bot, levelDps } from '../src/server/sim/bot';
import { GameSim, makeRuleset } from '../src/server/sim/game';
import { armoredDps, minePaybackWaves, packEcoRatio, sendRole, upgradeSpend } from '../src/shared/combatMath';
import { ENEMIES, TOWERS } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import { pathCoverage } from '../src/shared/reach';
import { CLASSIC_TOWERS, type PackId } from '../src/shared/types';

const ECO_THEN_THREAT: PackId[] = ['grunts', 'swarm', 'runners', 'splitters', 'brutes', 'shields', 'knights', 'healers', 'warlord'];

describe('send and upgrade curves', () => {
  it('cheap sends pay more income per gold than heavy sends', () => {
    for (let i = 1; i < ECO_THEN_THREAT.length; i++) {
      expect(packEcoRatio(ECO_THEN_THREAT[i - 1])).toBeGreaterThan(packEcoRatio(ECO_THEN_THREAT[i]));
    }
    expect(sendRole('grunts')).toBe('eco');
    expect(sendRole('brutes')).toBe('mixed');
    expect(sendRole('warlord')).toBe('threat');
  });

  it('a gold mine upgrade pays back faster than opening another level-1 mine', () => {
    expect(minePaybackWaves(2)).toBeLessThan(minePaybackWaves(1));
    const levels = TOWERS.mine.levels;
    const l1 = (levels[0].income ?? 0) / levels[0].cost;
    const l3 = ((levels[2].income ?? 0) - (levels[1].income ?? 0)) / levels[2].cost;
    expect(l3).toBeGreaterThan(l1);
    expect(minePaybackWaves(1)).toBeLessThan(8);
  });

  it('archer level 2 punches through knight armor instead of sitting on the floor', () => {
    const armor = ENEMIES.knight.armor;
    const l1 = armoredDps('archer', 1, armor);
    const l2 = armoredDps('archer', 2, armor);
    expect(l2).toBeGreaterThanOrEqual(l1 * 4);
  });

  it('cannon level 2 is a real splash step, and sniper level 2 beats another sniper per gold', () => {
    const cannon = TOWERS.cannon.levels;
    expect((cannon[1].splash ?? 0) - (cannon[0].splash ?? 0)).toBeGreaterThanOrEqual(0.4);
    const sniper = upgradeSpend('sniper', 1);
    expect(sniper?.beatsNewCopy).toBe(true);
  });

  it('frost level 3 is worth more to the bot than another small slow', () => {
    expect(levelDps('frost', 3)).toBeGreaterThan(levelDps('frost', 2) * 1.4);
    expect(levelDps('frost', 2)).toBeGreaterThan(levelDps('frost', 1) * 1.3);
  });

  it('every attacking upgrade adds meaningful practical road coverage', () => {
    for (const tower of Object.values(TOWERS).filter((t) => t.attacks)) {
      const averages = tower.levels.map((level) => {
        let road = 0;
        let squares = 0;
        for (const map of Object.values(MAPS)) {
          for (let ty = 0; ty < map.height; ty++) {
            for (let tx = 0; tx < map.width; tx++) {
              if (map.tiles[ty * map.width + tx] !== TILE_BUILDABLE) continue;
              road += pathCoverage(map, tx, ty, level.range, level.minRange ?? 0).spans.reduce(
                (sum, span) => sum + Math.hypot(span.x2 - span.x1, span.y2 - span.y1),
                0,
              );
              squares++;
            }
          }
        }
        return road / squares;
      });
      expect(averages[1] / averages[0], `${tower.name} L2 range value`).toBeGreaterThanOrEqual(1.12);
      expect(averages[2] / averages[1], `${tower.name} L3 range value`).toBeGreaterThanOrEqual(1.12);
    }
  });
});

describe('bot eco', () => {
  it('buys one gold mine after the opening towers, and not a second', () => {
    const rules = makeRuleset('coop', 'greenfield', 'normal');
    const sim = new GameSim(rules, [{ id: 'b', name: 'B', colorIndex: 0, team: 0, loadout: [...CLASSIC_TOWERS] }]);
    const bot = new Bot(sim, 'b', { seed: 7, skill: 1, thinkEvery: 4 });
    const cap = 20 * 60 * 12;
    for (let i = 0; i < cap && sim.phase !== 'over' && sim.wave < 12; i++) {
      sim.step();
      bot.update();
    }
    const mines = sim.boards[0].towers.filter((t) => t.type === 'mine');
    expect(mines.length).toBe(1);
    expect(sim.boards[0].towers.filter((t) => t.type !== 'mine').length).toBeGreaterThanOrEqual(4);
  });
});
