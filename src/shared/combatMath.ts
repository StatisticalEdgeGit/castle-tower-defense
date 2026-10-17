// Pure combat numbers shared by the sim and the tower panel, so the damage a
// player reads is the damage a hit actually deals.

import { ARMOR_MIN_FRACTION, SEND_PACKS, TOWERS } from './config';
import type { PackId, TowerType } from './types';

/**
 * Damage one hit deals after armor. Armor is subtracted per hit, but a hit
 * always connects for at least {@link ARMOR_MIN_FRACTION} of its raw damage.
 * Snipers and prism beams pass `ignoreArmor`.
 */
export function mitigatedDamage(raw: number, armor: number, ignoreArmor = false): number {
  if (!(raw > 0)) return 0;
  if (ignoreArmor) return raw;
  return Math.max(raw - armor, raw * ARMOR_MIN_FRACTION);
}

function ignoresArmor(type: TowerType): boolean {
  const def = TOWERS[type];
  return def.ignoresArmor === true || def.beam === true;
}

/**
 * Damage per second shown on the tower panel. Prism uses the midpoint of its
 * beam ramp, because the beam's fire-rate field is not shots per second.
 */
export function shownDps(type: TowerType, level: number, mult = 1): number {
  const def = TOWERS[type];
  const lv = def.levels[level - 1];
  if (!lv || !def.attacks) return 0;
  if (def.beam) return lv.damage * mult * ((1 + (lv.rampMax ?? 1)) / 2);
  return lv.damage * lv.rate * mult;
}

/**
 * Direct-hit damage per second after armor. Splash, chains, and damage over
 * time are not included.
 */
export function armoredDps(type: TowerType, level: number, armor: number, mult = 1): number {
  const def = TOWERS[type];
  const lv = def.levels[level - 1];
  if (!lv || !def.attacks) return 0;
  return mitigatedDamage(lv.damage * mult, armor, ignoresArmor(type)) * lv.rate;
}

/** Waves until a mine's build or upgrade cost is repaid by the income it adds. */
export function minePaybackWaves(level: number): number {
  const levels = TOWERS.mine.levels;
  const lv = levels[level - 1];
  const income = lv?.income ?? 0;
  if (!lv || income <= 0) return Infinity;
  if (level <= 1) return lv.cost / income;
  const prev = levels[level - 2].income ?? 0;
  const gain = income - prev;
  return gain > 0 ? lv.cost / gain : Infinity;
}

/** Income returned per gold spent on a send. Higher is the better eco buy. */
export function packEcoRatio(id: PackId): number {
  const pack = SEND_PACKS[id];
  return pack.income / pack.cost;
}

/** Cheap packs are the income buy. Heavy packs are the threat buy. */
export function sendRole(id: PackId): 'eco' | 'mixed' | 'threat' {
  const ratio = packEcoRatio(id);
  if (ratio >= 0.11) return 'eco';
  if (ratio < 0.09) return 'threat';
  return 'mixed';
}

export interface UpgradeSpend {
  /** Extra panel DPS the next level adds. */
  extraDps: number;
  cost: number;
  /** Extra DPS per gold spent on the upgrade. */
  perGold: number;
  /** DPS per gold of a brand new level-1 copy. */
  freshPerGold: number;
  /** True when the upgrade beats building another copy, against one target. */
  beatsNewCopy: boolean;
}

/**
 * Compare the next upgrade with building another level-1 copy of the same
 * tower. Splash and armor are left out on purpose: the panel says so when
 * the single-target number loses.
 */
export function upgradeSpend(type: TowerType, level: number, mult = 1): UpgradeSpend | null {
  const def = TOWERS[type];
  if (!def.attacks || level >= def.levels.length) return null;
  const cost = def.levels[level].cost;
  const extraDps = shownDps(type, level + 1, mult) - shownDps(type, level, mult);
  const fresh = shownDps(type, 1, mult);
  const build = def.levels[0].cost;
  if (!(cost > 0) || !(build > 0)) return null;
  const perGold = extraDps / cost;
  const freshPerGold = fresh / build;
  return { extraDps, cost, perGold, freshPerGold, beatsNewCopy: perGold >= freshPerGold - 1e-9 };
}
