// Helpers for integration tests: a real server on a random port + recording socket clients.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc, type Socket } from 'socket.io-client';
import { startServer, type RunningServer, type ServerOptions } from '../src/server/app';

export interface TestServer {
  srv: RunningServer;
  base: string;
  dbPath: string;
  stop(): Promise<void>;
}

export async function startTestServer(opts: Partial<ServerOptions> = {}): Promise<TestServer> {
  const dbPath = path.join(os.tmpdir(), `ctd-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const srv = await startServer({ port: 0, host: '127.0.0.1', dbPath, staticDir: null, ...opts });
  const base = `http://127.0.0.1:${srv.port}`;
  return {
    srv,
    base,
    dbPath,
    async stop() {
      await srv.close();
      for (const f of [dbPath]) fs.rmSync(f, { force: true });
    },
  };
}

export async function post<T = any>(base: string, p: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function get<T = any>(base: string, p: string, token?: string): Promise<T> {
  const res = await fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return (await res.json()) as T;
}

/** Socket client that records every event so tests can wait for past or future events. */
export class Client {
  readonly events: { ev: string; data: any; i: number }[] = [];
  private waiters: { ev: string; pred: (d: any) => boolean; from: number; resolve: (d: any) => void }[] = [];
  private counter = 0;
  constructor(readonly sock: Socket) {
    sock.onAny((ev: string, data: any) => {
      const rec = { ev, data, i: this.counter++ };
      this.events.push(rec);
      if (this.events.length > 5000) this.events.splice(0, 1000);
      for (const w of [...this.waiters]) {
        if (w.ev === ev && rec.i >= w.from && w.pred(data)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(data);
        }
      }
    });
  }

  /** Index to pass as `from` so only events after now count. */
  mark(): number {
    return this.counter;
  }

  waitFor<T = any>(ev: string, pred: (d: T) => boolean = () => true, from = 0, timeoutMs = 8000): Promise<T> {
    const hit = this.events.find((e) => e.ev === ev && e.i >= from && pred(e.data));
    if (hit) return Promise.resolve(hit.data);
    return new Promise((resolve, reject) => {
      const w = { ev, pred: pred as (d: any) => boolean, from, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`timeout waiting for ${ev}`));
        }
      }, timeoutMs);
    });
  }

  last<T = any>(ev: string): T | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].ev === ev) return this.events[i].data;
    return undefined;
  }

  req<T = any>(ev: string, payload?: unknown): Promise<T> {
    const s = this.sock.timeout(5000) as any;
    return payload === undefined ? s.emitWithAck(ev) : s.emitWithAck(ev, payload);
  }

  close(): void {
    this.sock.disconnect();
  }
}

export function connect(base: string, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const sock = ioc(base, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const client = new Client(sock);
    sock.once('connect', () => resolve(client));
    sock.once('connect_error', (e) => reject(e));
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
