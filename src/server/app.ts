// HTTP + Socket.IO server factory. index.ts runs it for real; the integration tests start
// it on a random port with a temp db.
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Server } from 'socket.io';
import { NET } from '../shared/config';
import { EV, normalizeRoomCode, type ClientToServerEvents, type ServerToClientEvents } from '../shared/protocol';
import { AuthService } from './auth';
import { JsonDb } from './db';
import { fail, TokenBucket, type IO, type Result, type SocketData } from './io';
import type { Match } from './match';
import { ProgressionService, type ProgressionOptions } from './progression/service';
import { RoomManager, type RoomManagerOptions } from './rooms';
import { Social } from './social';

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath: string;
  /** directory with the built client (index.html); null = API only (dev uses Vite) */
  staticDir?: string | null;
  rooms?: RoomManagerOptions;
  /** progression / ranked layer options (clock, dev tools, bot timeout...) */
  progression?: ProgressionOptions;
  /** extra setup */
  extend?: (ctx: ServerContext) => void;
}

export interface ServerContext {
  app: express.Express;
  io: IO;
  db: JsonDb;
  auth: AuthService;
  social: Social;
  rooms: RoomManager;
  /** registered socket handler extensions, run for every new connection */
  onConnection: ((sock: import('./io').Sock) => void)[];
  progression?: ProgressionService;
}

export interface RunningServer extends ServerContext {
  port: number;
  httpServer: http.Server;
  close(): Promise<void>;
}

const VIRTUAL_IF = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|hamachi|bluetooth|^br-|^veth/i;
// Hyper-V, VirtualBox, VMware, Docker MAC prefixes
const VIRTUAL_MAC = /^(00:15:5d|0a:00:27|08:00:27|00:05:69|00:0c:29|00:1c:14|00:50:56|02:42)/i;

/** Non-internal IPv4 addresses, best guess for "the real LAN" first (Wi-Fi/Ethernet, 192.168/10.x). */
export function lanAddresses(): string[] {
  const scored: { ip: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (VIRTUAL_IF.test(name) || VIRTUAL_MAC.test(a.mac)) score -= 100;
      if (/wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wl/i.test(name)) score += 20;
      if (a.address.startsWith('192.168.')) score += a.address.startsWith('192.168.56.') ? -20 : 10;
      else if (a.address.startsWith('10.')) score += 8;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 3;
      else if (a.address.startsWith('169.254.')) score -= 50;
      scored.push({ ip: a.address, score });
    }
  }
  return scored.sort((x, y) => y.score - x.score).map((s) => s.ip);
}

/** Vite dev server port. Phones use this when the game server is not serving the built client. */
export const DEV_CLIENT_PORT = 5180;

/**
 * URL a phone on the same Wi-Fi should open.
 * When this process serves the built client, that is `serverPort`.
 * In dev mode the phone opens the Vite server instead.
 */
export function phoneJoinUrl(lan: readonly string[], serverPort: number, clientServedHere: boolean): string | null {
  const ip = lan[0];
  if (!ip) return null;
  return `http://${ip}:${clientServedHere ? serverPort : DEV_CLIENT_PORT}`;
}

function bearer(req: express.Request): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// Backup copy of the session token in an HttpOnly cookie. iPhone Safari can wipe localStorage
// after ~7 days without a visit; /api/restore brings the player back from this cookie.
export const TOKEN_COOKIE = 'ctd_token';
const TOKEN_COOKIE_MAX_AGE_MS = 400 * 86400_000;

function tokenCookieOptions(req: express.Request): express.CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure };
}

function setTokenCookie(req: express.Request, res: express.Response, token: string): void {
  res.cookie(TOKEN_COOKIE, token, { ...tokenCookieOptions(req), maxAge: TOKEN_COOKIE_MAX_AGE_MS });
}

function clearTokenCookie(req: express.Request, res: express.Response): void {
  res.clearCookie(TOKEN_COOKIE, tokenCookieOptions(req));
}

/** Read one cookie from the raw Cookie header (no cookie-parser dependency). */
export function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const db = new JsonDb(opts.dbPath);
  const auth = new AuthService(db);
  const app = express();
  app.disable('x-powered-by');
  // Fly (and any other reverse proxy) terminates HTTPS and forwards the real client.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));
  const httpServer = http.createServer(app);
  const io: IO = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  const social = new Social(io, db);
  const rooms = new RoomManager(io, social, db, opts.rooms);
  social.rooms = rooms;
  const ctx: ServerContext = { app, io, db, auth, social, rooms, onConnection: [] };

  // ── REST: auth + info ────────────────────────────────────────────────────
  const authLimits = new Map<string, TokenBucket>();
  const limited = (req: express.Request) => {
    const ip = req.ip ?? 'unknown';
    let b = authLimits.get(ip);
    if (!b) authLimits.set(ip, (b = new TokenBucket(30, 1)));
    return !b.take();
  };

  app.post('/api/register', async (req, res) => {
    if (limited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts, slow down' });
    const r = await auth.register(req.body?.username, req.body?.password);
    if (r.ok) setTokenCookie(req, res, r.token);
    res.status(r.ok ? 200 : 400).json(r);
  });
  // passwordless "device account": pick a name, the browser remembers the player
  app.post('/api/start', (req, res) => {
    if (limited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts, slow down' });
    const r = auth.start(req.body?.name);
    if (r.ok) setTokenCookie(req, res, r.token);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.post('/api/login', async (req, res) => {
    if (limited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts, slow down' });
    const r = await auth.login(req.body?.username, req.body?.password);
    if (r.ok) setTokenCookie(req, res, r.token);
    res.status(r.ok ? 200 : 401).json(r);
  });
  app.post('/api/set-password', async (req, res) => {
    if (limited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts, slow down' });
    const token = bearer(req);
    const who = auth.resolve(token);
    if (!who) return res.status(401).json({ ok: false, error: 'Not logged in' });
    if (who.guest) return res.status(403).json({ ok: false, error: 'Guests cannot set a password' });
    const r = await auth.setPassword(token, req.body?.password);
    if (r.ok) setTokenCookie(req, res, r.token);
    res.status(r.ok ? 200 : 400).json(r);
  });
  // guests are never written to the cookie: they only live in server memory
  app.post('/api/guest', (req, res) => {
    if (limited(req)) return res.status(429).json({ ok: false, error: 'Too many attempts, slow down' });
    const r = auth.guest(req.body?.name);
    res.status(r.ok ? 200 : 400).json(r);
  });
  app.post('/api/logout', (req, res) => {
    const token = bearer(req);
    auth.logout(token);
    // Only drop the backup cookie when it belongs to the player logging out: another tab may be
    // a different player whose cookie must survive.
    const cookie = readCookie(req, TOKEN_COOKIE);
    if (cookie && (!token || cookie === token)) clearTokenCookie(req, res);
    res.json({ ok: true });
  });
  app.get('/api/me', (req, res) => {
    const token = bearer(req);
    const user = auth.resolve(token);
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in' });
    // keep the backup cookie fresh while the player is active (unless it holds another player)
    if (!user.guest && token) {
      const cookie = readCookie(req, TOKEN_COOKIE);
      if (!cookie || cookie === token) setTokenCookie(req, res, token);
    }
    res.json({ ok: true, user, stats: auth.stats(user.id) });
  });
  // bring a player back from the cookie when the browser lost its localStorage token
  app.get('/api/restore', (req, res) => {
    const token = readCookie(req, TOKEN_COOKIE);
    const user = token ? auth.resolve(token) : null;
    if (!token || !user || user.guest) {
      if (token) clearTokenCookie(req, res);
      return res.json({ ok: false });
    }
    setTokenCookie(req, res, token);
    res.json({ ok: true, token, user, stats: auth.stats(user.id) });
  });
  app.get('/api/server-info', (req, res) => {
    const port = (httpServer.address() as { port: number } | null)?.port ?? opts.port ?? 0;
    // when served through the Vite dev proxy the browser-facing port differs
    const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
    const m = /:(\d+)$/.exec(String(hostHeader));
    const publicPort = m ? Number(m[1]) : port;
    const lan = lanAddresses();
    res.json({
      ok: true,
      port: publicPort,
      serverPort: port,
      lan,
      urls: lan.map((ip) => `http://${ip}:${publicPort}`),
      devTools: !!opts.progression?.devTools,
    });
  });
  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    const room = code ? rooms.roomByCode(code) : null;
    if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });
    res.json({
      ok: true,
      code: room.code,
      mode: room.mode,
      mapId: room.mapId,
      difficulty: room.difficulty,
      players: room.members.length,
      state: room.state,
    });
  });

  // ── sockets ──────────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const user = auth.resolve(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    socket.data.token = token as string;
    next();
  });

  io.on('connection', (sock) => {
    const user = sock.data.user;
    social.connect(sock);
    sock.emit(EV.hello, { user, stats: auth.stats(user.id) });
    rooms.onSocket(sock);

    const reply = <T extends object>(ack: unknown, r: Result<T>) => {
      if (typeof ack === 'function') (ack as (x: Result<T>) => void)(r);
      else if (!r.ok) sock.emit(EV.toast, { kind: 'error', text: r.error });
    };
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch (err) {
          console.error('[socket handler]', err);
          const ack = args[args.length - 1];
          reply(ack, fail('Server error'));
        }
      };

    sock.on(EV.roomCreate, guard((p, ack) => reply(ack, rooms.create(user, p ?? {}))));
    sock.on(EV.roomJoin, guard((p, ack) => reply(ack, rooms.join(user, p?.code))));
    sock.on(EV.roomLeave, guard((ack) => reply(ack, rooms.leave(user.id))));
    sock.on(EV.roomSettings, guard((p, ack) => reply(ack, rooms.settings(user, p))));
    sock.on(EV.roomReady, guard((p, ack) => reply(ack, rooms.setReady(user.id, p?.ready))));
    sock.on(EV.roomTeam, guard((p, ack) => reply(ack, rooms.setTeam(user.id, p?.team))));
    sock.on(EV.roomKick, guard((p, ack) => reply(ack, rooms.kick(user.id, p?.playerId))));
    sock.on(EV.roomChat, guard((p, ack) => reply(ack, rooms.chat(user, p?.text))));
    sock.on(EV.chat, guard((p, ack) => reply(ack, rooms.chat(user, p?.text))));
    sock.on(EV.roomStart, guard((ack) => reply(ack, rooms.start(user.id))));
    sock.on(EV.browseSubscribe, () => {
      sock.join('browse');
      sock.emit(EV.browseList, rooms.publicList());
    });
    sock.on(EV.browseUnsubscribe, () => {
      sock.leave('browse');
    });

    sock.on(EV.friendRequest, guard((p, ack) => reply(ack, social.request(user, p?.username))));
    sock.on(EV.friendRespond, guard((p, ack) => reply(ack, social.respond(user, p?.userId, p?.accept))));
    sock.on(EV.friendCancel, guard((p, ack) => reply(ack, social.cancel(user, p?.userId))));
    sock.on(EV.friendRemove, guard((p, ack) => reply(ack, social.remove(user, p?.userId))));
    sock.on(EV.inviteSend, guard((p, ack) => reply(ack, social.sendInvite(user, p?.userId))));
    sock.on(
      EV.inviteRespond,
      guard((p, ack) => {
        const r = social.takeInvite(user, p?.inviteId, p?.accept);
        if (!r.ok || !r.roomCode) return reply(ack, r.ok ? { ok: true } : r);
        reply(ack, rooms.join(user, r.roomCode));
      }),
    );

    // game intents (rate limited)
    const bucket = new TokenBucket(NET.intentBurst, NET.intentPerSecond);
    const intent =
      <P>(fn: (m: Match, p: P) => Result) =>
      (p: P, ack?: unknown) => {
        if (!bucket.take()) return reply(ack, fail('Slow down!'));
        const match = rooms.roomOf(user.id)?.match;
        if (!match || match.over) return reply(ack, fail('No game in progress'));
        reply(ack, fn(match, (p ?? {}) as P));
      };
    sock.on(EV.placeTower, guard(intent((m, p) => m.placeTower(user.id, p))));
    sock.on(EV.moveTower, guard(intent((m, p) => m.moveTower(user.id, p))));
    sock.on(EV.upgradeTower, guard(intent((m, p) => m.upgradeTower(user.id, p))));
    sock.on(EV.sellTower, guard(intent((m, p) => m.sellTower(user.id, p))));
    sock.on(EV.repairTower, guard(intent((m, p) => m.repairTower(user.id, p))));
    sock.on(EV.setTargeting, guard(intent((m, p) => m.setTargeting(user.id, p))));
    sock.on(EV.sendTroops, guard(intent((m, p) => m.sendTroops(user.id, p))));
    sock.on(EV.ready, guard(intent((m, p) => m.ready(user.id, p))));
    sock.on(EV.speedVote, guard(intent((m, p) => m.speedVote(user.id, p))));
    sock.on(EV.resync, () => {
      const match = rooms.roomOf(user.id)?.match;
      if (match && !match.over) match.sendFull(sock);
    });

    for (const ext of ctx.onConnection) ext(sock);

    sock.on('disconnect', () => {
      if (social.disconnect(sock)) {
        rooms.onUserOffline(user.id);
        ctx.progression?.onUserOffline(user.id);
      }
    });
  });

  ctx.progression = new ProgressionService(ctx, opts.progression);
  opts.extend?.(ctx);

  // ── static client (production build) with SPA fallback (/join/CODE etc.) ──
  const staticDir = opts.staticDir ?? null;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      // `root` keeps send's dotfile check relative (the checkout may live under e.g. .claude/)
      res.sendFile('index.html', { root: staticDir });
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('html')
        .send(
          '<!doctype html><title>CTD server</title><body style="font-family:sans-serif;background:#111;color:#eee;padding:2em">' +
            '<h2>Game server is running.</h2><p>No client build found. Run <code>npm run play</code> (build + start) or use <code>npm run dev</code> and open the Vite URL (port 5180).</p></body>',
        );
    });
  }
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port ?? 0, opts.host ?? '0.0.0.0', () => resolve());
  });
  const port = (httpServer.address() as { port: number }).port;

  let closed = false;
  return {
    ...ctx,
    port,
    httpServer,
    async close() {
      if (closed) return;
      closed = true;
      ctx.progression?.dispose();
      rooms.dispose();
      social.dispose();
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => {
        if (!httpServer.listening) return resolve();
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
      db.flush();
    },
  };
}
