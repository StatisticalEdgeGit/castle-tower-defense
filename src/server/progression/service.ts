// Wires the progression layer into the server: profile storage + views, socket handlers
// (collection, rewards, quests, pass, shop, leaderboards, ranked queue, parties, emotes),
// room hooks (loadouts, card levels, campaign locks, rewards after matches) and the
// DEV_TOOLS-only REST endpoints. All currency/reward logic is server-side.
import crypto from 'node:crypto';
import type express from 'express';
import { MAPS } from '../../shared/maps';
import type { LeaderboardQuery, LeaderboardView, MatchRewards, MmStatus, PartyView, ProfileView, RankedMode } from '../../shared/progProtocol';
import {
  CAMPAIGN_ORDER,
  DROPS_PER_DAY,
  EMOTE_COOLDOWN_SEC,
  EMOTES,
  EQUAL_LEVEL,
  ICONS,
  STARTER_EMOTES,
  STARTER_ICONS,
} from '../../shared/progression';
import { EV, type MatchResults } from '../../shared/protocol';
import { CLASSIC_PACKS, CLASSIC_TOWERS, PACK_IDS, TOWER_TYPES, type MapId, type TowerType } from '../../shared/types';
import type { ServerContext } from '../app';
import type { Identity } from '../auth';
import { fail, roomChannel, type Result, type Sock } from '../io';
import type { Match } from '../match';
import type { Room, RoomMember } from '../rooms';
import { endlessLeaderboard, recordEndless, trophyLeaderboard } from './leaderboard';
import { Matchmaker, type MatchmakerOptions, type Searcher } from './matchmaking';
import { applyMatchResult } from './matchRewards';
import { currentArena, levelInfo, msUntilMidnight, newProfile, roadProgress, systemClock, type Clock, type Profile } from './profile';
import { claimableQuests, claimQuest, ensureDaily, questDef, rerollQuest } from './quests';
import {
  buyBundle,
  buyOffer,
  buyPremiumPass,
  canUpgrade,
  claimableRoad,
  claimablePass,
  claimGift,
  claimPass,
  claimRoad,
  endlessUnlocked,
  grantCards,
  grantXp,
  mapUnlocked,
  openChest,
  openDrop,
  passTier,
  seatCardLevels,
  setLoadout,
  upgradeCard,
  upgradeCost,
} from './rewards';
import { checkSeason, endSeason, getMeta, profileOf } from './season';
import { average } from './trophies';

export interface ProgressionOptions extends MatchmakerOptions {
  clock?: Clock;
  /** enables /api/dev/* endpoints and the in-game Dev panel */
  devTools?: boolean;
}

interface Party {
  id: string;
  leaderId: string;
  members: string[];
}

export class ProgressionService {
  readonly clock: Clock;
  readonly mm: Matchmaker;
  readonly devTools: boolean;
  private parties = new Map<string, Party>();
  private userParty = new Map<string, string>();
  private partyInvites = new Map<string, { partyId: string; to: string; expiresAt: number }>();
  private emoteAt = new Map<string, number>();
  private forfeits = new Set<string>();
  private lastSeasonCheck = 0;

  constructor(
    private readonly ctx: ServerContext,
    opts: ProgressionOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.devTools = !!opts.devTools;
    this.mm = new Matchmaker(ctx.rooms, ctx.social, this.clock, opts, (uid) => this.pushMm(uid));
    getMeta(ctx.db, this.clock);
    this.installRoomHooks();
    ctx.onConnection.push((sock) => this.attach(sock));
    this.registerRoutes(ctx.app);
  }

  dispose(): void {
    this.mm.dispose();
  }

  // ── profiles ─────────────────────────────────────────────────────────────
  /** Load (and maintain: daily rollover, season end) a profile. Null for guests / unknown. */
  profile(userId: string): Profile | null {
    const now = this.clock.now();
    if (now - this.lastSeasonCheck > 1000) {
      this.lastSeasonCheck = now;
      if (checkSeason(this.ctx.db, this.clock)) this.pushAll();
    }
    const p = profileOf(this.ctx.db, userId, this.clock);
    if (!p) return null;
    ensureDaily(p, userId, this.clock);
    return p;
  }

  save(): void {
    this.ctx.db.save();
  }

  view(userId: string, p: Profile): ProfileView {
    const li = levelInfo(p.xp);
    const meta = getMeta(this.ctx.db, this.clock);
    const now = this.clock.now();
    const cards: ProfileView['cards'] = {};
    let upgradable = 0;
    for (const t of TOWER_TYPES) {
      const c = p.cards[t];
      if (!c) continue;
      const cost = upgradeCost(t, c.level);
      const can = canUpgrade(p, t);
      if (can) upgradable++;
      cards[t] = { level: c.level, copies: c.copies, need: cost?.copies ?? null, coins: cost?.coins ?? null, canUpgrade: can };
    }
    const qv = (q: Profile['quests']['daily'][number], weekly: boolean) => {
      const d = questDef(q.id)!;
      return { id: q.id, text: d.text, progress: q.progress, target: d.target, claimed: q.claimed, weekly, coins: d.coins, xp: d.xp, tokens: d.tokens };
    };
    const road = claimableRoad(p);
    const pass = claimablePass(p);
    const quests = claimableQuests(p);
    return {
      coins: p.coins,
      gems: p.gems,
      level: li.level,
      xpInto: li.into,
      xpNeed: li.need,
      duel: p.duel,
      team: p.team,
      duelBest: p.duelBest,
      teamBest: p.teamBest,
      arena: currentArena(p),
      arenaReached: p.arenaReached,
      roadProgress: roadProgress(p),
      roadClaimed: p.roadClaimed.slice(),
      roadClaimable: road,
      cards,
      troops: p.troops.slice(),
      loadout: p.loadout.slice(),
      army: p.army.slice(),
      icons: p.icons.slice(),
      emotes: p.emotes.slice(),
      icon: p.icon,
      drops: { earnedToday: p.drops.earnedToday, cap: DROPS_PER_DAY, pending: p.drops.pending.map((d) => ({ id: d.id, source: d.source })) },
      chests: p.chests.map((c) => ({ id: c.id, tier: c.tier, source: c.source })),
      quests: {
        daily: p.quests.daily.filter((q) => questDef(q.id)).map((q) => qv(q, false)),
        weekly: p.quests.weekly.filter((q) => questDef(q.id)).map((q) => qv(q, true)),
        rerollsLeft: Math.max(0, 1 - p.quests.rerolls),
        dailyResetIn: msUntilMidnight(now),
      },
      pass: {
        season: p.pass.season,
        tokens: p.pass.tokens,
        tier: passTier(p.pass.tokens),
        premium: p.pass.premium,
        claimedFree: p.pass.claimedFree.slice(),
        claimedPremium: p.pass.claimedPremium.slice(),
        claimableFree: pass.free,
        claimablePremium: pass.premium,
      },
      shop: { offers: p.shop.offers.map((o) => ({ ...o })), giftClaimed: p.shop.giftClaimed, refreshesIn: msUntilMidnight(now) },
      campaign: { ...p.campaign },
      endlessBest: { ...p.endlessBest },
      endlessUnlocked: endlessUnlocked(p),
      unlockedMaps: CAMPAIGN_ORDER.filter((m) => mapUnlocked(p, m)),
      ranked: { ...p.ranked },
      season: { id: meta.season.id, endsAt: meta.season.endsAt, lastTop3: meta.lastTop3 },
      seasonNotice: p.seasonNotice,
      badges: {
        shop: p.shop.giftClaimed ? 0 : 1,
        collection: upgradable,
        battle: p.drops.pending.length + p.chests.length,
        progress: road.length + pass.free.length + pass.premium.length + quests.length,
        road: road.length,
        pass: pass.free.length + pass.premium.length,
        quests: quests.length,
      },
    };
  }

  push(userId: string): void {
    if (!this.ctx.social.isOnline(userId)) return;
    const p = this.profile(userId);
    if (p) this.ctx.social.emitTo(userId, EV.progState, this.view(userId, p));
  }

  private pushAll(): void {
    for (const id of Object.keys(this.ctx.db.data.users)) this.push(id);
  }

  /** Mutate a profile with `fn`, persist, push the new state. */
  private mutate<T extends object>(userId: string, fn: (p: Profile) => Result<T>): Result<T> {
    const p = this.profile(userId);
    if (!p) return fail('Create an account to unlock progression');
    const r = fn(p);
    if (r.ok) {
      this.save();
      this.push(userId);
      this.ctx.rooms.refreshUser(userId);
    }
    return r;
  }

  // ── matchmaking status / parties ─────────────────────────────────────────
  mmStatus(userId: string): MmStatus {
    const e = this.mm.entryOf(userId);
    if (!e) return { state: 'idle', mode: null, since: 0, party: [] };
    return { state: 'searching', mode: e.mode, since: e.since, party: e.members.map((m) => m.name) };
  }

  private pushMm(userId: string): void {
    this.ctx.social.emitTo(userId, EV.mmStatus, this.mmStatus(userId));
  }

  searcher(user: Identity, mode: RankedMode): Searcher | null {
    const p = this.profile(user.id);
    if (!p) return null;
    return { userId: user.id, name: user.name, trophies: mode === 'duel' ? p.duel : p.team, level: levelInfo(p.xp).level, icon: p.icon, arena: currentArena(p) };
  }

  private nameOf(id: string): string {
    return this.ctx.db.userById(id)?.username ?? '?';
  }

  partyView(userId: string): PartyView | null {
    const pid = this.userParty.get(userId);
    const party = pid ? this.parties.get(pid) : null;
    if (!party) return null;
    return {
      id: party.id,
      leaderId: party.leaderId,
      members: party.members.map((id) => {
        const p = this.profile(id);
        return { id, name: this.nameOf(id), icon: p?.icon ?? 'shield', level: p ? levelInfo(p.xp).level : 1 };
      }),
    };
  }

  private pushParty(party: Party | null, extra: string[] = []): void {
    const ids = new Set([...(party?.members ?? []), ...extra]);
    for (const id of ids) this.ctx.social.emitTo(id, EV.partyState, this.partyView(id));
  }

  private leaveParty(userId: string): void {
    const pid = this.userParty.get(userId);
    if (!pid) return;
    const party = this.parties.get(pid);
    this.userParty.delete(userId);
    if (!party) return;
    this.mm.cancel(userId);
    party.members = party.members.filter((m) => m !== userId);
    if (party.members.length < 2) {
      for (const m of party.members) this.userParty.delete(m);
      this.parties.delete(pid);
      this.pushParty(null, [...party.members, userId]);
    } else {
      party.leaderId = party.members[0];
      this.pushParty(party, [userId]);
    }
  }

  queue(user: Identity, mode: unknown): Result {
    if (user.guest) return fail('Create an account to play ranked');
    if (mode !== 'duel' && mode !== 'team') return fail('Unknown ranked mode');
    const room = this.ctx.rooms.roomOf(user.id);
    if (room && room.state === 'playing') return fail('Finish your current game first');
    const pid = this.userParty.get(user.id);
    const party = pid ? this.parties.get(pid) : null;
    if (party && mode === 'duel') return fail('Leave your party to play Ranked Duel');
    let ids = [user.id];
    if (party) {
      if (party.leaderId !== user.id) return fail('Only the party leader can start the search');
      ids = party.members.slice();
    }
    const members: Searcher[] = [];
    for (const id of ids) {
      const s = this.searcher({ id, name: this.nameOf(id), guest: false }, mode);
      if (!s) return fail('Party member has no account');
      const r = this.ctx.rooms.roomOf(id);
      if (r && r.state === 'playing') return fail(`${s.name} is still in a game`);
      members.push(s);
    }
    this.mm.enqueue(mode, members);
    return { ok: true };
  }

  /** Lobby button: queue ranked 2v2 together with the other player in the room. */
  queueFromRoom(user: Identity): Result {
    const room = this.ctx.rooms.roomOf(user.id);
    if (!room) return fail('Not in a room');
    if (room.hostId !== user.id) return fail('Only the host can queue');
    if (room.state !== 'waiting') return fail('Game in progress');
    const humans = room.members.filter((m) => !m.bot);
    if (humans.length !== 2) return fail('Ranked 2v2 together needs exactly 2 players in the room');
    if (humans.some((m) => m.guest)) return fail('Guests cannot play ranked');
    const members: Searcher[] = [];
    for (const m of humans) {
      const s = this.searcher({ id: m.id, name: m.name, guest: false }, 'team');
      if (!s) return fail('Both players need accounts');
      members.push(s);
    }
    this.mm.enqueue('team', members);
    return { ok: true };
  }

  partyInvite(user: Identity, toId: unknown): Result {
    if (user.guest) return fail('Create an account to make a party');
    if (typeof toId !== 'string' || !this.ctx.db.areFriends(user.id, toId)) return fail('You can only invite friends');
    if (!this.ctx.social.isOnline(toId)) return fail('That friend is offline');
    if (this.userParty.has(toId)) return fail('They are already in a party');
    let pid = this.userParty.get(user.id);
    let party = pid ? this.parties.get(pid) : undefined;
    if (party && party.members.length >= 2) return fail('Your party is full');
    if (!party) {
      pid = crypto.randomBytes(5).toString('hex');
      party = { id: pid, leaderId: user.id, members: [user.id] };
      this.parties.set(pid, party);
      this.userParty.set(user.id, pid);
      this.pushParty(party);
    }
    const inviteKey = `${party.id}:${toId}`;
    const expiresAt = Date.now() + 60_000;
    this.partyInvites.set(inviteKey, { partyId: party.id, to: toId, expiresAt });
    this.ctx.social.emitTo(toId, EV.partyInvited, { partyId: party.id, fromId: user.id, fromName: user.name, expiresAt });
    return { ok: true };
  }

  partyRespond(user: Identity, partyId: unknown, accept: unknown): Result {
    if (typeof partyId !== 'string') return fail('Bad request');
    const key = `${partyId}:${user.id}`;
    const inv = this.partyInvites.get(key);
    this.partyInvites.delete(key);
    if (!inv || inv.expiresAt < Date.now()) return fail('Party invite expired');
    const party = this.parties.get(partyId);
    if (!party) return fail('That party no longer exists');
    if (!accept) {
      this.ctx.social.toast(party.leaderId, { kind: 'info', text: `${user.name} declined your party invite` });
      return { ok: true };
    }
    if (party.members.length >= 2) return fail('That party is full');
    this.leaveParty(user.id);
    this.mm.cancel(party.leaderId);
    party.members.push(user.id);
    this.userParty.set(user.id, party.id);
    this.pushParty(party);
    this.ctx.social.toast(party.leaderId, { kind: 'success', text: `${user.name} joined your party` });
    return { ok: true };
  }

  onUserOffline(userId: string): void {
    this.mm.cancel(userId);
    this.leaveParty(userId);
  }

  // ── emotes ───────────────────────────────────────────────────────────────
  emote(user: Identity, emoteId: unknown): Result {
    if (typeof emoteId !== 'string' || !EMOTES.some((e) => e.id === emoteId)) return fail('Unknown emote');
    const room = this.ctx.rooms.roomOf(user.id);
    if (!room?.match || room.match.over) return fail('Emotes work in matches');
    const owned = user.guest ? STARTER_EMOTES : (this.profile(user.id)?.emotes ?? STARTER_EMOTES);
    if (!owned.includes(emoteId)) return fail("You don't own that emote");
    const now = Date.now();
    const last = this.emoteAt.get(user.id) ?? 0;
    if (now - last < EMOTE_COOLDOWN_SEC * 1000) return fail('Emote on cooldown');
    this.emoteAt.set(user.id, now);
    this.ctx.io.to(roomChannel(room.id)).emit(EV.matchEmote, { playerId: user.id, emoteId });
    return { ok: true };
  }

  /** Persist a portrait (accounts) and show it to everyone in the current match. */
  setFace(user: Identity, icon: unknown): Result {
    if (typeof icon !== 'string' || !ICONS.some((i) => i.id === icon)) return fail('Unknown icon');
    const room = this.ctx.rooms.roomOf(user.id);
    if (!room?.match || room.match.over) return fail('You can change your face during a match');
    if (user.guest) {
      if (!STARTER_ICONS.includes(icon)) return fail("You don't own that icon");
    } else {
      const saved = this.mutate(user.id, (pr) => {
        if (!pr.icons.includes(icon)) return fail("You don't own that icon");
        pr.icon = icon;
        return { ok: true };
      });
      if (!saved.ok) return saved;
    }
    const mine = room.match.info.players.find((p) => p.id === user.id);
    if (mine) mine.icon = icon;
    this.ctx.io.to(roomChannel(room.id)).emit(EV.matchFace, { playerId: user.id, icon });
    return { ok: true };
  }

  // ── leaderboards ─────────────────────────────────────────────────────────
  leaderboard(user: Identity, q: Partial<LeaderboardQuery>): Result<LeaderboardView> {
    const board = q?.board;
    if (board !== 'duel' && board !== 'team' && board !== 'endless') return fail('Unknown leaderboard');
    const period = q.period === 'all' ? 'all' : 'season';
    const scope = q.scope === 'friends' ? new Set([user.id, ...this.ctx.db.friendsOf(user.id)]) : null;
    const meta = getMeta(this.ctx.db, this.clock);
    const users = Object.values(this.ctx.db.data.users);
    if (board === 'endless') {
      const mapId: MapId = q.mapId && q.mapId in MAPS ? q.mapId : 'greenfield';
      const lb = endlessLeaderboard(meta.endless, mapId, period, meta.season.id, scope, user.id, (id) => {
        const u = this.ctx.db.userById(id);
        if (!u) return null;
        const p = this.profile(id)!;
        return { icon: p.icon, level: levelInfo(p.xp).level, arena: currentArena(p) };
      });
      return { ok: true, ...lb, lastTop3: meta.lastTop3 };
    }
    return { ok: true, ...trophyLeaderboard(users, board, period, scope, user.id), lastTop3: meta.lastTop3 };
  }

  // ── room hooks ───────────────────────────────────────────────────────────
  private installRoomHooks(): void {
    const rooms = this.ctx.rooms;
    rooms.hooks = {
      memberInfo: (room: Room, m: RoomMember) => {
        const bot = this.mm.bots.get(m.id);
        if (bot) return { loadout: bot.loadout, level: bot.level, icon: bot.icon };
        if (room.sandbox) {
          const p = m.guest ? null : this.profile(m.id);
          return { loadout: TOWER_TYPES.slice(), level: p ? levelInfo(p.xp).level : 1, icon: p?.icon ?? 'shield' };
        }
        if (m.guest) return { loadout: CLASSIC_TOWERS.slice(), level: 1, icon: 'shield' };
        const p = this.profile(m.id);
        return p ? { loadout: p.loadout.slice(), level: levelInfo(p.xp).level, icon: p.icon } : { loadout: CLASSIC_TOWERS.slice(), level: 1, icon: 'shield' };
      },
      seatFor: (room: Room, m: RoomMember) => {
        if (m.bot) return {};
        if (room.sandbox) {
          const p = m.guest ? null : this.profile(m.id);
          const levels: Partial<Record<TowerType, number>> = {};
          for (const t of TOWER_TYPES) levels[t] = room.equalLevels ? EQUAL_LEVEL : (p?.cards[t]?.level ?? 1);
          return {
            loadout: TOWER_TYPES.slice(),
            troops: PACK_IDS.slice(),
            cardLevels: levels,
            icon: p?.icon ?? 'shield',
            level: p ? levelInfo(p.xp).level : 1,
            emotes: p?.emotes.slice() ?? STARTER_EMOTES.slice(),
          };
        }
        if (m.guest) {
          const levels: Partial<Record<TowerType, number>> = {};
          for (const t of CLASSIC_TOWERS) levels[t] = room.equalLevels ? EQUAL_LEVEL : 1;
          return { loadout: CLASSIC_TOWERS.slice(), troops: CLASSIC_PACKS.slice(), cardLevels: levels, icon: 'shield', level: 1, emotes: STARTER_EMOTES.slice() };
        }
        const p = this.profile(m.id);
        if (!p) return {};
        return {
          loadout: p.loadout.slice(),
          troops: (p.army.length ? p.army : p.troops.slice(0, 5)).slice(),
          cardLevels: seatCardLevels(p, room.equalLevels && !room.ranked ? EQUAL_LEVEL : null),
          icon: p.icon,
          level: levelInfo(p.xp).level,
          emotes: p.emotes.slice(),
        };
      },
      validateSettings: (user, s) => {
        if (s.sandbox) return null;
        if (user.guest) return null;
        const p = this.profile(user.id);
        if (!p || s.mode !== 'coop') return null;
        if (s.endless) return endlessUnlocked(p) ? null : 'Endless co-op unlocks after earning 2★ on any campaign map';
        if (!mapUnlocked(p, s.mapId)) {
          const prev = CAMPAIGN_ORDER[CAMPAIGN_ORDER.indexOf(s.mapId) - 1];
          return `Earn 2★ on ${MAPS[prev].name} to unlock ${MAPS[s.mapId].name}`;
        }
        return null;
      },
      onLeave: (room, userId) => {
        if (room.ranked && room.match && !room.match.over) this.forfeits.add(`${room.match.id}:${userId}`);
      },
      afterMatch: (room, results, match) => this.afterMatch(room, results, match),
    };
  }

  private afterMatch(room: Room, results: MatchResults, match: Match): void {
    if (room.sandbox) return;
    const humans = results.players.filter((p) => !p.guest && !p.bot);
    // opponent averages use trophies from BEFORE this match
    const ladder = room.ranked;
    const before = new Map<string, number>();
    for (const pl of results.players) {
      if (!ladder) break;
      const t = pl.bot ? (this.mm.botTrophies(pl.id) ?? 0) : pl.guest ? 0 : ((this.profile(pl.id)?.[ladder]) ?? 0);
      before.set(pl.id, t);
    }
    for (const pl of humans) {
      const p = this.profile(pl.id);
      if (!p) continue;
      const forfeited = this.forfeits.has(`${match.id}:${pl.id}`);
      const won = results.winners.includes(pl.id) && !forfeited;
      const opps = results.players.filter((o) => o.boardId !== pl.boardId);
      const rewards = applyMatchResult(
        p,
        {
          mode: results.mode,
          mapId: results.mapId,
          difficulty: results.difficulty,
          endless: results.endless,
          ranked: ladder,
          vsBot: results.vsBot,
          won,
          coopVictory: results.mode === 'coop' && results.outcome === 'victory',
          wavesSurvived: results.wavesSurvived,
          stats: pl.stats,
          oppAvg: ladder ? average(opps.map((o) => before.get(o.id) ?? 0)) : undefined,
        },
        this.clock,
      );
      const payload: MatchRewards = { matchId: results.matchId, ...rewards };
      this.ctx.social.emitTo(pl.id, EV.progMatchRewards, payload);
    }
    if (results.mode === 'coop' && results.endless) {
      const meta = getMeta(this.ctx.db, this.clock);
      const players = results.players.filter((p) => !p.bot).map((p) => ({ id: p.id, name: p.name }));
      if (players.some((p) => !p.id.startsWith('g_'))) {
        recordEndless(meta.endless, { mapId: results.mapId, players, wave: results.wavesSurvived, season: meta.season.id, at: this.clock.now() });
      }
    }
    for (const pl of results.players) this.forfeits.delete(`${match.id}:${pl.id}`);
    this.save();
    for (const pl of humans) this.push(pl.id);
    if (room.ranked) this.mm.releaseRoom(room.id);
  }

  // ── sockets ──────────────────────────────────────────────────────────────
  private attach(sock: Sock): void {
    const user = sock.data.user;
    const reply = <T extends object>(ack: unknown, r: Result<T>) => {
      if (typeof ack === 'function') (ack as (x: Result<T>) => void)(r);
      else if (!r.ok) sock.emit(EV.toast, { kind: 'error', text: r.error });
    };
    const on = <P>(ev: string, fn: (p: P) => Result<object>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sock as any).on(ev, (...args: unknown[]) => {
        const ack = args[args.length - 1];
        const payload = (typeof args[0] === 'function' ? {} : (args[0] ?? {})) as P;
        try {
          reply(ack, fn(payload));
        } catch (err) {
          console.error('[progression]', err);
          reply(ack, fail('Server error'));
        }
      });
    };
    const uid = user.id;

    on(EV.progGet, () => {
      const p = this.profile(uid);
      return p ? { ok: true, profile: this.view(uid, p) } : fail('Guests have no progression');
    });
    on<{ nodeId: number }>(EV.progClaimRoad, (p) => this.mutate(uid, (pr) => claimRoad(pr, p.nodeId)));
    on<{ dropId: string }>(EV.progOpenDrop, (p) => this.mutate(uid, (pr) => openDrop(pr, uid, p.dropId)));
    on<{ chestId: string }>(EV.progOpenChest, (p) => this.mutate(uid, (pr) => openChest(pr, uid, p.chestId)));
    on<{ tower: string }>(EV.progUpgradeCard, (p) => this.mutate(uid, (pr) => upgradeCard(pr, p.tower)));
    on<{ towers: unknown; troops: unknown }>(EV.progSetLoadout, (p) => this.mutate(uid, (pr) => setLoadout(pr, p.towers, p.troops)));
    on<{ icon: string }>(EV.progSetIcon, (p) =>
      this.mutate(uid, (pr) => {
        if (!pr.icons.includes(p.icon)) return fail("You don't own that icon");
        pr.icon = p.icon;
        return { ok: true };
      }),
    );
    on<{ questId: string }>(EV.progClaimQuest, (p) => this.mutate(uid, (pr) => claimQuest(pr, p.questId)));
    on<{ questId: string }>(EV.progRerollQuest, (p) => this.mutate(uid, (pr) => rerollQuest(pr, uid, p.questId)));
    on<{ tier: number; track: string }>(EV.progClaimPass, (p) => this.mutate(uid, (pr) => claimPass(pr, p.tier, p.track)));
    on(EV.progBuyPremium, () => this.mutate(uid, (pr) => buyPremiumPass(pr)));
    on<{ offerId: string }>(EV.progShopBuy, (p) => this.mutate(uid, (pr) => buyOffer(pr, p.offerId)));
    on(EV.progClaimGift, () => this.mutate(uid, (pr) => claimGift(pr)));
    on<{ bundleId: string }>(EV.progBuyBundle, (p) => this.mutate(uid, (pr) => buyBundle(pr, p.bundleId)));
    on(EV.progAckSeason, () =>
      this.mutate(uid, (pr) => {
        pr.seasonNotice = null;
        return { ok: true };
      }),
    );
    on<Partial<LeaderboardQuery>>(EV.progLeaderboard, (q) => this.leaderboard(user, q));
    on<{ mode: string }>(EV.mmQueue, (p) => this.queue(user, p.mode));
    on(EV.mmCancel, () => {
      this.mm.cancel(uid);
      return { ok: true };
    });
    on(EV.roomQueueRanked, () => this.queueFromRoom(user));
    on<{ userId: string }>(EV.partyInvite, (p) => this.partyInvite(user, p.userId));
    on<{ partyId: string; accept: boolean }>(EV.partyRespond, (p) => this.partyRespond(user, p.partyId, p.accept));
    on(EV.partyLeave, () => {
      this.leaveParty(uid);
      return { ok: true };
    });
    on<{ emoteId: string }>(EV.emote, (p) => this.emote(user, p.emoteId));
    on<{ icon: string }>(EV.setFace, (p) => this.setFace(user, p.icon));

    // initial state for this tab
    if (!user.guest) {
      const p = this.profile(uid);
      if (p) {
        this.save();
        sock.emit(EV.progState, this.view(uid, p));
      }
      sock.emit(EV.mmStatus, this.mmStatus(uid));
      sock.emit(EV.partyState, this.partyView(uid));
    }
  }

  // ── DEV_TOOLS REST endpoints ─────────────────────────────────────────────
  private registerRoutes(app: express.Express): void {
    const dev =
      (fn: (user: Identity, p: Profile, body: Record<string, unknown>) => unknown) =>
      (req: express.Request, res: express.Response) => {
        if (!this.devTools) return res.status(403).json({ ok: false, error: 'Dev tools are disabled (start with DEV_TOOLS=1)' });
        const h = req.headers.authorization;
        const user = this.ctx.auth.resolve(h?.startsWith('Bearer ') ? h.slice(7) : null);
        if (!user || user.guest) return res.status(401).json({ ok: false, error: 'Log in with an account' });
        const p = this.profile(user.id);
        if (!p) return res.status(404).json({ ok: false, error: 'No profile' });
        try {
          const out = fn(user, p, (req.body ?? {}) as Record<string, unknown>);
          this.save();
          this.push(user.id);
          this.ctx.rooms.refreshUser(user.id);
          res.json({ ok: true, ...(typeof out === 'object' && out ? out : {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: (err as Error).message });
        }
      };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    app.post(
      '/api/dev/grant',
      dev((_u, p, b) => {
        p.coins += num(b.coins);
        p.gems += num(b.gems);
        p.pass.tokens += num(b.tokens);
        const levelUps = num(b.xp) ? grantXp(p, num(b.xp)) : [];
        if (b.cards === 'all') for (const t of TOWER_TYPES) grantCards(p, t, num(b.copies) || 50);
        else if (typeof b.tower === 'string' && (TOWER_TYPES as readonly string[]).includes(b.tower)) grantCards(p, b.tower as TowerType, num(b.copies) || 10);
        if (b.drop) p.drops.pending.push({ id: `dev${Date.now().toString(36)}${p.seq++}`, source: 'Dev', at: this.clock.now() });
        if (typeof b.chest === 'string' && ['silver', 'gold', 'magic', 'legendary'].includes(b.chest))
          p.chests.push({ id: `devc${Date.now().toString(36)}${p.seq++}`, tier: b.chest as 'silver', source: 'Dev', at: this.clock.now() });
        return { levelUps };
      }),
    );
    app.post(
      '/api/dev/trophies',
      dev((_u, p, b) => {
        if (typeof b.duel === 'number') {
          p.duel = Math.max(0, Math.round(b.duel));
          p.duelBest = Math.max(p.duelBest, p.duel);
        }
        if (typeof b.team === 'number') {
          p.team = Math.max(0, Math.round(b.team));
          p.teamBest = Math.max(p.teamBest, p.team);
        }
        p.arenaReached = Math.max(p.arenaReached, currentArena(p));
        p.seasonPeakArena = Math.max(p.seasonPeakArena, currentArena(p));
      }),
    );
    app.post(
      '/api/dev/reset-daily',
      dev((u, p) => {
        p.quests.day = '';
        p.quests.week = '';
        p.drops.day = '';
        p.shop.day = '';
        ensureDaily(p, u.id, this.clock);
      }),
    );
    app.post(
      '/api/dev/end-season',
      dev(() => {
        const r = endSeason(this.ctx.db, this.clock);
        setTimeout(() => this.pushAll(), 0);
        return r;
      }),
    );
    app.post(
      '/api/dev/unlock-all',
      dev((_u, p) => {
        for (const t of TOWER_TYPES) if (!p.cards[t]) p.cards[t] = { level: 1, copies: 0 };
        for (const t of PACK_IDS) if (!p.troops.includes(t)) p.troops.push(t);
        for (const i of ICONS) if (!p.icons.includes(i.id)) p.icons.push(i.id);
        for (const e of EMOTES) if (!p.emotes.includes(e.id)) p.emotes.push(e.id);
        for (const m of CAMPAIGN_ORDER) p.campaign[m] = 3;
      }),
    );
    app.post(
      '/api/dev/reset-progression',
      dev((u) => {
        const fresh = newProfile(getMeta(this.ctx.db, this.clock).season.id);
        ensureDaily(fresh, u.id, this.clock);
        this.ctx.db.userById(u.id)!.progression = fresh as unknown as Record<string, unknown>;
      }),
    );
    app.post(
      '/api/dev/bot-match',
      dev((u, p, b) => {
        const mode: RankedMode = b.mode === 'team' ? 'team' : 'duel';
        const room = this.ctx.rooms.roomOf(u.id);
        if (room?.state === 'playing') throw new Error('Finish your current game first');
        this.mm.cancel(u.id);
        const me = this.searcher(u, mode)!;
        const trophies = mode === 'duel' ? p.duel : p.team;
        const human = { kind: 'human' as const, s: me };
        const bot = () => ({ kind: 'bot' as const, b: this.mm.makeBot(trophies) });
        if (mode === 'duel') this.mm.launch('duel', [human], [bot()]);
        else this.mm.launch('team', [human, bot()], [bot(), bot()]);
      }),
    );
    app.post(
      '/api/dev/fast-forward',
      dev((u, _p, b) => {
        const room = this.ctx.rooms.roomOf(u.id);
        if (!room?.match || room.match.over) throw new Error('No game in progress');
        room.match.fastForward(Math.min(3600, Math.max(1, num(b.seconds) || 60)));
      }),
    );
  }
}

