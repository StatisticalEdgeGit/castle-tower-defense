// Accounts (scrypt + per-user salt), session tokens and ephemeral guests.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { NET } from '../shared/config';
import type { PlayerStats, PublicUser } from '../shared/types';
import { emptyStats, type JsonDb, type UserRecord } from './db';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, keylen: number) => Promise<Buffer>;

export interface Identity extends PublicUser {}

export type AuthResult = { ok: true; token: string; user: Identity; stats: PlayerStats | null } | { ok: false; error: string };

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 4;

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

  private issueSession(user: UserRecord): string {
    const token = this.newToken();
    this.db.data.sessions[token] = { userId: user.id, expiresAt: Date.now() + NET.sessionDays * 86400_000 };
    this.pruneSessions();
    this.db.save();
    return token;
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [t, s] of Object.entries(this.db.data.sessions)) if (s.expiresAt < now) delete this.db.data.sessions[t];
  }

  toIdentity(u: UserRecord): Identity {
    return { id: u.id, name: u.username, guest: false };
  }

  async register(username: unknown, password: unknown): Promise<AuthResult> {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return { ok: false, error: 'Username must be 3–16 letters, digits or _' };
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters` };
    }
    if (password.length > 200) return { ok: false, error: 'Password too long' };
    if (this.db.userByName(username)) return { ok: false, error: 'That username is taken' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await this.hash(password, salt)).toString('hex');
    // re-check after the async hash (two simultaneous registrations)
    if (this.db.userByName(username)) return { ok: false, error: 'That username is taken' };
    const user: UserRecord = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username,
      usernameLower: username.toLowerCase(),
      salt,
      hash,
      createdAt: Date.now(),
      stats: emptyStats(),
      progression: {},
    };
    this.db.data.users[user.id] = user;
    const token = this.issueSession(user);
    return { ok: true, token, user: this.toIdentity(user), stats: user.stats };
  }

  async login(username: unknown, password: unknown): Promise<AuthResult> {
    if (typeof username !== 'string' || typeof password !== 'string') return { ok: false, error: 'Missing username or password' };
    const user = this.db.userByName(username);
    // hash anyway so timing does not reveal whether the user exists
    const salt = user?.salt ?? 'no-such-user-salt';
    const hash = await this.hash(password, salt);
    const expected = user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(hash.length);
    const match = expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
    if (!user || !match) return { ok: false, error: 'Wrong username or password' };
    const token = this.issueSession(user);
    return { ok: true, token, user: this.toIdentity(user), stats: user.stats };
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
    if (s.expiresAt < Date.now()) {
      delete this.db.data.sessions[token];
      this.db.save();
      return null;
    }
    const u = this.db.userById(s.userId);
    return u ? this.toIdentity(u) : null;
  }

  stats(userId: string): PlayerStats | null {
    return this.db.userById(userId)?.stats ?? null;
  }
}
