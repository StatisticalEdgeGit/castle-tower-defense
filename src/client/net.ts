// Networking: REST auth calls, token storage, and the Socket.IO connection that feeds
// the store and the game client.
import { io, type Socket } from 'socket.io-client';
import { EV, normalizeRoomCode, type Ack, type ClientToServerEvents, type ServerToClientEvents } from '../shared/protocol';
import type { PlayerStats, PublicUser } from '../shared/types';
import { game } from './game/gameState';
import { store, toast } from './store';

// ── token storage ──────────────────────────────────────────────────────────
// sessionStorage = this tab's identity (so several tabs can be different players);
// localStorage = "last login" so a brand-new tab logs in automatically.
const TOKEN_KEY = 'ctd.token';
const LAST_KEY = 'ctd.lastLogin';
const NO_AUTO_KEY = 'ctd.noAuto';

function ssGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function ssSet(k: string, v: string | null): void {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export const session = {
  /** Token for this tab: its own, else (unless the tab opted out) the last login. */
  load(): { token: string; fromLast: boolean } | null {
    const own = ssGet(TOKEN_KEY);
    if (own) return { token: own, fromLast: false };
    if (ssGet(NO_AUTO_KEY)) return null;
    const last = lsGet(LAST_KEY);
    if (last) {
      ssSet(TOKEN_KEY, last);
      return { token: last, fromLast: true };
    }
    return null;
  },
  save(token: string): void {
    ssSet(TOKEN_KEY, token);
    ssSet(NO_AUTO_KEY, null);
    lsSet(LAST_KEY, token);
  },
  /** Forget this tab's identity only (other tabs keep theirs). */
  clearTab(): void {
    ssSet(TOKEN_KEY, null);
    ssSet(NO_AUTO_KEY, '1');
  },
  /** Logout: clear this tab, and "last login" only if it is the same token. */
  clearAll(token: string | null): void {
    ssSet(TOKEN_KEY, null);
    if (token && lsGet(LAST_KEY) === token) lsSet(LAST_KEY, null);
  },
};

// ── REST ──────────────────────────────────────────────────────────────────
type AuthResponse = { ok: true; token: string; user: PublicUser; stats: PlayerStats | null } | { ok: false; error: string };

async function call<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  try {
    const res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return json as T;
  } catch {
    return { ok: false, error: 'Cannot reach the server' } as T;
  }
}

export const api = {
  register: (username: string, password: string) => call<AuthResponse>('POST', '/api/register', { username, password }),
  login: (username: string, password: string) => call<AuthResponse>('POST', '/api/login', { username, password }),
  guest: (name: string) => call<AuthResponse>('POST', '/api/guest', { name }),
  logout: (token: string) => call<{ ok: boolean }>('POST', '/api/logout', {}, token),
  me: (token: string) => call<{ ok: true; user: PublicUser; stats: PlayerStats | null } | { ok: false; error: string }>('GET', '/api/me', undefined, token),
  serverInfo: () => call<{ ok: boolean; port: number; lan: string[]; urls: string[] }>('GET', '/api/server-info'),
};

// ── socket ────────────────────────────────────────────────────────────────
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: GameSocket | null = null;

export function getSocket(): GameSocket | null {
  return socket;
}

/** Emit with an ack; resolves to an Ack (timeouts become errors). */
export function request<T extends object = object>(ev: keyof ClientToServerEvents, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) return resolve({ ok: false, error: 'Not connected to the server' });
    const cb = (err: Error | null, res: Ack<T>) => {
      if (err) resolve({ ok: false, error: 'Server did not respond' });
      else resolve(res ?? ({ ok: true } as Ack<T>));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = socket.timeout(8000) as any;
    if (payload === undefined) s.emit(ev, cb);
    else s.emit(ev, payload, cb);
  });
}

/** Emit and show an error toast on failure. */
export async function act<T extends object = object>(ev: keyof ClientToServerEvents, payload?: unknown): Promise<Ack<T>> {
  const r = await request<T>(ev, payload);
  if (!r.ok) toast('error', r.error);
  return r;
}

function wire(s: GameSocket): void {
  s.on('connect', () => {
    store.set({ connected: true });
    const code = store.get().pendingJoin;
    if (code) void joinRoom(code, true);
  });
  s.on('disconnect', () => store.set({ connected: false }));
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      const t = store.get().token;
      session.clearAll(t);
      disconnectSocket();
      store.reset({ view: 'auth', pendingJoin: store.get().pendingJoin });
      toast('warn', 'Your session expired — please log in again');
    }
  });
  s.on(EV.hello, ({ user, stats }) => store.set({ user, stats }));
  s.on(EV.toast, (t) => toast(t.kind, t.text));
  s.on(EV.roomState, (room) => {
    const st = store.get();
    let view = st.view;
    if (view === 'menu' || view === 'boot') view = room.state === 'playing' ? view : 'lobby';
    if (view === 'game' && room.state === 'waiting' && !st.results) view = 'lobby';
    store.set({ room, chat: room.chat, view });
  });
  s.on(EV.roomClosed, ({ reason }) => {
    game.clear();
    store.set({ room: null, match: null, chat: [], view: store.get().view === 'auth' ? 'auth' : 'menu' });
    toast('warn', reason);
  });
  s.on(EV.browseList, (rooms) => store.set({ publicRooms: rooms }));
  s.on(EV.socialState, (social) => store.set({ social }));
  s.on(EV.presence, ({ userId, status }) =>
    store.set((st) => ({ social: { ...st.social, friends: st.social.friends.map((f) => (f.id === userId ? { ...f, status } : f)) } })),
  );
  s.on(EV.inviteIncoming, (inv) => store.set((st) => ({ invites: [...st.invites.filter((i) => i.id !== inv.id), inv] })));
  s.on(EV.inviteGone, ({ id }) => store.set((st) => ({ invites: st.invites.filter((i) => i.id !== id) })));
  s.on(EV.matchStart, (info) => {
    const me = store.get().user;
    game.reset(info, me?.id ?? '');
    store.set({ match: info, view: 'game', results: null });
  });
  s.on(EV.matchSnap, (snap) => game.onSnapshot(snap));
  s.on(EV.matchOver, (results) => {
    store.set({ results, view: 'results' });
  });
  s.on(EV.chatMsg, (m) => store.set((st) => ({ chat: [...st.chat.slice(-99), m] })));
}

export function connectSocket(token: string): void {
  disconnectSocket();
  socket = io({ auth: { token }, reconnectionDelayMax: 3000 });
  wire(socket);
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  store.set({ connected: false });
}

// ── session actions ───────────────────────────────────────────────────────
export function parseJoinPath(): string | null {
  const m = /^\/join\/([A-Za-z0-9]+)\/?$/.exec(window.location.pathname);
  if (!m) return null;
  window.history.replaceState(null, '', '/');
  return normalizeRoomCode(m[1]) ?? m[1].toUpperCase();
}

export async function boot(): Promise<void> {
  const pendingJoin = parseJoinPath();
  store.set({ pendingJoin });
  void api.serverInfo().then((r) => {
    if (r.ok) store.set({ serverInfo: { port: r.port, lan: r.lan, urls: r.urls } });
  });
  const saved = session.load();
  if (saved) {
    const r = await api.me(saved.token);
    if (r.ok) return onLoggedIn(saved.token, r.user, r.stats, false);
    session.clearAll(saved.token);
  }
  store.set({ view: 'auth' });
}

export function onLoggedIn(token: string, user: PublicUser, stats: PlayerStats | null, persist = true): void {
  if (persist) session.save(token);
  store.set({ token, user, stats, view: 'menu' });
  connectSocket(token);
}

export async function logout(): Promise<void> {
  const token = store.get().token;
  if (token) await api.logout(token);
  session.clearAll(token);
  disconnectSocket();
  game.clear();
  store.reset({ view: 'auth' });
}

/** Leave this tab's identity without invalidating it for other tabs. */
export function switchAccount(): void {
  session.clearTab();
  disconnectSocket();
  game.clear();
  store.reset({ view: 'auth' });
}

// ── room actions ─────────────────────────────────────────────────────────
export async function joinRoom(rawCode: string, fromLink = false): Promise<boolean> {
  const code = normalizeRoomCode(rawCode);
  store.set({ pendingJoin: null });
  if (!code) {
    const msg = 'That invite code is not valid';
    if (fromLink) store.set({ joinError: msg });
    else toast('error', msg);
    return false;
  }
  const r = await request(EV.roomJoin, { code });
  if (!r.ok) {
    if (fromLink) store.set({ joinError: r.error });
    else toast('error', r.error);
    return false;
  }
  return true;
}

export async function leaveRoom(): Promise<void> {
  await request(EV.roomLeave);
  game.clear();
  store.set({ room: null, match: null, results: null, chat: [], view: 'menu' });
}

export function inviteLink(code: string, origin = window.location.origin): string {
  return `${origin}/join/${code}`;
}

export function isLocalhost(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/** LAN origin for links (http://<lan-ip>:<port>) when the page itself is on localhost. */
export function lanOrigin(ip?: string): string | null {
  const info = store.get().serverInfo;
  if (!info || !info.lan.length) return null;
  const port = window.location.port || info.port;
  return `${window.location.protocol}//${ip ?? info.lan[0]}${port ? `:${port}` : ''}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context; LAN http pages fall back to execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
