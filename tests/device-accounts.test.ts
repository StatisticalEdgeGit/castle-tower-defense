// Device accounts: saved players without a password (pick a name, the browser remembers you),
// sliding session expiry, adding a password later, and the HttpOnly cookie backup.
// Real server on a random port with a temp db, like integration.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NET } from '../src/shared/config';
import { EV, type SocialState } from '../src/shared/protocol';
import { connect, get, post, startTestServer, type Client, type TestServer } from './net-helpers';

const DAY = 86400_000;
const uniq = Math.random().toString(36).slice(2, 7);
let ts: TestServer;
const clients: Client[] = [];

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  for (const c of clients) c.close();
  await ts?.stop();
});

const session = (token: string) => ts.srv.db.data.sessions[token];
const start = (name: string) => post(ts.base, '/api/start', { name });

/** fetch that also returns the ctd_token Set-Cookie header (if any) */
async function raw(p: string, init: { method?: string; body?: unknown; token?: string; cookie?: string } = {}) {
  const res = await fetch(ts.base + p, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const cookie = res.headers.getSetCookie().filter((c) => c.startsWith('ctd_token=')).at(-1) ?? null;
  return { status: res.status, json: (await res.json()) as any, cookie };
}

function cookieValue(setCookie: string | null): string | null {
  const m = /^ctd_token=([^;]*)/.exec(setCookie ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

describe('device accounts', () => {
  it('/api/start creates a saved, non-guest player with no password; names are unique usernames', async () => {
    const name = `dev_${uniq}`;
    const r = await raw('/api/start', { method: 'POST', body: { name } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, user: { name, guest: false, secured: false }, stats: { gamesPlayed: 0, wins: 0 } });
    expect(typeof r.json.token).toBe('string');
    const rec = ts.srv.db.userById(r.json.user.id)!;
    expect(rec).toMatchObject({ username: name, usernameLower: name.toLowerCase() });
    expect(rec.salt).toBeUndefined();
    expect(rec.hash).toBeUndefined();

    const me = await get(ts.base, '/api/me', r.json.token);
    expect(me).toMatchObject({ ok: true, user: { id: r.json.user.id, name, guest: false, secured: false } });

    // case-insensitive uniqueness, shared with password accounts
    expect(await start(name.toUpperCase())).toEqual({ ok: false, error: 'That username is taken' });
    const pw = await ts.srv.auth.register(`pw_${uniq}`, 'secret1');
    expect(pw.ok && pw.user.secured).toBe(true);
    expect(ts.srv.auth.start(`PW_${uniq}`)).toEqual({ ok: false, error: 'That username is taken' });
    expect((await ts.srv.auth.register(name, 'secret1')).ok).toBe(false);
    // same name rules as register
    for (const bad of ['ab', 'has space', 'x'.repeat(17), '', 42, undefined]) {
      expect(ts.srv.auth.start(bad)).toEqual({ ok: false, error: 'Username must be 3–16 letters, digits or _' });
    }
  });

  it('device-account sessions never expire and are never pruned; password sessions still do', async () => {
    const dev = await start(`old_${uniq}`);
    const pw = await post(ts.base, '/api/register', { username: `exp_${uniq}`, password: 'secret1' });
    expect(dev.ok && pw.ok).toBe(true);
    session(dev.token).expiresAt = Date.now() - 365 * DAY;
    session(pw.token).expiresAt = Date.now() - 1000;

    // issuing any new session prunes expired ones
    expect((await post(ts.base, '/api/register', { username: `prune_${uniq}`, password: 'secret1' })).ok).toBe(true);
    expect(session(dev.token)).toBeDefined();
    expect(session(pw.token)).toBeUndefined();
    expect((await get(ts.base, '/api/me', pw.token)).ok).toBe(false);

    // a year past the normal window, the device account still resolves (REST and socket)
    expect(await get(ts.base, '/api/me', dev.token)).toMatchObject({ ok: true, user: { id: dev.user.id } });
    const c = await connect(ts.base, dev.token);
    clients.push(c);
    expect((await c.waitFor(EV.hello)).user).toMatchObject({ id: dev.user.id, secured: false });
  });

  it('password-account sessions slide forward when used, at most once a day', async () => {
    const r = await post(ts.base, '/api/register', { username: `slide_${uniq}`, password: 'secret1' });
    expect(r.ok).toBe(true);
    const full = () => Date.now() + NET.sessionDays * DAY;

    session(r.token).expiresAt = Date.now() + 5 * DAY;
    const lo = full();
    expect((await get(ts.base, '/api/me', r.token)).ok).toBe(true);
    expect(session(r.token).expiresAt).toBeGreaterThanOrEqual(lo);
    expect(session(r.token).expiresAt).toBeLessThanOrEqual(full());

    // renewed less than a day ago: left alone (no write)
    const recent = Date.now() + (NET.sessionDays - 0.5) * DAY;
    session(r.token).expiresAt = recent;
    expect((await get(ts.base, '/api/me', r.token)).ok).toBe(true);
    expect(session(r.token).expiresAt).toBe(recent);

    // the socket handshake renews too
    session(r.token).expiresAt = Date.now() + 2 * DAY;
    const c = await connect(ts.base, r.token);
    clients.push(c);
    expect(session(r.token).expiresAt).toBeGreaterThan(Date.now() + (NET.sessionDays - 1) * DAY);
  });

  it('/api/login rejects a passwordless account like a wrong password (and still spends a hash)', async () => {
    const name = `nopw_${uniq}`;
    expect((await start(name)).ok).toBe(true);
    const hash = vi.spyOn(ts.srv.auth as unknown as { hash: (p: string, s: string) => Promise<Buffer> }, 'hash');
    try {
      for (const password of ['', 'anything']) {
        const r = await raw('/api/login', { method: 'POST', body: { username: name, password } });
        expect(r.status).toBe(401);
        expect(r.json).toEqual({ ok: false, error: 'Wrong username or password' });
        expect(r.cookie).toBeNull();
      }
      expect(hash).toHaveBeenCalledTimes(2);
    } finally {
      hash.mockRestore();
    }
  });

  it('/api/set-password secures the same player; name + password then logs in anywhere', async () => {
    const name = `sec_${uniq}`;
    const s = await start(name);
    const id: string = s.user.id;
    const rec = ts.srv.db.userById(id)!;
    rec.stats.gamesPlayed = 3;
    rec.stats.wins = 2;
    rec.progression.marker = 'keep-me';
    // an old device account: its stored expiry passed long ago but was ignored
    session(s.token).expiresAt = Date.now() - 90 * DAY;

    expect(await raw('/api/set-password', { method: 'POST', body: { password: 'secret1' } })).toMatchObject({ status: 401, json: { ok: false } });
    expect(await post(ts.base, '/api/set-password', { password: 'abc' }, s.token)).toEqual({ ok: false, error: 'Password must be at least 4 characters' });
    const g = await post(ts.base, '/api/guest', { name: 'Guesty' });
    expect(await raw('/api/set-password', { method: 'POST', body: { password: 'secret1' }, token: g.token })).toMatchObject({ status: 403, json: { ok: false } });

    const r = await raw('/api/set-password', { method: 'POST', body: { password: 'secret1' }, token: s.token });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, token: s.token, user: { id, name, guest: false, secured: true }, stats: { gamesPlayed: 3, wins: 2 } });
    expect(cookieValue(r.cookie)).toBe(s.token);
    // the session now expires normally, with a fresh clock (so it was not dropped on the spot)
    expect(session(s.token).expiresAt).toBeGreaterThan(Date.now() + (NET.sessionDays - 1) * DAY);
    expect(await get(ts.base, '/api/me', s.token)).toMatchObject({ ok: true, user: { id, secured: true } });
    expect(ts.srv.db.userById(id)!.progression.marker).toBe('keep-me');

    // one password per player: changing it here is refused
    expect(await post(ts.base, '/api/set-password', { password: 'other12' }, s.token)).toEqual({ ok: false, error: 'This player already has a password' });

    // "another device": name + password gives the same player
    const l = await post(ts.base, '/api/login', { username: name.toUpperCase(), password: 'secret1' });
    expect(l).toMatchObject({ ok: true, user: { id, name, guest: false, secured: true }, stats: { gamesPlayed: 3, wins: 2 } });
    expect(l.token).not.toBe(s.token);
    expect((await post(ts.base, '/api/login', { username: name, password: 'other12' })).ok).toBe(false);
  });

  it('cookie backup: set on start/register/login, never for guests; restore brings the player back; logout clears it', async () => {
    const name = `ck_${uniq}`;
    const s = await raw('/api/start', { method: 'POST', body: { name } });
    expect(s.json.ok).toBe(true);
    const set = s.cookie!;
    expect(cookieValue(set)).toBe(s.json.token);
    expect(set).toMatch(/;\s*Path=\/(;|$)/i);
    expect(set).toMatch(/;\s*HttpOnly(;|$)/i);
    expect(set).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(set).toMatch(new RegExp(`;\\s*Max-Age=${400 * 86400}(;|$)`, 'i'));
    expect(set).not.toMatch(/;\s*Secure(;|$)/i); // plain http test server
    const cookie = `theme=dark; ctd_token=${encodeURIComponent(s.json.token)}`;

    // restore: same player and token
    const back = await raw('/api/restore', { cookie });
    expect(back.json).toMatchObject({ ok: true, token: s.json.token, user: { id: s.json.user.id, name, guest: false, secured: false } });
    expect(back.json.stats).toMatchObject({ gamesPlayed: 0 });
    // no cookie / unknown token
    expect((await raw('/api/restore')).json).toEqual({ ok: false });
    const bogus = await raw('/api/restore', { cookie: 'ctd_token=nope' });
    expect(bogus.json).toEqual({ ok: false });
    expect(bogus.cookie).toMatch(/^ctd_token=;/); // the stale cookie is cleared

    // guests never get the cookie
    const g = await raw('/api/guest', { method: 'POST', body: { name: 'Cookieless' } });
    expect(g.json.ok).toBe(true);
    expect(g.cookie).toBeNull();

    // register and login set it too
    const reg = await raw('/api/register', { method: 'POST', body: { username: `ck2_${uniq}`, password: 'secret1' } });
    expect(cookieValue(reg.cookie)).toBe(reg.json.token);
    const li = await raw('/api/login', { method: 'POST', body: { username: `ck2_${uniq}`, password: 'secret1' } });
    expect(cookieValue(li.cookie)).toBe(li.json.token);

    // logging out a different player (another tab) leaves this player's cookie alone
    const other = await raw('/api/logout', { method: 'POST', body: {}, token: li.json.token, cookie });
    expect(other.cookie).toBeNull();
    expect((await raw('/api/restore', { cookie })).json.ok).toBe(true);

    // logging out this player clears the cookie, and the old value no longer restores
    const out = await raw('/api/logout', { method: 'POST', body: {}, token: s.json.token, cookie });
    expect(out.json).toEqual({ ok: true });
    expect(out.cookie).toMatch(/^ctd_token=;/);
    expect(out.cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect((await raw('/api/restore', { cookie })).json).toEqual({ ok: false });
  });

  it('device accounts are real players: they can add friends (guests cannot)', async () => {
    const a = await start(`fa_${uniq}`);
    const b = await start(`fb_${uniq}`);
    const ca = await connect(ts.base, a.token);
    const cb = await connect(ts.base, b.token);
    clients.push(ca, cb);

    const mb = cb.mark();
    expect(await ca.req(EV.friendRequest, { username: b.user.name })).toMatchObject({ ok: true });
    await cb.waitFor<SocialState>(EV.socialState, (st) => st.incoming.some((i) => i.userId === a.user.id), mb);
    expect((await cb.req(EV.friendRespond, { userId: a.user.id, accept: true })).ok).toBe(true);
    expect(ts.srv.db.areFriends(a.user.id, b.user.id)).toBe(true);

    const g = await post(ts.base, '/api/guest', { name: 'Lonely' });
    const cg = await connect(ts.base, g.token);
    clients.push(cg);
    expect((await cg.req(EV.friendRequest, { username: a.user.name })).ok).toBe(false);
  });

  it('the post-match hello keeps `secured` right (the client replaces its user with it)', async () => {
    const dev = await start(`md_${uniq}`);
    const pw = await post(ts.base, '/api/register', { username: `mp_${uniq}`, password: 'secret1' });
    const cd = await connect(ts.base, dev.token);
    const cp = await connect(ts.base, pw.token);
    clients.push(cd, cp);

    const created = await cd.req(EV.roomCreate, { mode: 'coop', mapId: 'greenfield', difficulty: 'normal' });
    expect(created.ok).toBe(true);
    expect((await cp.req(EV.roomJoin, { code: created.room.code })).ok).toBe(true);
    await cp.req(EV.roomReady, { ready: true });
    const [md, mp] = [cd.mark(), cp.mark()];
    expect((await cd.req(EV.roomStart)).ok).toBe(true);
    await cd.waitFor(EV.matchStart, () => true, md);
    ts.srv.rooms.roomOf(dev.user.id)!.match!.fastForward(900); // nobody builds → defeat
    await cd.waitFor(EV.matchOver, () => true, md);

    const helloDev = await cd.waitFor(EV.hello, () => true, md);
    const helloPw = await cp.waitFor(EV.hello, () => true, mp);
    expect(helloDev.user).toMatchObject({ id: dev.user.id, guest: false, secured: false });
    expect(helloPw.user).toMatchObject({ id: pw.user.id, guest: false, secured: true });
    expect(helloDev.stats.gamesPlayed).toBe(1);
  });
});
