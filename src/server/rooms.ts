// Lobbies: create/join by code, settings, ready/teams/kick, chat, host migration,
// reconnect grace, public browser, and starting matches. Ranked matches also run in
// (private, single-use) rooms created by the matchmaker.
import crypto from 'node:crypto';
import { DIFFICULTY, MAX_PLAYERS, MODE_INFO, NET, TIMING } from '../shared/config';
import { isMapId } from '../shared/maps';
import type { RankedMode } from '../shared/progProtocol';
import {
  EV,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ChatMsg,
  type MatchResults,
  type PublicRoomInfo,
  type RoomSettingsPatch,
  type RoomState,
} from '../shared/protocol';
import { CLASSIC_TOWERS, type Difficulty, type GameMode, type MapId, type TowerType } from '../shared/types';
import type { Identity } from './auth';
import type { JsonDb } from './db';
import { BROWSE_CHANNEL, fail, roomChannel, TokenBucket, userChannel, type IO, type Result, type Sock } from './io';
import { Match, type MatchSeat } from './match';
import { makeRuleset, type Ruleset } from './sim/game';
import type { RoomsBridge, Social } from './social';

export interface RoomMember {
  id: string;
  name: string;
  guest: boolean;
  bot: boolean;
  color: number;
  team: number;
  ready: boolean;
  connected: boolean;
  graceTimer: NodeJS.Timeout | null;
}

export interface Room {
  id: string;
  code: string;
  hostId: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  isPublic: boolean;
  equalLevels: boolean;
  endless: boolean;
  ranked: RankedMode | null;
  state: 'waiting' | 'playing';
  members: RoomMember[];
  chat: ChatMsg[];
  chatSeq: number;
  match: Match | null;
  lastResults: MatchResults | null;
}

export interface RoomManagerOptions {
  /** merged into every match's ruleset (tests use short timers) */
  ruleOverrides?: Partial<Ruleset>;
  graceMatchSec?: number;
  graceLobbySec?: number;
}

export interface MemberInfo {
  loadout: TowerType[];
  level: number;
  icon: string;
}

/** Extension points for the progression layer. */
export interface RoomHooks {
  /** customise a seat before the match starts (loadouts, card levels...) */
  seatFor?(room: Room, member: RoomMember): Partial<MatchSeat>;
  /** called after stats were persisted */
  afterMatch?(room: Room, results: MatchResults, match: Match): void;
  /** lobby display info for a member */
  memberInfo?(member: RoomMember): MemberInfo;
  /** validate room settings for the host (campaign map locks, endless unlock...) */
  validateSettings?(user: Identity, s: { mode: GameMode; mapId: MapId; endless: boolean }): string | null;
  /** a member is leaving (forfeits in ranked) */
  onLeave?(room: Room, userId: string): void;
}

const isMode = (m: unknown): m is GameMode => typeof m === 'string' && m in MODE_INFO;
const isDifficulty = (d: unknown): d is Difficulty => typeof d === 'string' && d in DIFFICULTY;

/** "Equal levels" defaults: ON for versus, OFF for co-op. */
export const defaultEqualLevels = (mode: GameMode) => mode !== 'coop';

export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NET.chatMaxLength);
  return t.length ? t : null;
}

export class RoomManager implements RoomsBridge {
  readonly rooms = new Map<string, Room>();
  private byCode = new Map<string, Room>();
  private userRoom = new Map<string, string>();
  private chatLimits = new Map<string, TokenBucket>();
  private browseTimer: NodeJS.Timeout | null = null;
  hooks: RoomHooks = {};

  constructor(
    private readonly io: IO,
    private readonly social: Social,
    private readonly db: JsonDb,
    private readonly opts: RoomManagerOptions = {},
  ) {}

  // ── RoomsBridge ───────────────────────────────────────────────────────────
  statusOf(userId: string): 'lobby' | 'game' | null {
    const room = this.roomOf(userId);
    if (!room) return null;
    return room.state === 'playing' ? 'game' : 'lobby';
  }

  roomSummaryOf(userId: string) {
    const room = this.roomOf(userId);
    if (!room) return null;
    return {
      id: room.id,
      code: room.code,
      mode: room.mode,
      mapId: room.mapId,
      difficulty: room.difficulty,
      joinable: room.state === 'waiting' && !room.ranked && room.members.length < MAX_PLAYERS,
      members: room.members.map((m) => m.id),
    };
  }

  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  roomOf(userId: string): Room | null {
    const id = this.userRoom.get(userId);
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  roomByCode(code: string): Room | null {
    return this.byCode.get(code) ?? null;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
      if (!this.byCode.has(c)) return c;
    }
  }

  toState(room: Room): RoomState {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      mode: room.mode,
      mapId: room.mapId,
      difficulty: room.difficulty,
      isPublic: room.isPublic,
      state: room.state,
      players: room.members.map((m) => {
        const info = this.hooks.memberInfo?.(m) ?? { loadout: CLASSIC_TOWERS.slice(), level: 1, icon: 'shield' };
        return {
          id: m.id,
          name: m.name,
          guest: m.guest,
          color: m.color,
          team: m.team,
          ready: m.ready,
          connected: m.connected,
          bot: m.bot,
          loadout: info.loadout,
          level: info.level,
          icon: info.icon,
        };
      }),
      chat: room.chat.slice(-50),
      maxPlayers: MAX_PLAYERS,
      lastResults: room.lastResults,
      equalLevels: room.equalLevels,
      endless: room.endless,
      ranked: room.ranked,
    };
  }

  broadcast(room: Room): void {
    this.io.to(roomChannel(room.id)).emit(EV.roomState, this.toState(room));
    this.scheduleBrowse();
  }

  /** Re-broadcast every room this user is in (their loadout changed). */
  refreshUser(userId: string): void {
    const room = this.roomOf(userId);
    if (room && room.state === 'waiting') this.broadcast(room);
  }

  publicList(): PublicRoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && !r.ranked && r.state === 'waiting')
      .map((r) => ({
        code: r.code,
        mode: r.mode,
        mapId: r.mapId,
        difficulty: r.difficulty,
        players: r.members.length,
        maxPlayers: MAX_PLAYERS,
        hostName: r.members.find((m) => m.id === r.hostId)?.name ?? '?',
      }));
  }

  private scheduleBrowse(): void {
    if (this.browseTimer) return;
    this.browseTimer = setTimeout(() => {
      this.browseTimer = null;
      this.io.to(BROWSE_CHANNEL).emit(EV.browseList, this.publicList());
    }, 50);
  }

  private system(room: Room, text: string): void {
    const msg: ChatMsg = { id: ++room.chatSeq, fromId: null, name: 'System', color: -1, text, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
    this.io.to(roomChannel(room.id)).emit(EV.chatMsg, msg);
  }

  private freeColor(room: Room): number {
    for (let c = 0; c < MAX_PLAYERS; c++) if (!room.members.some((m) => m.color === c)) return c;
    return 0;
  }

  private smallerTeam(room: Room): number {
    const t0 = room.members.filter((m) => m.team === 0).length;
    const t1 = room.members.filter((m) => m.team === 1).length;
    return t1 < t0 ? 1 : 0;
  }

  private attachUser(userId: string, room: Room): void {
    this.userRoom.set(userId, room.id);
    this.io.in(userChannel(userId)).socketsJoin(roomChannel(room.id));
  }

  private detachUser(userId: string, room: Room): void {
    if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
    this.io.in(userChannel(userId)).socketsLeave(roomChannel(room.id));
  }

  private newMember(user: { id: string; name: string; guest: boolean }, color: number, team: number, bot = false): RoomMember {
    return { id: user.id, name: user.name, guest: user.guest, bot, color, team, ready: bot, connected: true, graceTimer: null };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  create(
    user: Identity,
    p: { mode?: unknown; mapId?: unknown; difficulty?: unknown; isPublic?: unknown; endless?: unknown; equalLevels?: unknown },
  ): Result<{ room: RoomState }> {
    if (!p || !isMode(p.mode) || !isMapId(p.mapId) || !isDifficulty(p.difficulty)) return fail('Invalid room settings');
    const endless = p.mode === 'coop' && p.endless === true;
    const err = this.hooks.validateSettings?.(user, { mode: p.mode, mapId: p.mapId, endless });
    if (err) return fail(err);
    const cur = this.roomOf(user.id);
    if (cur) this.leave(user.id);
    const room: Room = {
      id: crypto.randomBytes(6).toString('hex'),
      code: this.newCode(),
      hostId: user.id,
      mode: p.mode,
      mapId: p.mapId,
      difficulty: p.difficulty,
      isPublic: p.isPublic === true,
      equalLevels: typeof p.equalLevels === 'boolean' ? p.equalLevels : defaultEqualLevels(p.mode),
      endless,
      ranked: null,
      state: 'waiting',
      members: [],
      chat: [],
      chatSeq: 0,
      match: null,
      lastResults: null,
    };
    room.members.push(this.newMember(user, 0, 0));
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room);
    this.attachUser(user.id, room);
    this.system(room, `${user.name} created the room`);
    this.broadcast(room);
    this.social.notifyPresence(user.id);
    return { ok: true, room: this.toState(room) };
  }

  /**
   * Ranked: a private single-use room with the given humans + bots. Humans leave any
   * room they are in (e.g. the lobby they queued from).
   */
  createRankedRoom(
    ranked: RankedMode,
    mapId: MapId,
    seats: { user: { id: string; name: string; guest: boolean }; team: number; bot: boolean }[],
  ): Room {
    for (const s of seats) if (!s.bot && this.roomOf(s.user.id)) this.leave(s.user.id, 'moved');
    const room: Room = {
      id: crypto.randomBytes(6).toString('hex'),
      code: this.newCode(),
      hostId: seats.find((s) => !s.bot)!.user.id,
      mode: ranked === 'duel' ? 'ffa' : 'teams',
      mapId,
      difficulty: 'normal',
      isPublic: false,
      equalLevels: false,
      endless: false,
      ranked,
      state: 'waiting',
      members: seats.map((s, i) => this.newMember(s.user, i, s.team, s.bot)),
      chat: [],
      chatSeq: 0,
      match: null,
      lastResults: null,
    };
    this.rooms.set(room.id, room);
    this.byCode.set(room.code, room);
    for (const s of seats) if (!s.bot) this.attachUser(s.user.id, room);
    this.broadcast(room);
    for (const s of seats) if (!s.bot) this.social.notifyPresence(s.user.id);
    return room;
  }

  join(user: Identity, rawCode: unknown): Result<{ room: RoomState }> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return fail('Invalid room code');
    const room = this.byCode.get(code);
    if (!room) return fail('Room not found — it may have closed');
    const existing = room.members.find((m) => m.id === user.id);
    if (existing) {
      this.attachUser(user.id, room);
      this.markOnline(room, existing);
      return { ok: true, room: this.toState(room) };
    }
    if (room.ranked) return fail("That's a ranked match — it can't be joined");
    if (room.state === 'playing') return fail('That game has already started');
    if (room.members.length >= MAX_PLAYERS) return fail('Room is full');
    const cur = this.roomOf(user.id);
    if (cur) this.leave(user.id);
    const team = room.mode === 'teams' ? this.smallerTeam(room) : 0;
    room.members.push(this.newMember(user, this.freeColor(room), team));
    this.attachUser(user.id, room);
    this.system(room, `${user.name} joined`);
    this.broadcast(room);
    this.social.notifyPresence(user.id);
    return { ok: true, room: this.toState(room) };
  }

  leave(userId: string, reason: 'left' | 'kicked' | 'timeout' | 'moved' = 'left'): Result {
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    const idx = room.members.findIndex((m) => m.id === userId);
    if (idx < 0) {
      this.userRoom.delete(userId);
      return fail('Not in a room');
    }
    this.hooks.onLeave?.(room, userId);
    const [m] = room.members.splice(idx, 1);
    if (m.graceTimer) clearTimeout(m.graceTimer);
    this.detachUser(userId, room);
    if (room.match && !room.match.over) room.match.markLeft(userId);
    if (reason === 'kicked') this.social.emitTo(userId, EV.roomClosed, { reason: 'You were kicked from the room' });
    else if (reason === 'timeout') this.social.emitTo(userId, EV.roomClosed, { reason: 'You were disconnected for too long' });
    if (!this.rooms.has(room.id)) {
      // the room may already have been closed by the match ending (ranked)
      this.social.notifyPresence(userId);
      return { ok: true };
    }

    if (room.members.filter((x) => !x.bot).length === 0) {
      // last human left a ranked match that bots would keep playing: settle it now so the
      // forfeit (a loss) is recorded, then the room closes via onMatchEnd
      if (room.ranked && room.match && !room.match.over) room.match.concludeNow();
      if (this.rooms.has(room.id)) this.deleteRoom(room);
    } else {
      if (room.hostId === userId) {
        const next = room.members.find((x) => !x.bot) ?? room.members[0];
        room.hostId = next.id;
        this.system(room, `${m.name} left — ${next.name} is now the host`);
      } else {
        this.system(room, reason === 'kicked' ? `${m.name} was kicked` : reason === 'timeout' ? `${m.name} timed out` : `${m.name} left`);
      }
      this.broadcast(room);
    }
    this.social.notifyPresence(userId);
    return { ok: true };
  }

  private deleteRoom(room: Room): void {
    room.match?.dispose();
    room.match = null;
    for (const m of room.members) {
      if (m.graceTimer) clearTimeout(m.graceTimer);
      if (!m.bot) this.detachUser(m.id, room);
    }
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.social.cancelRoomInvites(room.id);
    this.scheduleBrowse();
  }

  /** Close a room for everyone (ranked rooms after their match). */
  closeRoom(room: Room, reason: string, silent: boolean): void {
    const humans = room.members.filter((m) => !m.bot).map((m) => m.id);
    for (const id of humans) this.social.emitTo(id, EV.roomClosed, { reason, silent });
    this.deleteRoom(room);
    for (const id of humans) this.social.notifyPresence(id);
  }

  settings(user: Identity | string, patch: RoomSettingsPatch): Result {
    const userId = typeof user === 'string' ? user : user.id;
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    if (room.hostId !== userId) return fail('Only the host can change settings');
    if (room.state !== 'waiting') return fail('Game in progress');
    if (room.ranked) return fail('Ranked settings are fixed');
    if (!patch || typeof patch !== 'object') return fail('Bad request');
    const next = { mode: room.mode, mapId: room.mapId, endless: room.endless };
    if (patch.mode !== undefined) {
      if (!isMode(patch.mode)) return fail('Unknown mode');
      next.mode = patch.mode;
    }
    if (patch.mapId !== undefined) {
      if (!isMapId(patch.mapId)) return fail('Unknown map');
      next.mapId = patch.mapId;
    }
    if (patch.endless !== undefined) next.endless = !!patch.endless;
    if (next.mode !== 'coop') next.endless = false;
    if (patch.difficulty !== undefined && !isDifficulty(patch.difficulty)) return fail('Unknown difficulty');
    if (typeof user !== 'string') {
      const err = this.hooks.validateSettings?.(user, next);
      if (err) return fail(err);
    }
    if (next.mode !== room.mode) {
      room.mode = next.mode;
      room.equalLevels = defaultEqualLevels(room.mode);
      if (room.mode === 'teams') room.members.forEach((m, i) => (m.team = i % 2));
    }
    room.mapId = next.mapId;
    room.endless = next.endless;
    if (patch.difficulty !== undefined) room.difficulty = patch.difficulty;
    if (patch.isPublic !== undefined) room.isPublic = !!patch.isPublic;
    if (patch.equalLevels !== undefined) room.equalLevels = !!patch.equalLevels;
    // settings changed → everyone confirms again
    for (const m of room.members) if (m.id !== room.hostId && !m.bot) m.ready = false;
    this.broadcast(room);
    return { ok: true };
  }

  setReady(userId: string, ready: unknown): Result {
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    if (room.state !== 'waiting') return fail('Game in progress');
    const m = room.members.find((x) => x.id === userId)!;
    m.ready = !!ready;
    this.broadcast(room);
    return { ok: true };
  }

  setTeam(userId: string, team: unknown): Result {
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    if (room.state !== 'waiting') return fail('Game in progress');
    if (room.mode !== 'teams') return fail('Teams are only used in 2v2');
    if (team !== 0 && team !== 1) return fail('Bad team');
    const m = room.members.find((x) => x.id === userId)!;
    if (room.members.filter((x) => x.team === team && x.id !== userId).length >= 2) return fail('That team is full');
    m.team = team;
    m.ready = false;
    this.broadcast(room);
    return { ok: true };
  }

  kick(userId: string, targetId: unknown): Result {
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    if (room.hostId !== userId) return fail('Only the host can kick');
    if (typeof targetId !== 'string' || targetId === userId) return fail('Bad request');
    if (!room.members.some((m) => m.id === targetId)) return fail('Player not in room');
    return this.leave(targetId, 'kicked');
  }

  chat(user: Identity, text: unknown): Result {
    const room = this.roomOf(user.id);
    if (!room) return fail('Not in a room');
    let bucket = this.chatLimits.get(user.id);
    if (!bucket) this.chatLimits.set(user.id, (bucket = new TokenBucket(NET.chatBurst, NET.chatPerSecond)));
    if (!bucket.take()) return fail('You are sending messages too fast');
    const t = sanitizeChat(text);
    if (!t) return fail('Empty message');
    const m = room.members.find((x) => x.id === user.id);
    const msg: ChatMsg = { id: ++room.chatSeq, fromId: user.id, name: user.name, color: m?.color ?? 0, text: t, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
    this.io.to(roomChannel(room.id)).emit(EV.chatMsg, msg);
    return { ok: true };
  }

  startError(room: Room): string | null {
    const n = room.members.length;
    const info = MODE_INFO[room.mode];
    if (n < info.minPlayers) return `${info.short} needs at least ${info.minPlayers} players`;
    if (n > info.maxPlayers) return `${info.short} allows at most ${info.maxPlayers} players`;
    if (room.mode === 'teams') {
      const t0 = room.members.filter((m) => m.team === 0).length;
      const t1 = n - t0;
      if (t0 === 0 || t1 === 0) return 'Both teams need at least one player';
    }
    const notReady = room.members.filter((m) => m.id !== room.hostId && !m.bot && (!m.ready || !m.connected));
    if (notReady.length) return `Waiting for ${notReady.map((m) => m.name).join(', ')} to be ready`;
    return null;
  }

  start(userId: string): Result {
    const room = this.roomOf(userId);
    if (!room) return fail('Not in a room');
    if (room.hostId !== userId) return fail('Only the host can start');
    if (room.state !== 'waiting') return fail('Game already running');
    if (room.ranked) return fail('Ranked matches start automatically');
    const err = this.startError(room);
    if (err) return fail(err);
    const overrides: Partial<Ruleset> = { ...this.opts.ruleOverrides };
    if (room.endless) overrides.finalWave = null;
    this.startMatch(room, makeRuleset(room.mode, room.mapId, room.difficulty, overrides));
    return { ok: true };
  }

  /** Start a match in `room` with the given ruleset (also used by the ranked layer). */
  startMatch(room: Room, rules: Ruleset, seatOverrides?: (m: RoomMember) => Partial<MatchSeat>): Match {
    const seats: MatchSeat[] = room.members.map((m) => ({
      id: m.id,
      name: m.name,
      guest: m.guest,
      color: m.color,
      team: m.team,
      bot: m.bot,
      ...(this.hooks.seatFor?.(room, m) ?? {}),
      ...(seatOverrides?.(m) ?? {}),
    }));
    const match = new Match(this.io, roomChannel(room.id), rules, seats, {
      onEnd: (results, mt) => this.onMatchEnd(room, results, mt),
    });
    room.match = match;
    room.state = 'playing';
    room.lastResults = null;
    this.social.cancelRoomInvites(room.id);
    for (const m of room.members) if (!m.connected) match.setConnected(m.id, false);
    this.system(room, room.ranked ? 'Ranked match — good luck!' : 'Game started — good luck!');
    this.broadcast(room);
    for (const m of room.members) if (!m.bot) this.social.notifyPresence(m.id);
    match.start();
    return match;
  }

  private onMatchEnd(room: Room, results: MatchResults, match: Match): void {
    // persist stats for account players
    for (const p of results.players) {
      if (p.guest || p.bot) continue;
      const u = this.db.userById(p.id);
      if (!u) continue;
      u.stats.gamesPlayed++;
      if (results.winners.includes(p.id)) u.stats.wins++;
      if (results.mode === 'coop' && !results.endless) {
        const key = `${results.mapId}:${results.difficulty}`;
        u.stats.bestCoop[key] = Math.max(u.stats.bestCoop[key] ?? 0, results.wavesSurvived);
      }
    }
    this.db.save();
    this.hooks.afterMatch?.(room, results, match);
    for (const p of results.players) {
      if (!p.guest && !p.bot) this.social.emitTo(p.id, EV.hello, { user: { id: p.id, name: p.name, guest: false }, stats: this.db.userById(p.id)?.stats ?? null });
    }
    if (!this.rooms.has(room.id)) return;
    if (room.ranked) {
      // ranked rooms are single-use: everyone goes back home after the results
      room.match = null;
      this.closeRoom(room, 'Ranked match finished', true);
      return;
    }
    room.match = null;
    room.state = 'waiting';
    room.lastResults = results;
    for (const m of room.members) if (!m.bot) m.ready = false;
    this.system(room, results.outcome === 'victory' ? 'Victory!' : results.outcome === 'defeat' ? 'Defeat.' : 'Game over.');
    this.broadcast(room);
    for (const m of room.members) if (!m.bot) this.social.notifyPresence(m.id);
  }

  // ── connection handling ───────────────────────────────────────────────────
  /** A socket connected (first tab or another tab). Put it back where the user is. */
  onSocket(sock: Sock): void {
    const user = sock.data.user;
    const room = this.roomOf(user.id);
    if (!room) return;
    sock.join(roomChannel(room.id));
    const m = room.members.find((x) => x.id === user.id);
    if (m) this.markOnline(room, m);
    sock.emit(EV.roomState, this.toState(room));
    if (room.match && !room.match.over) room.match.sendFull(sock);
  }

  private markOnline(room: Room, m: RoomMember): void {
    if (m.graceTimer) {
      clearTimeout(m.graceTimer);
      m.graceTimer = null;
    }
    if (!m.connected) {
      m.connected = true;
      room.match?.setConnected(m.id, true);
      this.system(room, `${m.name} reconnected`);
      this.broadcast(room);
    }
  }

  /** The user's last socket disconnected: hold their slot for a grace period. */
  onUserOffline(userId: string): void {
    const room = this.roomOf(userId);
    if (!room) return;
    const m = room.members.find((x) => x.id === userId);
    if (!m) return;
    m.connected = false;
    room.match?.setConnected(userId, false);
    const grace = room.state === 'playing' ? (this.opts.graceMatchSec ?? TIMING.reconnectGraceMatch) : (this.opts.graceLobbySec ?? TIMING.reconnectGraceLobby);
    if (m.graceTimer) clearTimeout(m.graceTimer);
    m.graceTimer = setTimeout(() => {
      m.graceTimer = null;
      if (!m.connected && this.roomOf(userId) === room) this.leave(userId, 'timeout');
    }, grace * 1000);
    this.system(room, `${m.name} disconnected — holding their slot for ${grace}s`);
    this.broadcast(room);
  }

  dispose(): void {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
    if (this.browseTimer) clearTimeout(this.browseTimer);
  }
}
