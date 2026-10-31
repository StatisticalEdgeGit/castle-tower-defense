// Accounts (scrypt + per-user salt), session tokens and ephemeral guests.
// "Device accounts" are real saved users without a password: the player picks a name and the
// browser keeps the session token. Their sessions never expire until a password is set.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { NET } from '../shared/config';
import type { PlayerStats, PublicUser } from '../shared/types';
import { emptyStats, type JsonDb, type SessionRecord, type UserRecord } from './db';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, keylen: number) => Promise<Buffer>;

export interface Identity extends PublicUser {}

export type AuthResult = { ok: true; token: string; user: Identity; stats: PlayerStats | null } | { ok: false; error: string };

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 4;

const DAY_MS = 86400_000;

function usernameError(username: unknown): string | null {
  return typeof username === 'string' && USERNAME_RE.test(username) ? null : 'Username must be 3–16 letters, digits or _';
}

function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (password.length > 200) return 'Password too long';
  return null;
}

/** The account's stored password, or null for a passwordless device account. */
function passwordOf(u: UserRecord | undefined): { salt: string; hash: string } | null {
  return u?.salt && u.hash ? { salt: u.salt, hash: u.hash } : null;
}

export function hasPassword(u: UserRecord): boolean {
  return passwordOf(u) !== null;
}

export function sanitizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 16) return null;
  return name;
}

export class AuthService {
  private guests = new Map<string, Identity>(); // token → guest
  private guestCounter = 0;

  constructor(private readonly db: JsonDb) {}

  private newToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private async hash(password: string, salt: string): Promise<Buffer> {
    return scrypt(password, salt, 64);
  }

  private sessionExpiry(now = Date.now()): number {
    return now + NET.sessionDays * DAY_MS;
  }

  private issueSession(user: UserRecord): string {
    const token = this.newToken();
    this.db.data.sessions[token] = { userId: user.id, expiresAt: this.sessionExpiry() };
    this.pruneSessions();
    this.db.save();
    return token;
  }

  /** True when the session is past its expiry. Sessions of passwordless accounts never expire. */
  private sessionExpired(s: SessionRecord, user: UserRecord | undefined, now: number): boolean {
    if (s.expiresAt >= now) return false;
    return !user || hasPassword(user);
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [t, s] of Object.entries(this.db.data.sessions)) {
      if (this.sessionExpired(s, this.db.userById(s.userId), now)) delete this.db.data.sessions[t];
    }
  }

  private createUser(username: string, password: { salt: string; hash: string } | null): UserRecord {
    const user: UserRecord = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username,
      usernameLower: username.toLowerCase(),
      ...(password ?? {}),
      createdAt: Date.now(),
      stats: emptyStats(),
      progression: {},
    };
    this.db.data.users[user.id] = user;
    return user;
  }

  private authOk(token: string, user: UserRecord): AuthResult {
    return { ok: true, token, user: this.toIdentity(user), stats: user.stats };
  }

  toIdentity(u: UserRecord): Identity {
    return { id: u.id, name: u.username, guest: false, secured: hasPassword(u) };
  }

  async register(username: unknown, password: unknown): Promise<AuthResult> {
    const nameErr = usernameError(username);
    if (nameErr) return { ok: false, error: nameErr };
    const pwErr = passwordError(password);
    if (pwErr) return { ok: false, error: pwErr };
    const name = username as string;
    if (this.db.userByName(name)) return { ok: false, error: 'That username is taken' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await this.hash(password as string, salt)).toString('hex');
    // re-check after the async hash (two simultaneous registrations)
    if (this.db.userByName(name)) return { ok: false, error: 'That username is taken' };
    const user = this.createUser(name, { salt, hash });
    return this.authOk(this.issueSession(user), user);
  }

  /** Create a passwordless device account: just a unique player name. */
  start(username: unknown): AuthResult {
    const nameErr = usernameError(username);
    if (nameErr) return { ok: false, error: nameErr };
    const name = username as string;
    if (this.db.userByName(name)) return { ok: false, error: 'That username is taken' };
    const user = this.createUser(name, null);
    return this.authOk(this.issueSession(user), user);
  }

  async login(username: unknown, password: unknown): Promise<AuthResult> {
    if (typeof username !== 'string' || typeof password !== 'string') return { ok: false, error: 'Missing username or password' };
    const user = this.db.userByName(username);
    // Hash anyway so timing does not reveal whether the user exists or has a password.
    const stored = passwordOf(user);
    const hash = await this.hash(password, stored?.salt ?? 'no-such-user-salt');
    const expected = stored ? Buffer.from(stored.hash, 'hex') : Buffer.alloc(hash.length);
    const match = expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
    if (!user || !stored || !match) return { ok: false, error: 'Wrong username or password' };
    return this.authOk(this.issueSession(user), user);
  }

  /**
   * Add a password to the (passwordless) account behind `token`. The user id, stats and
   * progression stay the same. Changing an existing password is not allowed here (a stolen
   * token must not be able to lock the owner out).
   */
  async setPassword(token: unknown, password: unknown): Promise<AuthResult> {
    const ident = this.resolve(token);
    if (!ident) return { ok: false, error: 'Not logged in' };
    if (ident.guest) return { ok: false, error: 'Guests cannot set a password' };
    const pwErr = passwordError(password);
    if (pwErr) return { ok: false, error: pwErr };
    const user = this.db.userById(ident.id);
    if (!user) return { ok: false, error: 'Not logged in' };
    const already = { ok: false, error: 'This player already has a password' } as const;
    if (hasPassword(user)) return already;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await this.hash(password as string, salt)).toString('hex');
    // re-check after the async hash (two simultaneous requests)
    if (hasPassword(user)) return already;
    user.salt = salt;
    user.hash = hash;
    // From now on the account's sessions expire normally: restart their clock so none of them
    // (whose stored expiry was ignored until now) is dropped on the spot.
    const expiresAt = this.sessionExpiry();
    for (const s of Object.values(this.db.data.sessions)) if (s.userId === user.id) s.expiresAt = expiresAt;
    this.db.save();
    return this.authOk(token as string, user);
  }

  guest(name: unknown): AuthResult {
    const clean = sanitizeDisplayName(name);
    if (!clean) return { ok: false, error: 'Display name must be 2–16 characters' };
    const token = 'g.' + this.newToken();
    const ident: Identity = { id: `g_${++this.guestCounter}_${crypto.randomBytes(3).toString('hex')}`, name: clean, guest: true };
    this.guests.set(token, ident);
    return { ok: true, token, user: ident, stats: null };
  }

  logout(token: unknown): void {
    if (typeof token !== 'string') return;
    if (this.guests.delete(token)) return;
    if (this.db.data.sessions[token]) {
      delete this.db.data.sessions[token];
      this.db.save();
    }
  }

  resolve(token: unknown): Identity | null {
    if (typeof token !== 'string' || !token) return null;
    const g = this.guests.get(token);
    if (g) return g;
    const s = this.db.data.sessions[token];
    if (!s) return null;
    const u = this.db.userById(s.userId);
    const now = Date.now();
    if (this.sessionExpired(s, u, now)) {
      delete this.db.data.sessions[token];
      this.db.save();
      return null;
    }
    if (!u) return null;
    // Sliding expiry for password accounts: an active player is never logged out. At most one
    // write per token per day.
    if (hasPassword(u)) {
      const full = this.sessionExpiry(now);
      if (s.expiresAt < full - DAY_MS) {
        s.expiresAt = full;
        this.db.save();
      }
    }
    return this.toIdentity(u);
  }

  stats(userId: string): PlayerStats | null {
    return this.db.userById(userId)?.stats ?? null;
  }
}
