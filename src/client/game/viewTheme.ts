// This screen's art theme. Stored per account in localStorage, so another
// player — even on the same PC, in another tab — keeps their own look.
import { useSyncExternalStore } from 'react';

export const VIEW_THEMES = ['classic', 'robots', 'mushrooms'] as const;
export type ViewTheme = (typeof VIEW_THEMES)[number];
export type SkinnedTheme = Exclude<ViewTheme, 'classic'>;

/** Read a stored theme string. Anything unexpected is the classic look. */
export function parseViewTheme(raw: string | null): ViewTheme {
  return raw === 'robots' || raw === 'mushrooms' ? raw : 'classic';
}

/** localStorage key for one player's view. Guests and accounts each get their own. */
export function themeStorageKey(userId: string | null): string {
  return userId ? `ctd.viewTheme.${userId}` : 'ctd.viewTheme.device';
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'>, userId: string | null): ViewTheme {
  return parseViewTheme(storage.getItem(themeStorageKey(userId)));
}

export function writeStoredTheme(storage: Pick<Storage, 'setItem'>, userId: string | null, theme: ViewTheme): void {
  storage.setItem(themeStorageKey(userId), theme);
}

const fallback = new Map<string, string>();
const memoryStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (k) => fallback.get(k) ?? null,
  setItem: (k, v) => {
    fallback.set(k, v);
  },
};

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return memoryStorage;
}

let theme: ViewTheme = 'classic';
let userId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** The look currently drawn on this screen. */
export function getViewTheme(): ViewTheme {
  return theme;
}

/** Load the theme saved for this player. Call when the tab's account changes. */
export function bindViewTheme(id: string | null): void {
  userId = id;
  const next = readStoredTheme(browserStorage(), id);
  if (next === theme) return;
  theme = next;
  emit();
}

/** Change the look on this screen and remember it for this player only. */
export function setViewTheme(next: ViewTheme): void {
  if (next === theme) return;
  theme = next;
  writeStoredTheme(browserStorage(), userId, next);
  emit();
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function subscribeViewTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook for the theme on this screen. */
export function useViewTheme(): ViewTheme {
  return useSyncExternalStore(subscribeViewTheme, getViewTheme, getViewTheme);
}
