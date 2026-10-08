// Trophy math (Elo-flavoured, Supercell feel) with arena gates and newbie protection.
import { ARENAS, arenaForTrophies, TROPHIES } from '../../shared/progression';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Trophies won for beating an opponent (team) averaging `oppAvg`. */
export function winTrophies(mine: number, oppAvg: number): number {
  return Math.round(clamp(TROPHIES.winBase + (oppAvg - mine) / TROPHIES.diffDivisor, TROPHIES.winMin, TROPHIES.winMax));
}

/** Trophies lost (positive number) when losing to an opponent averaging `oppAvg`. */
export function lossTrophies(mine: number, oppAvg: number): number {
  let loss = clamp(TROPHIES.lossBase + (mine - oppAvg) / TROPHIES.diffDivisor, TROPHIES.lossMin, TROPHIES.lossMax);
  if (mine < TROPHIES.newbieProtection) loss /= 2;
  return Math.round(loss);
}

/**
 * Highest arena threshold at or below `trophies` — you can never drop below the gate of
 * an arena you've reached. (Using the current count rather than the all-time best keeps
 * this correct after a season soft reset moved you below an old gate.)
 */
export function gateFloor(trophies: number): number {
  return ARENAS[arenaForTrophies(trophies)].trophies;
}

export interface TrophyChange {
  before: number;
  after: number;
  delta: number;
  best: number;
}

/** Apply a result to one ladder. */
export function applyTrophies(current: number, best: number, oppAvg: number, won: boolean): TrophyChange {
  const raw = won ? current + winTrophies(current, oppAvg) : current - lossTrophies(current, oppAvg);
  const after = Math.max(0, won ? raw : Math.max(raw, gateFloor(current)));
  return { before: current, after, delta: after - current, best: Math.max(best, after) };
}

export function average(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Season soft reset: trophies above the threshold lose a share of the excess. */
export function softReset(trophies: number, above: number, keep: number): number {
  return trophies > above ? Math.round(above + (trophies - above) * keep) : trophies;
}
