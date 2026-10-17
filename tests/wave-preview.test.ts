import { describe, expect, it } from 'vitest';
import { WAVES } from '../src/shared/config';
import { previewWave } from '../src/shared/wavePreview';
import { generateWave, scaledGroupCount } from '../src/shared/waves';
import { scaleWaveForBoard } from '../src/server/sim/economy';

describe('previewWave', () => {
  it('matches the counts the sim will spawn', () => {
    for (const wave of [1, 3, 5, 10, 12, 15, 20]) {
      for (const defenders of [1, 2, 3, 4]) {
        const fromSim = new Map<string, number>();
        for (const group of scaleWaveForBoard(generateWave(wave, WAVES.seed), defenders)) {
          fromSim.set(group.type, (fromSim.get(group.type) ?? 0) + group.count);
        }
        const preview = previewWave(wave, WAVES.seed, defenders);
        const fromPreview = new Map(preview.units.map((u) => [u.type, u.count]));
        expect(fromPreview).toEqual(fromSim);
        expect(preview.total).toBe([...fromSim.values()].reduce((a, b) => a + b, 0));
      }
    }
  });

  it('opens with grunts and marks a type on the wave it unlocks', () => {
    const first = previewWave(1, WAVES.seed, 1);
    expect(first.units.map((u) => u.type)).toEqual(['grunt']);
    expect(first.boss).toBe(false);
    expect(first.units[0].debut).toBe(true);

    const runners = previewWave(3, WAVES.seed, 1);
    expect(runners.units.find((u) => u.type === 'runner')?.debut).toBe(true);
    expect(runners.units.find((u) => u.type === 'grunt')?.debut).toBe(false);
  });

  it('falls back to the shared wave seed when the match has not sent one', () => {
    expect(previewWave(4, Number.NaN, 2)).toEqual(previewWave(4, WAVES.seed, 2));
  });

  it('puts a warlord on every 10th wave and scales that boss for a team', () => {
    const solo = previewWave(10, WAVES.seed, 1);
    const pair = previewWave(10, WAVES.seed, 2);
    expect(solo.boss).toBe(true);
    expect(pair.boss).toBe(true);
    const soloBoss = solo.units.find((u) => u.type === 'warlord')!.count;
    const pairBoss = pair.units.find((u) => u.type === 'warlord')!.count;
    expect(pairBoss).toBe(scaledGroupCount(soloBoss, 2));
    expect(pairBoss).toBeGreaterThan(soloBoss);
  });
});
