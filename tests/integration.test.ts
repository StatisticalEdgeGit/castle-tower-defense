// End-to-end: real server (random port, temp db) + socket.io clients. No mocks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEND_PACKS } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import { EV, type MatchResults, type MatchStartInfo, type RoomState, type Snapshot, type SocialState } from '../src/shared/protocol';
import { connect, get, post, sleep, startTestServer, type Client, type TestServer } from './net-helpers';

let ts: TestServer;
const uniq = Math.random().toString(36).slice(2, 7);
const nameA = `alice_${uniq}`;
const nameB = `bob_${uniq}`;

interface Acct {
  token: string;
  id: string;
  c: Client;
}

let A: Acct;
let B: Acct;
let G: Acct;

beforeAll(async () => {
  ts = await startTestServer({ rooms: { ruleOverrides: { firstWaveDelay: 0.5 } } });
});

afterAll(async () => {
  for (const x of [A, B, G]) x?.c.close();
  await ts?.stop();
});

function buildable(n: number): { tx: number; ty: number }[] {
  const map = MAPS.greenfield;
  const out: { tx: number; ty: number }[] = [];
  for (let y = 0; y < map.height && out.length < n; y++)
    for (let x = 0; x < map.width && out.length < n; x++) if (map.tiles[y * map.width + x] === TILE_BUILDABLE) out.push({ tx: x, ty: y });
  return out;
}

async function leaveAll() {
  for (const x of [A, B, G]) await x.c.req(EV.roomLeave).catch(() => undefined);
}

describe('accounts, friends, invites, rooms and a co-op match', () => {
  it('registers, logs in, rejects bad credentials', async () => {
    const ra = await post(ts.base, '/api/register', { username: nameA, password: 'pass1' });
    const rb = await post(ts.base, '/api/register', { username: nameB, password: 'pass2' });
    expect(ra.ok && rb.ok).toBe(true);
    expect((await post(ts.base, '/api/register', { username: nameA.toUpperCase(), password: 'xxxx' })).ok).toBe(false); // case-insensitive unique
    expect((await post(ts.base, '/api/register', { username: 'ab', password: 'xxxx' })).ok).toBe(false);
    expect((await post(ts.base, '/api/register', { username: 'okname', password: 'abc' })).ok).toBe(false);
    expect((await post(ts.base, '/api/login', { username: nameA, password: 'wrong' })).ok).toBe(false);
    const la = await post(ts.base, '/api/login', { username: nameA.toUpperCase(), password: 'pass1' });
    expect(la.ok).toBe(true);
    const me = await get(ts.base, '/api/me', la.token);
    expect(me.user.name).toBe(nameA);
    A = { token: la.token, id: la.user.id, c: await connect(ts.base, la.token) };
    B = { token: rb.token, id: rb.user.id, c: await connect(ts.base, rb.token) };
    const g = await post(ts.base, '/api/guest', { name: 'Guesty' });
    expect(g.ok && g.user.guest).toBe(true);
    G = { token: g.token, id: g.user.id, c: await connect(ts.base, g.token) };
    await expect(connect(ts.base, 'bogus-token')).rejects.toThrow();
    const info = await get(ts.base, '/api/server-info');
    expect(Array.isArray(info.lan)).toBe(true);
  });

  it('friend request → accept → live presence', async () => {
    const mb = B.c.mark();
    const r = await A.c.req(EV.friendRequest, { username: nameB.toUpperCase() });
    expect(r).toMatchObject({ ok: true, autoAccepted: false });
    await B.c.waitFor<SocialState>(EV.socialState, (s) => s.incoming.some((i) => i.userId === A.id), mb);
    await B.c.waitFor(EV.toast, (t: any) => t.text.includes('friend request'), mb);
    expect((await A.c.req(EV.friendRequest, { username: nameB })).ok).toBe(false); // duplicate
    expect((await G.c.req(EV.friendRequest, { username: nameA })).ok).toBe(false); // guests can't

    const ma = A.c.mark();
    expect((await B.c.req(EV.friendRespond, { userId: A.id, accept: true })).ok).toBe(true);
    const sa = await A.c.waitFor<SocialState>(EV.socialState, (s) => s.friends.some((f) => f.id === B.id), ma);
    expect(sa.friends.find((f) => f.id === B.id)!.status).toBe('online');
    await A.c.waitFor(EV.toast, (t: any) => t.text.includes('accepted'), ma);
  });

  it('host creates a room, invites a friend in-app, guest joins by code, co-op starts and towers sync', async () => {
    const mb = B.c.mark();
    const created = await A.c.req(EV.roomCreate, { mode: 'coop', mapId: 'greenfield', difficulty: 'normal', isPublic: false });
    expect(created.ok).toBe(true);
    const code: string = created.room.code;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    // B sees A's presence change to "lobby"
    await B.c.waitFor(EV.presence, (p: any) => p.userId === A.id && p.status === 'lobby', mb);

    // in-app invite
    const mb2 = B.c.mark();
    expect((await A.c.req(EV.inviteSend, { userId: B.id })).ok).toBe(true);
    const inv = await B.c.waitFor<any>(EV.inviteIncoming, (i) => i.fromId === A.id, mb2);
    expect(inv).toMatchObject({ roomCode: code, mode: 'coop', mapId: 'greenfield' });
    const ma = A.c.mark();
    const acc = await B.c.req(EV.inviteRespond, { inviteId: inv.id, accept: true });
    expect(acc.ok).toBe(true);
    await A.c.waitFor<RoomState>(EV.roomState, (r) => r.players.length === 2, ma);
    // the invite is single use
    expect((await B.c.req(EV.inviteRespond, { inviteId: inv.id, accept: true })).ok).toBe(false);

    // guest joins by code (lower-case works too)
    const gj = await G.c.req(EV.roomJoin, { code: code.toLowerCase() });
    expect(gj.ok).toBe(true);
    expect(gj.room.players.map((p: any) => p.id)).toEqual([A.id, B.id, G.id]);
    expect((await G.c.req(EV.roomJoin, { code: 'ZZZZZZ' })).ok).toBe(false);
    const preview = await get(ts.base, `/api/rooms/${code}`);
    expect(preview).toMatchObject({ ok: true, players: 3, state: 'waiting' });

    // start requires everyone ready
    expect((await A.c.req(EV.roomStart)).ok).toBe(false);
    expect((await B.c.req(EV.roomStart)).ok).toBe(false); // not host
    await B.c.req(EV.roomReady, { ready: true });
    await G.c.req(EV.roomReady, { ready: true });
    const marks = [A, B, G].map((x) => x.c.mark());
    expect((await A.c.req(EV.roomStart)).ok).toBe(true);
    const starts = await Promise.all([A, B, G].map((x, i) => x.c.waitFor<MatchStartInfo>(EV.matchStart, () => true, marks[i])));
    expect(starts[0].mode).toBe('coop');
    expect(starts[0].boards.length).toBe(1);
    expect(starts[0].boards[0].defenders.length).toBe(3);
    expect(starts[0].boards[0].maxLives).toBe(Math.round(25 * 2.2));

    // place towers through intents, see them in snapshots
    const [t1, t2] = buildable(2);
    const pa = await A.c.req(EV.placeTower, { boardId: 0, tx: t1.tx, ty: t1.ty, type: 'archer' });
    expect(pa.ok).toBe(true);
    const pb = await B.c.req(EV.placeTower, { boardId: 0, tx: t2.tx, ty: t2.ty, type: 'frost' });
    expect(pb.ok).toBe(true);
    const bad = await G.c.req(EV.placeTower, { boardId: 0, tx: t1.tx, ty: t1.ty, type: 'archer' });
    expect(bad).toMatchObject({ ok: false, error: 'Tile occupied' });
    expect((await G.c.req(EV.upgradeTower, { towerId: pa.towerId })).ok).toBe(false); // not owner
    const snap = await G.c.waitFor<Snapshot>(EV.matchSnap, (s) => (s.boards[0].towers ?? []).length === 2);
    const towers = snap.boards[0].towers!;
    expect(towers.find((t) => t.id === pa.towerId)).toMatchObject({ owner: A.id, type: 'archer' });
    expect(towers.find((t) => t.id === pb.towerId)).toMatchObject({ owner: B.id, type: 'frost' });
    // the wave starts (shortened prep) and enemies appear in snapshots
    const s2 = await A.c.waitFor<Snapshot>(EV.matchSnap, (s) => s.wave >= 1 && s.boards[0].enemies.length > 0);
    expect(s2.boards[0].enemies[0]).toHaveLength(6);
    // B's presence is now "game"
    const mPresence = A.c.mark();
    await A.c.req(EV.roomChat, { text: 'gl hf' });
    await B.c.waitFor(EV.chatMsg, (m: any) => m.text === 'gl hf');
    expect(mPresence).toBeGreaterThan(0);

    // reconnect: a new socket for B gets the match back immediately
    B.c.close();
    await sleep(100);
    B.c = await connect(ts.base, B.token);
    await B.c.waitFor(EV.matchStart);
    const full = await B.c.waitFor<Snapshot>(EV.matchSnap, (s) => (s.boards[0].towers ?? []).length === 2);
    expect(full.boards[0].towers!.length).toBe(2);
    await leaveAll();
  });
});

describe('versus sends', () => {
  async function startVersus(mode: 'ffa' | 'teams', guestTeam?: number): Promise<{ info: MatchStartInfo; from: number }> {
    const created = await A.c.req(EV.roomCreate, { mode, mapId: 'greenfield', difficulty: 'normal' });
    expect(created.ok).toBe(true);
    const code = created.room.code;
    expect((await B.c.req(EV.roomJoin, { code })).ok).toBe(true);
    if (guestTeam !== undefined) {
      expect((await G.c.req(EV.roomJoin, { code })).ok).toBe(true);
      const room: RoomState = (await G.c.waitFor<RoomState>(EV.roomState, (r) => r.code === code && r.players.length === 3));
      const g = room.players.find((p) => p.id === G.id)!;
      if (g.team !== guestTeam) expect((await G.c.req(EV.roomTeam, { team: guestTeam })).ok).toBe(true);
      await G.c.req(EV.roomReady, { ready: true });
    }
    await B.c.req(EV.roomReady, { ready: true });
    const m = A.c.mark();
    const st = await A.c.req(EV.roomStart);
    expect(st).toMatchObject({ ok: true });
    const info = await A.c.waitFor<MatchStartInfo>(EV.matchStart, () => true, m);
    return { info, from: m };
  }

  it('FFA: A sends grunts to B — money drops, income rises, B gets exactly the pack', async () => {
    const { info, from } = await startVersus('ffa');
    expect(info.boards.length).toBe(2);
    const boardA = info.players.find((p) => p.id === A.id)!.boardId;
    const boardB = info.players.find((p) => p.id === B.id)!.boardId;
    // locked before wave 1
    expect((await A.c.req(EV.sendTroops, { packId: 'grunts', targetPlayerId: B.id })).ok).toBe(false);
    await A.c.waitFor<Snapshot>(EV.matchSnap, (s) => s.wave >= 1, from);
    const before = A.c.last<Snapshot>(EV.matchSnap)!.players.find((p) => p.id === A.id)!;
    const mb = B.c.mark();
    const ma = A.c.mark();
    const r = await A.c.req(EV.sendTroops, { packId: 'grunts', targetPlayerId: B.id });
    expect(r).toMatchObject({ ok: true, count: 6, targetBoard: boardB });
    const after = await A.c.waitFor<Snapshot>(EV.matchSnap, () => true, ma);
    const me = after.players.find((p) => p.id === A.id)!;
    expect(me.money).toBe(before.money - SEND_PACKS.grunts.cost);
    expect(me.income).toBe(before.income + SEND_PACKS.grunts.income);
    expect(me.cds[0]).toBeGreaterThan(0);
    // cooldown enforced
    expect((await A.c.req(EV.sendTroops, { packId: 'grunts', targetPlayerId: B.id })).ok).toBe(false);
    // B's board gets the INCOMING warning with the scaled count (k=1 → ×1)
    const inc = await B.c.waitFor<Snapshot>(EV.matchSnap, (s) => s.boards[boardB].fx.some((f) => f.k === 'inc'), mb);
    const fx = inc.boards[boardB].fx.find((f) => f.k === 'inc')!;
    expect(fx).toMatchObject({ k: 'inc', from: A.id, pack: 'grunts', count: 6 });
    // after the warning B's board holds exactly 6 more enemies than A's (identical AI waves, no towers)
    const diff = await B.c.waitFor<Snapshot>(
      EV.matchSnap,
      (s) => s.boards[boardB].enemies.length - s.boards[boardA].enemies.length === 6,
      mb,
      10000,
    );
    expect(diff.boards[boardB].enemies.length).toBeGreaterThan(diff.boards[boardA].enemies.length);
    await leaveAll();
  });

  it('Teams: sends into a 2-player board are multiplied by 1.6', async () => {
    const { info, from } = await startVersus('teams', 1);
    const teamOfB = info.players.find((p) => p.id === B.id)!.boardId;
    const teamOfG = info.players.find((p) => p.id === G.id)!.boardId;
    expect(teamOfB).toBe(teamOfG);
    const targetBoard = info.boards.find((b) => b.id === teamOfB)!;
    expect(targetBoard.defenders.length).toBe(2);
    expect(targetBoard.maxLives).toBe(40);
    await A.c.waitFor<Snapshot>(EV.matchSnap, (s) => s.wave >= 1, from);
    const mb = B.c.mark();
    const r = await A.c.req(EV.sendTroops, { packId: 'grunts' });
    expect(r).toMatchObject({ ok: true, count: 10, targetBoard: teamOfB });
    const inc = await B.c.waitFor<Snapshot>(EV.matchSnap, (s) => s.boards[teamOfB].fx.some((f) => f.k === 'inc'), mb);
    expect(inc.boards[teamOfB].fx.find((f) => f.k === 'inc')).toMatchObject({ count: 10 });
    // the reverse direction (into a 1-player board) is not scaled
    const rb = await B.c.req(EV.sendTroops, { packId: 'grunts' });
    expect(rb).toMatchObject({ ok: true, count: 6 });
    await leaveAll();
  });

  it('a finished match persists stats and returns the room to the lobby', async () => {
    // (the earlier versus games already counted: leaving a versus match forfeits it)
    const before = (await get(ts.base, '/api/me', A.token)).stats;
    expect(before.gamesPlayed).toBe(2);
    const created = await A.c.req(EV.roomCreate, { mode: 'coop', mapId: 'greenfield', difficulty: 'normal' });
    expect(created.ok).toBe(true);
    const m = A.c.mark();
    expect((await A.c.req(EV.roomStart)).ok).toBe(true);
    await A.c.waitFor(EV.matchStart, () => true, m);
    const room = ts.srv.rooms.roomOf(A.id)!;
    room.match!.fastForward(900); // nobody builds → defeat within a few waves
    const res = await A.c.waitFor<MatchResults>(EV.matchOver, () => true, m);
    expect(res.outcome).toBe('defeat');
    expect(res.players[0].id).toBe(A.id);
    const st = await A.c.waitFor<RoomState>(EV.roomState, (r) => r.state === 'waiting' && !!r.lastResults, m);
    expect(st.players.length).toBe(1);
    const me = await get(ts.base, '/api/me', A.token);
    expect(me.stats.gamesPlayed).toBe(before.gamesPlayed + 1);
    expect(me.stats.wins).toBe(before.wins);
    expect(me.stats.bestCoop['greenfield:normal']).toBe(res.wavesSurvived);
    await A.c.req(EV.roomLeave);
  });

  it('kicked / leaving players free the room; empty rooms are deleted', async () => {
    const created = await A.c.req(EV.roomCreate, { mode: 'ffa', mapId: 'canyon', difficulty: 'hard' });
    const code = created.room.code;
    await B.c.req(EV.roomJoin, { code });
    const mb = B.c.mark();
    expect((await A.c.req(EV.roomKick, { playerId: B.id })).ok).toBe(true);
    await B.c.waitFor(EV.roomClosed, () => true, mb);
    // host migrates when the host leaves
    await B.c.req(EV.roomJoin, { code });
    const m = B.c.mark();
    await A.c.req(EV.roomLeave);
    const st = await B.c.waitFor<RoomState>(EV.roomState, (r) => r.players.length === 1, m);
    expect(st.hostId).toBe(B.id);
    await B.c.req(EV.roomLeave);
    const gone = await get(ts.base, `/api/rooms/${code}`);
    expect(gone.ok).toBe(false);
  });
});
