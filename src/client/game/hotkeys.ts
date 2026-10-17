// Pure key helpers for the match screen. Kept free of the DOM so tests can cover them.
import { TARGET_MODES, type TargetMode } from '../../shared/types';

/** Targeting mode after `current`, wrapping First → Last → Strongest → Closest. */
export function nextTargetMode(current: TargetMode): TargetMode {
  const i = TARGET_MODES.indexOf(current);
  return TARGET_MODES[i < 0 ? 0 : (i + 1) % TARGET_MODES.length];
}

/** Next id after `current`, wrapping. A missing or null current returns the first id. */
export function nextId(ids: readonly string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  const i = current == null ? -1 : ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}
