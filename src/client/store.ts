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
import type { ChestTier } from '../shared/progression';
import type { DropOpenResult, Granted, LevelUp, MatchRewards, MmStatus, PartyInvite, PartyView, ProfileView, VsInfo } from '../shared/progProtocol';

export type View = 'boot' | 'auth' | 'menu' | 'lobby' | 'game' | 'results';

export interface Toast extends ToastMsg {
  id: number;
}

export interface ServerInfo {
  port: number;
  lan: string[];
  urls: string[];
  devTools: boolean;
}

export type HubTab = 'shop' | 'collection' | 'battle' | 'social' | 'progress';

export type Reveal =
  | { kind: 'drop'; dropId: string; result: DropOpenResult | null }
  | { kind: 'chest'; chestId: string; tier: ChestTier; granted: Granted[] | null }
  | { kind: 'granted'; title: string; granted: Granted[] };

export type Celebration = { kind: 'levelup'; levelUps: LevelUp[] } | { kind: 'arena'; arena: number };

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
  profile: ProfileView | null;
  tab: HubTab;
  mm: MmStatus;
  vs: VsInfo | null;
  party: PartyView | null;
  partyInvites: PartyInvite[];
  rewards: MatchRewards | null;
  reveal: Reveal | null;
  celebrations: Celebration[];
  devOpen: boolean;
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
  profile: null,
  tab: 'battle',
  mm: { state: 'idle', mode: null, since: 0, party: [] },
  vs: null,
  party: null,
  partyInvites: [],
  rewards: null,
  reveal: null,
  celebrations: [],
  devOpen: false,
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
