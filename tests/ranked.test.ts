// Ranked end-to-end on a real server: matchmaking, a full match via the dev fast-forward
// hook, trophies, a reward drop, leaderboards, bot backfill (solo + 2v2 party).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import type { LeaderboardView, MatchRewards, MmStatus, PartyView, ProfileView, VsInfo } from '../src/shared/progProtocol';
import { EV, type MatchResults, type MatchStartInfo } from '../src/shared/protocol';
import { connect, post, sleep, startTestServer, type Client, type TestServer } from './net-helpers';

let ts: TestServer;
const uniq = Math.random().toString(36).slice(2, 7);
interface Acct {
  token: string;
  id: string;
  c: Client;
}
let A: Acct;
let B: Acct;

async function register(name: string): Promise<Acct> {
  const r = await post(ts.base, '/api/register', { username: name, password: 'pass' });
  expect(r.ok).toBe(true);
  return { token: r.token, id: r.user.id, c: await connect(ts.base, r.token) };
}
const dev = (who: Acct, p: string, body: object = {}) => post(ts.base, `/api/dev/${p}`, body, who.token);

beforeAll(async () => {
  ts = await startTestServer({
    progression: { devTools: true, botTimeoutSec: 1.2, vsSplashSec: 0.2, tickMs: 100, rankedOverrides: { firstWaveDelay: 1 } },
  });
  A = await register(`ra_${uniq}`);
  B = await register(`rb_${uniq}`);
});

afterAll(async () => {
  A?.c.close();
  B?.c.close();
  await ts?.stop();
});

function buildable(n: number) {
  const map = MAPS.greenfield;
  const out: { tx: number; ty: number }[] = [];
  for (let y = 0; y < map.height && out.length < n; y++)
    for (let x = 0; x < map.width && out.length < n; x++) if (map.tiles[y * map.width + x] === TILE_BUILDABLE) out.push({ tx: x, ty: y });
  return out;
}

describe('ranked duel between two accounts', () => {
  it('matches them, plays to completion, updates trophies, grants a drop and the leaderboard', async () => {
    // both start at 400 trophies (Canyon Fort reached → 300 gate)
    expect((await dev(A, 'trophies', { duel: 400 })).ok).toBe(true);
    expect((await dev(B, 'trophies', { duel: 400 })).ok).toBe(true);
    const ma = A.c.mark();
    const mb = B.c.mark();
    expect((await A.c.req(EV.mmQueue, { mode: 'duel' })).ok).toBe(true);
    await A.c.waitFor<MmStatus>(EV.mmStatus, (s) => s.state === 'searching', ma);
    expect((await B.c.req(EV.mmQueue, { mode: 'duel' })).ok).toBe(true);
    const vs = await A.c.waitFor<VsInfo>(EV.mmFound, () => true, ma);
    expect(vs.mode).toBe('duel');
    const sides = [...vs.teams[0], ...vs.teams[1]];
    expect(sides.map((s) => s.id).sort()).toEqual([A.id, B.id].sort());
    expect(sides.every((s) => !s.bot)).toBe(true);
    const start = await A.c.waitFor<MatchStartInfo>(EV.matchStart, () => true, ma);
    await B.c.waitFor<MatchStartInfo>(EV.matchStart, () => true, mb);
    expect(start).toMatchObject({ ranked: true, vsBot: false, mode: 'ffa' });
    expect(start.players.length).toBe(2);

    // B defends, A doesn't → A's board falls first
    const bBoard = start.players.find((p) => p.id === B.id)!.boardId;
    let placed = 0;
    for (const t of buildable(40)) {
      const r = await B.c.req(EV.placeTower, { boardId: bBoard, tx: t.tx, ty: t.ty, type: 'archer' });
      if (r.ok) placed++;
      if (placed >= 4) break;
    }
    expect(placed).toBeGreaterThanOrEqual(3);
    expect((await dev(A, 'fast-forward', { seconds: 900 })).ok).toBe(true);
    const res = await A.c.waitFor<MatchResults>(EV.matchOver, () => true, ma);
    expect(res.ranked).toBe(true);
    expect(res.winners).toEqual([B.id]);
    const ra = await A.c.waitFor<MatchRewards>(EV.progMatchRewards, () => true, ma);
    const rb = await B.c.waitFor<MatchRewards>(EV.progMatchRewards, () => true, mb);
    expect(ra.trophies).toEqual({ ladder: 'duel', before: 400, after: 374, delta: -26 });
    expect(rb.trophies).toEqual({ ladder: 'duel', before: 400, after: 430, delta: 30 });
    expect(rb.drop.granted).toBe(true);
    expect(ra.drop.granted).toBe(false);
    // the ranked room closes silently and both are back home
    await A.c.waitFor(EV.roomClosed, (p: { silent?: boolean }) => !!p.silent, ma);

    // open the drop
    const prof = await B.c.req<{ ok: boolean; profile: ProfileView }>(EV.progGet);
    expect(prof.profile.duel).toBe(430);
    expect(prof.profile.drops.pending.length).toBe(1);
    const opened = await B.c.req(EV.progOpenDrop, { dropId: prof.profile.drops.pending[0].id });
    expect(opened.ok).toBe(true);
    expect(opened.steps[0]).toBe('common');
    expect(opened.granted.length).toBeGreaterThan(0);
    expect((await B.c.req(EV.progOpenDrop, { dropId: prof.profile.drops.pending[0].id })).ok).toBe(false);

    // leaderboard reflects it (and contains no bots)
    const lb = await A.c.req<{ ok: true } & LeaderboardView>(EV.progLeaderboard, { board: 'duel', scope: 'global', period: 'season' });
    expect(lb.ok).toBe(true);
    expect(lb.rows.slice(0, 2).map((r) => [r.userId, r.value])).toEqual([
      [B.id, 430],
      [A.id, 374],
    ]);
    expect(lb.me).toMatchObject({ userId: A.id, rank: 2 });
    expect(lb.rows.some((r) => r.userId.startsWith('bot_'))).toBe(false);
  });
});

describe('bot backfill', () => {
  it('a lone searcher gets a bot opponent after the (shortened) timeout', async () => {
    const ma = A.c.mark();
    expect((await A.c.req(EV.mmQueue, { mode: 'duel' })).ok).toBe(true);
    const t0 = Date.now();
    const vs = await A.c.waitFor<VsInfo>(EV.mmFound, () => true, ma, 10_000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    const opp = vs.teams[vs.mySide === 0 ? 1 : 0][0];
    expect(opp.bot).toBe(true);
    expect(Math.abs(opp.trophies - 374)).toBeLessThanOrEqual(60);
    const start = await A.c.waitFor<MatchStartInfo>(EV.matchStart, () => true, ma);
    expect(start.vsBot).toBe(true);
    // forfeit = loss
    await A.c.req(EV.roomLeave);
    const r = await A.c.waitFor<MatchRewards>(EV.progMatchRewards, () => true, ma);
    expect(r.vsBot).toBe(true);
    expect(r.won).toBe(false);
    expect(r.trophies!.delta).toBeLessThan(0);
  });

  it('2v2: a party of two friends is backfilled with two bot opponents', async () => {
    // become friends, form a party
    await A.c.req(EV.friendRequest, { username: `rb_${uniq}` });
    expect((await B.c.req(EV.friendRespond, { userId: A.id, accept: true })).ok).toBe(true);
    const mb = B.c.mark();
    expect((await A.c.req(EV.partyInvite, { userId: B.id })).ok).toBe(true);
    const inv = await B.c.waitFor<{ partyId: string }>(EV.partyInvited, () => true, mb);
    const ma = A.c.mark();
    expect((await B.c.req(EV.partyRespond, { partyId: inv.partyId, accept: true })).ok).toBe(true);
    await A.c.waitFor<PartyView | null>(EV.partyState, (p) => !!p && p.members.length === 2, ma);
    // only the leader may queue; the whole party searches
    expect((await B.c.req(EV.mmQueue, { mode: 'team' })).ok).toBe(false);
    expect((await A.c.req(EV.mmQueue, { mode: 'duel' })).ok).toBe(false);
    const mb2 = B.c.mark();
    expect((await A.c.req(EV.mmQueue, { mode: 'team' })).ok).toBe(true);
    await B.c.waitFor<MmStatus>(EV.mmStatus, (s) => s.state === 'searching' && s.party.length === 2, mb2);
    const vs = await B.c.waitFor<VsInfo>(EV.mmFound, () => true, mb2, 10_000);
    const mine = vs.teams[vs.mySide];
    const theirs = vs.teams[vs.mySide === 0 ? 1 : 0];
    expect(mine.map((s) => s.id).sort()).toEqual([A.id, B.id].sort());
    expect(theirs.length).toBe(2);
    expect(theirs.every((s) => s.bot)).toBe(true);
    const start = await A.c.waitFor<MatchStartInfo>(EV.matchStart, (s) => s.mode === 'teams', ma);
    expect(start.boards.find((b) => b.defenders.includes(A.id))!.defenders).toContain(B.id);
    expect(start.players.filter((p) => p.bot).length).toBe(2);
    // the bots actually play: they build towers on their board within a few seconds
    const botBoard = start.boards.find((b) => !b.defenders.includes(A.id))!.id;
    await A.c.waitFor(EV.matchSnap, (s: { boards: { id: number; towers?: unknown[] }[] }) => (s.boards[botBoard].towers?.length ?? 0) > 0, ma, 10_000);
    // both humans forfeit: the match is settled at once and both get a ranked loss
    const mb3 = B.c.mark();
    const ma3 = A.c.mark();
    await A.c.req(EV.roomLeave);
    await B.c.req(EV.roomLeave);
    const lossB = await B.c.waitFor<MatchRewards>(EV.progMatchRewards, () => true, mb3);
    const lossA = await A.c.waitFor<MatchRewards>(EV.progMatchRewards, () => true, ma3);
    for (const l of [lossA, lossB]) {
      expect(l.ranked).toBe('team');
      expect(l.won).toBe(false);
      expect(l.trophies!.delta).toBeLessThanOrEqual(0);
    }
    await sleep(100);
  });

  it('"Queue ranked 2v2 together" from a lobby queues both players as a party', async () => {
    const created = await A.c.req(EV.roomCreate, { mode: 'teams', mapId: 'greenfield', difficulty: 'normal' });
    expect(created.ok).toBe(true);
    await B.c.req(EV.roomJoin, { code: created.room.code });
    const mb = B.c.mark();
    expect((await B.c.req(EV.roomQueueRanked)).ok).toBe(false); // host only
    expect((await A.c.req(EV.roomQueueRanked)).ok).toBe(true);
    const st = await B.c.waitFor<MmStatus>(EV.mmStatus, (s) => s.state === 'searching', mb);
    expect(st.mode).toBe('team');
    expect(st.party.length).toBe(2);
    await A.c.req(EV.mmCancel);
    await B.c.waitFor<MmStatus>(EV.mmStatus, (s) => s.state === 'idle', mb);
    await A.c.req(EV.roomLeave);
    await B.c.req(EV.roomLeave);
  });

  it('dev endpoints refuse without DEV_TOOLS', async () => {
    const plain = await startTestServer();
    try {
      const r = await post(plain.base, '/api/register', { username: `dv_${uniq}`, password: 'pass' });
      const d = await post(plain.base, '/api/dev/grant', { coins: 100 }, r.token);
      expect(d.ok).toBe(false);
    } finally {
      await plain.stop();
    }
  });
});
