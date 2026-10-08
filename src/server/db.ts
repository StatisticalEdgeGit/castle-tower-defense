// Tiny JSON-file store with atomic writes (write temp file, then rename).
// Everything is kept in memory; writes are debounced and flushed on shutdown.
import fs from 'node:fs';
import path from 'node:path';
import type { PlayerStats } from '../shared/types';

export interface UserRecord {
  id: string;
  username: string;
  usernameLower: string;
  salt: string;
  hash: string;
  createdAt: number;
  stats: PlayerStats;
  /** progression / meta-game state (filled in by the progression layer) */
  progression: Record<string, unknown>;
}

export interface SessionRecord {
  userId: string;
  expiresAt: number;
}

export interface FriendRequestRecord {
  from: string;
  to: string;
  at: number;
}

export interface DbData {
  version: 1;
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  /** sorted pairs [a, b] with a < b */
  friendships: [string, string][];
  requests: FriendRequestRecord[];
  /** server-wide meta state (seasons, archived leaderboards, ...) */
  meta: Record<string, unknown>;
}

function emptyDb(): DbData {
  return { version: 1, users: {}, sessions: {}, friendships: [], requests: [], meta: {} };
}

export function emptyStats(): PlayerStats {
  return { gamesPlayed: 0, wins: 0, bestCoop: {} };
}

export class JsonDb {
  data: DbData;
  private timer: NodeJS.Timeout | null = null;
  private writeSeq = 0;

  constructor(readonly file: string) {
    this.data = this.load();
  }

  private load(): DbData {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DbData>;
      const d = { ...emptyDb(), ...parsed } as DbData;
      for (const u of Object.values(d.users)) {
        u.stats = { ...emptyStats(), ...(u.stats ?? {}) };
        u.progression = u.progression ?? {};
      }
      return d;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        // keep a copy of an unreadable file instead of silently overwriting it
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {
          /* ignore */
        }
        console.warn(`[db] could not read ${this.file}: ${e.message}; starting empty`);
      }
      return emptyDb();
    }
  }

  /** Schedule a debounced write. */
  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow();
    }, 100);
  }

  /** Write immediately (used on shutdown and in tests). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writeNow();
  }

  private writeNow(): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${++this.writeSeq}.tmp`;
    const json = JSON.stringify(this.data);
    fs.writeFileSync(tmp, json, 'utf8');
    // On Windows a rename can transiently fail with EPERM/EBUSY (AV scanners, indexers).
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt < 8 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
          const until = Date.now() + 15 * (attempt + 1);
          while (Date.now() < until) {
            /* brief spin; writes are rare */
          }
          continue;
        }
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw err;
      }
    }
  }

  // ── users ────────────────────────────────────────────────────────────────
  userById(id: string): UserRecord | undefined {
    return this.data.users[id];
  }

  userByName(username: string): UserRecord | undefined {
    const lower = username.toLowerCase();
    return Object.values(this.data.users).find((u) => u.usernameLower === lower);
  }

  // ── friends ──────────────────────────────────────────────────────────────
  areFriends(a: string, b: string): boolean {
    const [x, y] = a < b ? [a, b] : [b, a];
    return this.data.friendships.some(([p, q]) => p === x && q === y);
  }

  addFriendship(a: string, b: string): void {
    if (this.areFriends(a, b)) return;
    this.data.friendships.push(a < b ? [a, b] : [b, a]);
    this.save();
  }

  removeFriendship(a: string, b: string): boolean {
    const [x, y] = a < b ? [a, b] : [b, a];
    const before = this.data.friendships.length;
    this.data.friendships = this.data.friendships.filter(([p, q]) => !(p === x && q === y));
    if (this.data.friendships.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  friendsOf(id: string): string[] {
    const out: string[] = [];
    for (const [a, b] of this.data.friendships) {
      if (a === id) out.push(b);
      else if (b === id) out.push(a);
    }
    return out;
  }
}
