// Tiny global store for app-level (React) state. Match snapshots live in game/gameState.ts.
import { useSyncExternalStore } from 'react';
import type {
  ChatMsg,
  InviteInfo,
  MatchResults,
  MatchStartInfo,
  PublicRoomInfo,
  RoomState,
  SocialState,
  ToastMsg,
} from '../shared/protocol';
import type { PlayerStats, PublicUser } from '../shared/types';

export type View = 'boot' | 'auth' | 'menu' | 'lobby' | 'game' | 'results';

export interface Toast extends ToastMsg {
  id: number;
}

export interface ServerInfo {
  port: number;
  lan: string[];
  urls: string[];
}

export interface ConfirmState {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export interface AppState {
  view: View;
  token: string | null;
  user: PublicUser | null;
  stats: PlayerStats | null;
  connected: boolean;
  pendingJoin: string | null;
  joinError: string | null;
  room: RoomState | null;
  chat: ChatMsg[];
  publicRooms: PublicRoomInfo[];
  social: SocialState;
  invites: InviteInfo[];
  toasts: Toast[];
  match: MatchStartInfo | null;
  results: MatchResults | null;
  serverInfo: ServerInfo | null;
  friendsOpen: boolean;
  confirm: ConfirmState | null;
}

const initial: AppState = {
  view: 'boot',
  token: null,
  user: null,
  stats: null,
  connected: false,
  pendingJoin: null,
  joinError: null,
  room: null,
  chat: [],
  publicRooms: [],
  social: { friends: [], incoming: [], outgoing: [] },
  invites: [],
  toasts: [],
  match: null,
  results: null,
  serverInfo: null,
  friendsOpen: false,
  confirm: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    for (const l of listeners) l();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset(keep: Partial<AppState> = {}) {
    state = { ...initial, serverInfo: state.serverInfo, ...keep };
    for (const l of listeners) l();
  },
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}

let toastId = 0;
export function toast(kind: ToastMsg['kind'], text: string, ms = 4000): void {
  const id = ++toastId;
  store.set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
  window.setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function confirmDialog(c: ConfirmState): void {
  store.set({ confirm: c });
}
