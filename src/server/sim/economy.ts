// Economy + scaling helpers. See the BALANCING MODEL comment in src/shared/config.ts.
import {
  defenderHpScale,
  defenderScale,
  DIFFICULTY,
  ECONOMY,
  ENEMIES,
  startCashPerPlayer,
  waveBonusPerPlayer,
  waveHpMultiplier,
} from '../../shared/config';
import type { Difficulty, EnemyType, SpawnGroup } from '../../shared/types';
import { scaledGroupCount } from '../../shared/waves';

export interface Escalation {
  /** escalation starts after this wave */
  startWave: number;
  /** HP multiplier per wave beyond startWave */
  hpPerWave: number;
}

/** HP of one enemy of `type` on wave `wave` for a board with k defenders. */
export function enemyHp(type: EnemyType, wave: number, difficulty: Difficulty, k: number, escalation: Escalation | null = null): number {
  let hp = ENEMIES[type].hp * waveHpMultiplier(wave) * DIFFICULTY[difficulty].hpMult * defenderHpScale(k);
  if (escalation && wave > escalation.startWave) hp *= Math.pow(escalation.hpPerWave, wave - escalation.startWave);
  return Math.round(hp);
}

export interface ScaledGroup extends SpawnGroup {
  /**
   * HP compensation for count rounding: 1 boss × 1.6 → 2 bosses at 0.8× HP, so the total
   * HP on the board is exactly defenderScale(k) × the solo total.
   */
  hpComp: number;
}

/** Scale one-defender spawn groups for a board with k defenders (count ×ds, spacing ÷ds). */
export function scaleWaveForBoard(groups: SpawnGroup[], k: number): ScaledGroup[] {
  const ds = defenderScale(k);
  return groups.map((g) => {
    const exact = g.count * ds;
    const count = scaledGroupCount(g.count, k);
    return { type: g.type, count, spacing: g.spacing / ds, delay: g.delay, hpComp: exact / count };
  });
}

/** Board lives scale with the enemy count so a leak costs the same fraction of lives. */
export function boardLives(baseLives: number, k: number): number {
  return Math.round(baseLives * defenderScale(k));
}

/** Units actually spawned when a pack of `count` is sent into a board with k defenders. */
export function scaledSendCount(count: number, k: number): number {
  return Math.max(1, Math.round(count * defenderScale(k)));
}

export function startingCash(k: number, difficulty: Difficulty): number {
  return startCashPerPlayer(k, difficulty);
}

export function waveBonus(wave: number, k: number): number {
  return waveBonusPerPlayer(wave, k);
}

export function earlyCallBonus(wave: number, k: number): number {
  return waveBonusPerPlayer(Math.max(1, wave), k) * ECONOMY.earlyCallBonusFactor;
}

export function sellRefund(invested: number): number {
  return Math.floor(invested * ECONOMY.sellRefund);
}

/** Even split of `amount` between `n` recipients. */
export function splitShare(amount: number, n: number): number {
  return n > 0 ? amount / n : 0;
}
