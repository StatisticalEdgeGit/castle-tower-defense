// Deterministic (seeded) AI wave generator. Same (wave, seed) → same spawn groups on every
// board, which is what keeps versus boards fair. Counts here are for ONE defender; the sim
// multiplies counts by defenderScale(k) and divides spacing by it.
import { WAVES } from './config';
import { hashSeed, mulberry32 } from './rng';
import type { EnemyType, SpawnGroup } from './types';

export function waveBudget(wave: number): number {
  const n = Math.max(0, wave - 1);
  return WAVES.budgetBase + WAVES.budgetLinear * n + WAVES.budgetQuad * n * n;
}

const REGULAR: EnemyType[] = ['grunt', 'runner', 'swarm', 'brute', 'knight', 'healer'];

function unlockedTypes(wave: number): EnemyType[] {
  return REGULAR.filter((t) => WAVES.unlock[t] <= wave);
}

function pickWeighted<T>(rng: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function bossCount(wave: number): number {
  if (wave <= 0 || wave % WAVES.bossEvery !== 0) return 0;
  return Math.max(1, Math.floor(wave / WAVES.bossEvery));
}

export function generateWave(wave: number, seed: number = WAVES.seed): SpawnGroup[] {
  const rng = mulberry32(hashSeed(seed, wave));
  let budget = waveBudget(wave);
  const groups: SpawnGroup[] = [];
  // spacing tightens a little as waves progress
  const tighten = Math.max(0.6, 1 - 0.012 * (wave - 1));

  const bosses = bossCount(wave);
  if (bosses > 0) budget *= 0.55; // fewer escorts on boss waves

  const unlocked = unlockedTypes(wave);
  const featured = REGULAR.find((t) => WAVES.unlock[t] === wave && t !== 'grunt');
  const shares: { type: EnemyType; points: number }[] = [];

  if (unlocked.length === 1) {
    shares.push({ type: 'grunt', points: budget });
  } else if (featured) {
    // introduction wave: the new type takes ~55%, grunts fill the rest
    shares.push({ type: featured, points: budget * 0.55 });
    shares.push({ type: 'grunt', points: budget * 0.45 });
  } else {
    const groupCount = 1 + (rng() < 0.65 ? 1 : 0) + (wave >= 14 && rng() < 0.55 ? 1 : 0);
    const pool = unlocked.slice();
    const chosen: EnemyType[] = [];
    for (let i = 0; i < groupCount && pool.length > 0; i++) {
      // newer types are a bit more likely, grunts stay common early
      const weights = pool.map((t) => (t === 'grunt' ? (wave < 10 ? 2 : 1) : 1 + Math.min(2, (wave - WAVES.unlock[t]) / 6)));
      const t = pickWeighted(rng, pool, weights);
      chosen.push(t);
      pool.splice(pool.indexOf(t), 1);
    }
    // healers never come alone: give them an escort
    if (chosen.length === 1 && chosen[0] === 'healer') chosen.push(rng() < 0.5 ? 'knight' : 'grunt');
    // random split, first group gets the biggest slice
    const raw = chosen.map((_, i) => (i === 0 ? 1.4 : 0.6) + rng() * 0.6);
    const sum = raw.reduce((a, b) => a + b, 0);
    chosen.forEach((t, i) => shares.push({ type: t, points: (budget * raw[i]) / sum }));
  }

  let delay = 0;
  for (const s of shares) {
    const pts = WAVES.points[s.type];
    const count = Math.max(1, Math.round(s.points / pts));
    const spacing = +(WAVES.spacing[s.type] * tighten).toFixed(3);
    groups.push({ type: s.type, count, spacing, delay: +delay.toFixed(2) });
    // next group starts partway through this one so they overlap a little
    delay += count * spacing * 0.6 + 1;
  }

  if (bosses > 0) {
    groups.push({ type: 'warlord', count: bosses, spacing: WAVES.spacing.warlord, delay: +(delay * 0.5 + 2).toFixed(2) });
  }
  return groups;
}

/** Total number of units in a wave (one defender). */
export function waveUnitCount(groups: SpawnGroup[]): number {
  return groups.reduce((a, g) => a + g.count, 0);
}
