import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';
import type { Identity } from './auth';

export interface SocketData {
  user: Identity;
  token: string;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const userChannel = (id: string) => `user:${id}`;
export const roomChannel = (id: string) => `room:${id}`;
export const BROWSE_CHANNEL = 'browse';

export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Simple token bucket for per-socket rate limiting. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {
    this.tokens = burst;
  }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
