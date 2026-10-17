// What the next AI wave will actually spawn. Uses the same generator and defender
// scaling as the sim, so the HUD can show it before the wave starts.
import { ENEMIES, WAVES } from './config';
import type { EnemyType } from './types';
import { generateWave, scaledGroupCount } from './waves';

export interface WaveUnitPreview {
  type: EnemyType;
  name: string;
  count: number;
  /** True when this wave is the first one that can field this enemy. */
  debut: boolean;
}

export interface WavePreview {
  wave: number;
  boss: boolean;
  units: WaveUnitPreview[];
  total: number;
}

/**
 * Spawn list for AI wave `wave` on a board defended by `defenders` players.
 * `seed` must be the match's wave seed.
 */
export function previewWave(wave: number, seed: number, defenders: number): WavePreview {
  const used = Number.isFinite(seed) ? seed : WAVES.seed;
  const units: WaveUnitPreview[] = [];
  for (const group of generateWave(wave, used)) {
    const count = scaledGroupCount(group.count, defenders);
    const existing = units.find((u) => u.type === group.type);
    if (existing) existing.count += count;
    else {
      units.push({
        type: group.type,
        name: ENEMIES[group.type].name,
        count,
        debut: WAVES.unlock[group.type] === wave,
      });
    }
  }
  return {
    wave,
    boss: units.some((u) => u.type === 'warlord'),
    units,
    total: units.reduce((sum, u) => sum + u.count, 0),
  };
}
