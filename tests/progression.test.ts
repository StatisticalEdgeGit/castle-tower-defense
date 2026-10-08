// Progression rules: trophies, arenas, cards, loadouts, drops, chests, quests, pass,
// season, shop, leaderboards, match rewards.
import { describe, expect, it } from 'vitest';
import { JsonDb, type UserRecord } from '../src/server/db';
import { trophyLeaderboard, endlessLeaderboard, recordEndless } from '../src/server/progression/leaderboard';
import { applyMatchResult, type PlayerOutcome } from '../src/server/progression/matchRewards';
import { currentArena, dayKey, newProfile, roadProgress, weekKey, type Clock, type Profile } from '../src/server/progression/profile';
import { claimQuest, ensureDaily, rerollQuest, trackQuests } from '../src/server/progression/quests';
import {
  buyBundle,
  buyOffer,
  buyPremiumPass,
  claimGift,
  claimPass,
  claimRoad,
  claimablePass,
  grantCards,
  loadoutError,
  mapUnlocked,
  endlessUnlocked,
  openChest,
  openDrop,
  passTier,
  rollDropRarity,
  seatCardLevels,
  setLoadout,
  upgradeCard,
  upgradeCost,
} from '../src/server/progression/rewards';
import { endSeason, getMeta, profileOf } from '../src/server/progression/season';
import { applyTrophies, average, gateFloor, lossTrophies, softReset, winTrophies } from '../src/server/progression/trophies';
import {
  ARENAS,
  arenaForTrophies,
  COINS_PER_LEVEL,
  COPIES_PER_LEVEL,
  DROPS_PER_DAY,
  EQUAL_LEVEL,
  SEASON,
  TROPHY_ROAD,
  towerPool,
} from '../src/shared/progression';
import { mulberry32 } from '../src/shared/rng';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const emptyStats = () => ({ kills: 0, damage: 0, earned: 0, sent: 0, built: 0, builtBy: {}, damageBy: {} });

function fixedClock(ms: number): Clock & { set(v: number): void; advance(d: number): void } {
  let t = ms;
  return { now: () => t, set: (v) => (t = v), advance: (d) => (t += d) };
}

describe('trophies', () => {
  it('win/loss formulas with clamps', () => {
    expect(winTrophies(1000, 1000)).toBe(30);
    expect(winTrophies(1000, 1250)).toBe(40); // 30 + 10
    expect(winTrophies(1000, 2000)).toBe(40); // clamped
    expect(winTrophies(1000, 500)).toBe(20); // clamped
    expect(lossTrophies(1000, 1000)).toBe(26);
    expect(lossTrophies(1000, 750)).toBe(35); // 26 + 10 → 35 (clamp)
    expect(lossTrophies(1000, 1500)).toBe(15);
  });

  it('losses are halved under 300 trophies', () => {
    expect(lossTrophies(200, 200)).toBe(13); // 26 / 2
    expect(lossTrophies(299, 299)).toBe(13);
    expect(lossTrophies(300, 300)).toBe(26);
  });

  it('arena gates: you never drop below the gate of an arena you reached', () => {
    expect(gateFloor(310)).toBe(300);
    const a = applyTrophies(310, 320, 310, false);
    expect(a.after).toBe(300);
    const b = applyTrophies(300, 320, 300, false);
    expect(b.after).toBe(300);
    expect(b.delta).toBe(0);
    const c = applyTrophies(720, 760, 720, false);
    expect(c.after).toBe(700);
    const d = applyTrophies(1000, 1000, 1000, true);
    expect(d).toMatchObject({ after: 1030, delta: 30, best: 1030 });
    // below 300 there is no gate (only the newbie halving), and never below 0
    expect(applyTrophies(5, 5, 5, false).after).toBe(0);
  });

  it('2v2 uses the opposing team average', () => {
    const opp = average([900, 1100]);
    expect(opp).toBe(1000);
    expect(applyTrophies(1000, 1000, opp, true).delta).toBe(30);
    expect(applyTrophies(950, 950, average([1200, 1300]), true).delta).toBe(Math.round(Math.min(40, 30 + (1250 - 950) / 25)));
  });

  it('arena calculation and soft reset', () => {
    expect(arenaForTrophies(0)).toBe(0);
    expect(arenaForTrophies(299)).toBe(0);
    expect(arenaForTrophies(300)).toBe(1);
    expect(arenaForTrophies(3499)).toBe(5);
    expect(arenaForTrophies(9999)).toBe(6);
    const p = newProfile();
    p.duel = 150;
    p.team = 720;
    expect(currentArena(p)).toBe(2);
    p.team = 0;
    p.arenaReached = 2; // permanent
    expect(currentArena(p)).toBe(2);
    expect(softReset(2000, 1500, 0.5)).toBe(1750);
    expect(softReset(1400, 1500, 0.5)).toBe(1400);
    expect(towerPool(0)).toEqual(['archer', 'cannon', 'frost', 'sniper']);
    expect(towerPool(1)).toContain('flame');
  });
});

describe('cards & loadout', () => {
  it('upgrade cost curve and validation', () => {
    expect(upgradeCost('archer', 1)).toEqual({ copies: 2, coins: 5, xp: 4 });
    expect(upgradeCost('archer', 9)).toMatchObject({ copies: 800, coins: 8000 });
    expect(upgradeCost('archer', 10)).toBeNull();
    expect(COPIES_PER_LEVEL.legendary[0]).toBeLessThan(COPIES_PER_LEVEL.common[0]);
    const p = newProfile();
    p.coins = 100;
    expect(upgradeCard(p, 'archer')).toMatchObject({ ok: false });
    grantCards(p, 'archer', 2);
    const r = upgradeCard(p, 'archer');
    expect(r).toMatchObject({ ok: true, level: 2 });
    expect(p.cards.archer).toEqual({ level: 2, copies: 0 });
    expect(p.coins).toBe(100 - COINS_PER_LEVEL[0]);
    expect(upgradeCard(p, 'tesla')).toMatchObject({ ok: false, error: 'Card not unlocked' });
    p.coins = 0;
    grantCards(p, 'archer', 4);
    expect(upgradeCard(p, 'archer')).toMatchObject({ ok: false });
  });

  it('first copy of a locked card unlocks it (NEW)', () => {
    const p = newProfile();
    const g = grantCards(p, 'flame', 3);
    expect(g).toMatchObject({ kind: 'card', isNew: true, level: 1, copiesAfter: 2 });
    expect(p.cards.flame).toEqual({ level: 1, copies: 2 });
  });

  it('loadout may only contain unlocked cards, ≤6 towers and ≤5 troops', () => {
    const p = newProfile();
    expect(loadoutError(p, ['archer', 'cannon'], ['grunts'])).toBeNull();
    expect(loadoutError(p, ['archer', 'tesla'], [])).toMatch(/not unlocked/);
    expect(loadoutError(p, [], [])).toMatch(/Pick/);
    expect(loadoutError(p, ['archer', 'archer'], [])).toMatch(/Duplicate/);
    expect(loadoutError(p, ['archer'], ['knights'])).toMatch(/not unlocked/);
    p.troops.push('knights', 'healers');
    expect(loadoutError(p, ['archer'], ['grunts', 'runners', 'swarm', 'brutes', 'knights', 'healers'])).toMatch(/at most 5/);
    expect(setLoadout(p, ['sniper', 'frost'], ['knights']).ok).toBe(true);
    expect(p.loadout).toEqual(['sniper', 'frost']);
  });

  it('equal-levels seats everyone at level 5; otherwise real levels', () => {
    const p = newProfile();
    p.cards.archer = { level: 8, copies: 0 };
    expect(seatCardLevels(p, null).archer).toBe(8);
    expect(seatCardLevels(p, EQUAL_LEVEL)).toMatchObject({ archer: 5, cannon: 5 });
    expect(seatCardLevels(p, EQUAL_LEVEL).tesla).toBeUndefined(); // still need it unlocked
  });
});

describe('reward drops & chests', () => {
  it('drop rarity distribution is sane with a seeded RNG', () => {
    const rng = mulberry32(42);
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, mythic: 0, legendary: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const s = rollDropRarity(rng);
      counts[s[s.length - 1]]++;
    }
    const f = (k: string) => counts[k] / N;
    expect(f('common')).toBeGreaterThan(0.45);
    expect(f('common')).toBeLessThan(0.55);
    expect(f('rare')).toBeGreaterThan(0.29);
    expect(f('rare')).toBeLessThan(0.39);
    expect(f('epic')).toBeGreaterThan(0.09);
    expect(f('epic')).toBeLessThan(0.17);
    expect(f('mythic')).toBeGreaterThan(0.01);
    expect(f('mythic')).toBeLessThan(0.05);
    expect(f('legendary')).toBeGreaterThan(0.002);
    expect(f('legendary')).toBeLessThan(0.02);
  });

  it('opening a drop removes it and grants something; chests reveal card stacks', () => {
    const p = newProfile();
    p.drops.pending.push({ id: 'd1', source: 'test', at: 0 });
    const before = JSON.stringify({ c: p.coins, g: p.gems, cards: p.cards, i: p.icons, e: p.emotes, t: p.troops });
    const r = openDrop(p, 'u1', 'd1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[0]).toBe('common');
    expect(r.granted.length).toBeGreaterThan(0);
    expect(p.drops.pending.length).toBe(0);
    expect(JSON.stringify({ c: p.coins, g: p.gems, cards: p.cards, i: p.icons, e: p.emotes, t: p.troops })).not.toBe(before);
    expect(openDrop(p, 'u1', 'd1').ok).toBe(false);

    p.chests.push({ id: 'c1', tier: 'magic', source: 'test', at: 0 });
    const c = openChest(p, 'u1', 'c1');
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const cards = c.granted.filter((g) => g.kind === 'card');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(c.granted.some((g) => g.kind === 'coins')).toBe(true);
    // only arena-pool cards can drop in Meadow
    for (const g of cards) if (g.kind === 'card') expect(towerPool(0)).toContain(g.tower);
  });
});

describe('quests & daily rollover', () => {
  it('3 daily + 3 weekly quests, rollover at local midnight, one free reroll', () => {
    const t0 = new Date(2026, 9, 8, 23, 50).getTime();
    const clock = fixedClock(t0);
    const p = newProfile();
    ensureDaily(p, 'u1', clock);
    expect(p.quests.daily.length).toBe(3);
    expect(p.quests.weekly.length).toBe(3);
    expect(p.shop.offers.length).toBe(6);
    const day1 = p.quests.daily.map((q) => q.id).join();
    const offers1 = JSON.stringify(p.shop.offers);
    ensureDaily(p, 'u1', clock); // idempotent
    expect(p.quests.daily.map((q) => q.id).join()).toBe(day1);
    // reroll once
    const first = p.quests.daily[0].id;
    const rr = rerollQuest(p, 'u1', first);
    expect(rr.ok).toBe(true);
    expect(p.quests.daily[0].id).not.toBe(first);
    expect(rerollQuest(p, 'u1', p.quests.daily[1].id)).toMatchObject({ ok: false });
    // drops counter + shop gift
    p.drops.earnedToday = DROPS_PER_DAY;
    p.shop.giftClaimed = true;
    clock.advance(15 * 60_000); // past midnight
    expect(dayKey(clock.now())).not.toBe(dayKey(t0));
    ensureDaily(p, 'u1', clock);
    expect(p.quests.rerolls).toBe(0);
    expect(p.drops.earnedToday).toBe(0);
    expect(p.shop.giftClaimed).toBe(false);
    expect(JSON.stringify(p.shop.offers)).not.toBe(offers1);
    expect(weekKey(new Date(2026, 9, 12).getTime())).not.toBe(weekKey(new Date(2026, 9, 11).getTime())); // Mon vs Sun
  });

  it('tracks progress from match metrics and pays out on claim', () => {
    const clock = fixedClock(new Date(2026, 9, 8, 12).getTime());
    const p = newProfile();
    ensureDaily(p, 'u1', clock);
    p.quests.daily = [
      { id: 'd_destroy', progress: 0, claimed: false },
      { id: 'd_coop15', progress: 0, claimed: false },
      { id: 'd_cannons', progress: 0, claimed: false },
    ];
    const metrics = { played: 1, wins: 0, rankedWins: 0, teamWins: 0, kills: 400, sent: 0, built: 5, builtCannon: 9, damage: 0, damageTesla: 0, damageArcher: 0, coopWave: 12 };
    let prog = trackQuests(p, metrics);
    expect(prog.find((q) => q.id === 'd_destroy')).toMatchObject({ before: 0, after: 400, completed: false });
    prog = trackQuests(p, { ...metrics, coopWave: 16 });
    expect(prog.find((q) => q.id === 'd_destroy')).toMatchObject({ after: 600, completed: true });
    expect(prog.find((q) => q.id === 'd_coop15')).toMatchObject({ after: 15, completed: true }); // max-mode
    expect(p.quests.daily[2].progress).toBe(15); // cannons capped at target
    const coins = p.coins;
    const c = claimQuest(p, 'd_destroy');
    expect(c.ok).toBe(true);
    expect(p.coins).toBe(coins + 150);
    expect(claimQuest(p, 'd_destroy').ok).toBe(false);
  });
});

describe('season pass', () => {
  it('tier math, free/premium claims, premium costs earned gems', () => {
    expect(passTier(0)).toBe(0);
    expect(passTier(SEASON.tokensPerTier * 3 + 50)).toBe(3);
    expect(passTier(1e9)).toBe(SEASON.passTiers);
    const p = newProfile();
    p.pass.tokens = SEASON.tokensPerTier * 2;
    expect(claimablePass(p)).toEqual({ free: [1, 2], premium: [] });
    expect(claimPass(p, 1, 'free').ok).toBe(true);
    expect(claimPass(p, 1, 'free').ok).toBe(false);
    expect(claimPass(p, 3, 'free').ok).toBe(false);
    expect(claimPass(p, 1, 'premium').ok).toBe(false);
    p.gems = SEASON.premiumGemCost - 1;
    expect(buyPremiumPass(p).ok).toBe(false);
    p.gems = SEASON.premiumGemCost;
    expect(buyPremiumPass(p).ok).toBe(true);
    expect(p.gems).toBe(0);
    expect(claimablePass(p).premium).toEqual([1, 2]);
    expect(claimPass(p, 2, 'premium').ok).toBe(true);
  });
});

describe('shop', () => {
  it('daily offers refresh, can be bought once; gift once per day; bundles convert gems', () => {
    const clock = fixedClock(new Date(2026, 9, 8, 9).getTime());
    const p = newProfile();
    ensureDaily(p, 'u1', clock);
    const card = p.shop.offers.find((o) => o.kind === 'card')!;
    expect(card).toBeTruthy();
    expect(towerPool(currentArena(p))).toContain(card.tower);
    p.coins = 100_000;
    expect(buyOffer(p, card.id).ok).toBe(true);
    expect(buyOffer(p, card.id).ok).toBe(false);
    expect(claimGift(p).ok).toBe(true);
    expect(claimGift(p).ok).toBe(false);
    p.gems = 100;
    const coins = p.coins;
    expect(buyBundle(p, 'b_small').ok).toBe(true);
    expect(p.gems).toBe(20);
    expect(p.coins).toBe(coins + 800);
    expect(buyBundle(p, 'b_medium').ok).toBe(false);
  });
});

describe('trophy road & campaign', () => {
  it('road nodes unlock by highest-ever duel + team trophies', () => {
    const p = newProfile();
    p.duelBest = 200;
    p.teamBest = 110;
    expect(roadProgress(p)).toBe(310);
    const arenaNode = TROPHY_ROAD.find((n) => n.trophies === 300)!;
    expect(claimRoad(p, arenaNode.id).ok).toBe(true);
    expect(p.arenaReached).toBe(1);
    expect(claimRoad(p, arenaNode.id).ok).toBe(false);
    const far = TROPHY_ROAD[TROPHY_ROAD.length - 1];
    expect(claimRoad(p, far.id).ok).toBe(false);
  });

  it('maps unlock with 2★ on the previous map; endless after any 2★', () => {
    const p = newProfile();
    expect(mapUnlocked(p, 'greenfield')).toBe(true);
    expect(mapUnlocked(p, 'canyon')).toBe(false);
    expect(endlessUnlocked(p)).toBe(false);
    p.campaign.greenfield = 1;
    expect(mapUnlocked(p, 'canyon')).toBe(false);
    p.campaign.greenfield = 2;
    expect(mapUnlocked(p, 'canyon')).toBe(true);
    expect(endlessUnlocked(p)).toBe(true);
  });
});

describe('match rewards', () => {
  const base: PlayerOutcome = {
    mode: 'ffa',
    mapId: 'greenfield',
    difficulty: 'normal',
    endless: false,
    ranked: 'duel',
    vsBot: false,
    won: true,
    coopVictory: false,
    wavesSurvived: 10,
    stats: emptyStats(),
    oppAvg: 0,
  };
  it('ranked win: trophies, xp, tokens, a drop (daily cap)', () => {
    const clock = fixedClock(Date.now());
    const p = newProfile();
    ensureDaily(p, 'u', clock);
    const r = applyMatchResult(p, base, clock);
    expect(r.trophies).toMatchObject({ ladder: 'duel', before: 0, after: 30, delta: 30 });
    expect(p.duelBest).toBe(30);
    expect(r.drop.granted).toBe(true);
    expect(p.drops.pending.length).toBe(1);
    expect(r.xp.gained).toBe(50);
    expect(r.tokens).toBe(30);
    p.drops.earnedToday = DROPS_PER_DAY;
    expect(applyMatchResult(p, base, clock).drop).toMatchObject({ granted: false, capped: true });
    const loss = applyMatchResult(p, { ...base, won: false }, clock);
    expect(loss.trophies!.delta).toBeLessThan(0);
    expect(loss.drop.granted).toBe(false);
  });

  it('co-op victory grants stars, first-clear rewards and a drop; endless records', () => {
    const clock = fixedClock(Date.now());
    const p = newProfile();
    ensureDaily(p, 'u', clock);
    const r = applyMatchResult(p, { ...base, mode: 'coop', ranked: null, coopVictory: true, difficulty: 'normal', wavesSurvived: 20 }, clock);
    expect(r.stars).toEqual({ mapId: 'greenfield', before: 0, after: 2 });
    expect(r.firstClear?.length).toBeGreaterThan(0);
    expect(r.trophies).toBeNull();
    const again = applyMatchResult(p, { ...base, mode: 'coop', ranked: null, coopVictory: true, difficulty: 'easy', wavesSurvived: 20 }, clock);
    expect(again.stars).toEqual({ mapId: 'greenfield', before: 2, after: 2 });
    const e = applyMatchResult(p, { ...base, mode: 'coop', ranked: null, endless: true, won: false, wavesSurvived: 33 }, clock);
    expect(e.endlessRecord).toBe(33);
    expect(p.endlessBest.greenfield).toBe(33);
  });
});

describe('season end & leaderboards', () => {
  function tmpDb(): JsonDb {
    return new JsonDb(path.join(os.tmpdir(), `ctd-prog-${process.pid}-${Math.random().toString(36).slice(2)}.json`));
  }
  function addUser(db: JsonDb, id: string, name: string, patch: Partial<Profile>): UserRecord {
    const p = { ...newProfile(), ...patch };
    const u: UserRecord = { id, username: name, usernameLower: name.toLowerCase(), salt: '', hash: '', createdAt: 0, stats: { gamesPlayed: 0, wins: 0, bestCoop: {} }, progression: p as never };
    db.data.users[id] = u;
    return u;
  }

  it('season end: soft reset above 1500, reward by peak arena, pass reset, top-3 archive', () => {
    const db = tmpDb();
    const clock = fixedClock(Date.now());
    getMeta(db, clock);
    addUser(db, 'a', 'Alpha', { duel: 2000, team: 100, seasonPeakArena: 4, coins: 0, gems: 0, pass: { season: 1, tokens: 900, premium: true, claimedFree: [1], claimedPremium: [1] } });
    addUser(db, 'b', 'Bravo', { duel: 400, team: 1600, coins: 0, gems: 0 });
    addUser(db, 'c', 'Charlie', { duel: 50, coins: 0, gems: 0 });
    const r = endSeason(db, clock);
    expect(r).toEqual({ ended: 1, started: 2 });
    const a = profileOf(db, 'a', clock)!;
    expect(a.duel).toBe(1750);
    expect(a.team).toBe(100);
    expect(a.pass).toMatchObject({ season: 2, tokens: 0, premium: false, claimedFree: [] });
    expect(a.coins).toBeGreaterThan(0);
    expect(a.seasonNotice).toMatchObject({ season: 1, duelBefore: 2000, duelAfter: 1750 });
    const b = profileOf(db, 'b', clock)!;
    expect(b.team).toBe(1550);
    const meta = getMeta(db, clock);
    expect(meta.season.id).toBe(2);
    expect(meta.lastTop3!.duel.map((x) => x.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(meta.lastTop3!.team[0].name).toBe('Bravo');
    fs.rmSync(db.file, { force: true });
  });

  it('trophy leaderboards: ordering, friends filter, season vs all time, own rank', () => {
    const db = tmpDb();
    addUser(db, 'a', 'Alpha', { duel: 500, duelBest: 900 });
    addUser(db, 'b', 'Bravo', { duel: 800, duelBest: 800 });
    addUser(db, 'c', 'Charlie', { duel: 650, duelBest: 650 });
    addUser(db, 'd', 'Delta', { duel: 0 });
    const users = Object.values(db.data.users);
    const season = trophyLeaderboard(users, 'duel', 'season', null, 'c');
    expect(season.rows.map((r) => r.name)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(season.me).toMatchObject({ rank: 2, value: 650 });
    const all = trophyLeaderboard(users, 'duel', 'all', null, 'd');
    expect(all.rows.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    expect(all.me).toMatchObject({ rank: 4, value: 0 });
    const friends = trophyLeaderboard(users, 'duel', 'season', new Set(['a', 'c']), 'c');
    expect(friends.rows.map((r) => r.name)).toEqual(['Charlie', 'Alpha']);
    // bots are not users, so they can't appear
    expect(season.rows.some((r) => r.userId.startsWith('bot'))).toBe(false);
  });

  it('endless leaderboard keeps the best run per team composition', () => {
    const entries: Parameters<typeof recordEndless>[0] = [];
    const A = { id: 'a', name: 'Alpha' };
    const B = { id: 'b', name: 'Bravo' };
    const C = { id: 'c', name: 'Charlie' };
    recordEndless(entries, { mapId: 'greenfield', players: [A, B], wave: 20, season: 1, at: 1 });
    recordEndless(entries, { mapId: 'greenfield', players: [B, A], wave: 25, season: 1, at: 2 });
    recordEndless(entries, { mapId: 'greenfield', players: [C], wave: 22, season: 1, at: 3 });
    recordEndless(entries, { mapId: 'greenfield', players: [C], wave: 30, season: 0, at: 0 });
    recordEndless(entries, { mapId: 'canyon', players: [A], wave: 99, season: 1, at: 4 });
    const look = () => ({ icon: 'shield', level: 1, arena: 0 });
    const s = endlessLeaderboard(entries, 'greenfield', 'season', 1, null, 'c', look);
    expect(s.rows.map((r) => r.value)).toEqual([25, 22]);
    expect(s.rows[0].name).toBe('Bravo & Alpha');
    expect(s.me).toMatchObject({ rank: 2 });
    const all = endlessLeaderboard(entries, 'greenfield', 'all', 1, null, 'c', look);
    expect(all.rows.map((r) => r.value)).toEqual([30, 25]);
    const fr = endlessLeaderboard(entries, 'greenfield', 'season', 1, new Set(['c']), 'c', look);
    expect(fr.rows.length).toBe(1);
    expect(ARENAS.length).toBe(7);
  });
});
