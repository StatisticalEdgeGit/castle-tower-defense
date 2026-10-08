// Friends, presence and in-app invites. Everything is pushed live over sockets.
import crypto from 'node:crypto';
import { TIMING } from '../shared/config';
import { EV, type FriendInfo, type InviteInfo, type PresenceStatus, type SocialState, type ToastMsg } from '../shared/protocol';
import type { Difficulty, GameMode, MapId } from '../shared/types';
import type { Identity } from './auth';
import type { JsonDb } from './db';
import { fail, userChannel, type IO, type Result, type Sock } from './io';

/** What social needs to know about rooms (implemented by RoomManager). */
export interface RoomsBridge {
  statusOf(userId: string): 'lobby' | 'game' | null;
  roomSummaryOf(userId: string): { id: string; code: string; mode: GameMode; mapId: MapId; difficulty: Difficulty; joinable: boolean; members: string[] } | null;
  roomExists(roomId: string): boolean;
}

interface InviteRecord extends InviteInfo {
  toId: string;
  roomId: string;
  timer: NodeJS.Timeout;
}

export class Social {
  private sockets = new Map<string, Set<string>>();
  private names = new Map<string, string>();
  private invites = new Map<string, InviteRecord>();
  rooms: RoomsBridge | null = null;

  constructor(
    private readonly io: IO,
    private readonly db: JsonDb,
  ) {}

  // ── presence ──────────────────────────────────────────────────────────────
  /** Returns true if this is the user's first socket (they just came online). */
  connect(sock: Sock): boolean {
    const u = sock.data.user;
    this.names.set(u.id, u.name);
    let set = this.sockets.get(u.id);
    const first = !set || set.size === 0;
    if (!set) this.sockets.set(u.id, (set = new Set()));
    set.add(sock.id);
    sock.join(userChannel(u.id));
    if (!u.guest) {
      sock.emit(EV.socialState, this.stateFor(u.id));
      // re-deliver pending invites to the new tab
      for (const inv of this.invites.values()) if (inv.toId === u.id) sock.emit(EV.inviteIncoming, this.publicInvite(inv));
    }
    if (first) this.notifyPresence(u.id);
    return first;
  }

  /** Returns true if this was the user's last socket (they went offline). */
  disconnect(sock: Sock): boolean {
    const u = sock.data.user;
    const set = this.sockets.get(u.id);
    if (!set) return false;
    set.delete(sock.id);
    if (set.size > 0) return false;
    this.sockets.delete(u.id);
    this.notifyPresence(u.id);
    return true;
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  status(userId: string): PresenceStatus {
    if (!this.isOnline(userId)) return 'offline';
    return this.rooms?.statusOf(userId) ?? 'online';
  }

  emitTo<E extends keyof import('../shared/protocol').ServerToClientEvents>(
    userId: string,
    ev: E,
    ...args: Parameters<import('../shared/protocol').ServerToClientEvents[E]>
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.io.to(userChannel(userId)) as any).emit(ev, ...args);
  }

  toast(userId: string, t: ToastMsg): void {
    this.emitTo(userId, EV.toast, t);
  }

  private nameOf(userId: string): string {
    return this.db.userById(userId)?.username ?? this.names.get(userId) ?? 'Unknown';
  }

  stateFor(userId: string): SocialState {
    const friends: FriendInfo[] = this.db
      .friendsOf(userId)
      .map((id) => ({ id, name: this.nameOf(id), status: this.status(id) }))
      .sort((a, b) => Number(b.status !== 'offline') - Number(a.status !== 'offline') || a.name.localeCompare(b.name));
    const incoming = this.db.data.requests
      .filter((r) => r.to === userId)
      .map((r) => ({ userId: r.from, name: this.nameOf(r.from), at: r.at }));
    const outgoing = this.db.data.requests
      .filter((r) => r.from === userId)
      .map((r) => ({ userId: r.to, name: this.nameOf(r.to), at: r.at }));
    return { friends, incoming, outgoing };
  }

  pushState(userId: string): void {
    if (this.isOnline(userId)) this.emitTo(userId, EV.socialState, this.stateFor(userId));
  }

  /** Tell every online friend about this user's current status. */
  notifyPresence(userId: string): void {
    if (userId.startsWith('g_')) return;
    const status = this.status(userId);
    for (const f of this.db.friendsOf(userId)) {
      if (this.isOnline(f)) this.emitTo(f, EV.presence, { userId, status });
    }
  }

  // ── friends ───────────────────────────────────────────────────────────────
  request(user: Identity, username: unknown): Result<{ autoAccepted: boolean }> {
    if (user.guest) return fail('Guests cannot add friends — create an account');
    if (typeof username !== 'string' || !username.trim()) return fail('Enter a username');
    const target = this.db.userByName(username.trim());
    if (!target) return fail('No player with that username');
    if (target.id === user.id) return fail("You can't befriend yourself");
    if (this.db.areFriends(user.id, target.id)) return fail(`${target.username} is already your friend`);
    const reqs = this.db.data.requests;
    if (reqs.some((r) => r.from === user.id && r.to === target.id)) return fail('Request already sent');
    const reverse = reqs.findIndex((r) => r.from === target.id && r.to === user.id);
    if (reverse >= 0) {
      // they already asked us → mutual, auto-accept
      reqs.splice(reverse, 1);
      this.db.addFriendship(user.id, target.id);
      this.db.save();
      this.toast(target.id, { kind: 'success', text: `You and ${user.name} are now friends!` });
      this.toast(user.id, { kind: 'success', text: `You and ${target.username} are now friends!` });
      this.pushState(user.id);
      this.pushState(target.id);
      return { ok: true, autoAccepted: true };
    }
    reqs.push({ from: user.id, to: target.id, at: Date.now() });
    this.db.save();
    this.toast(target.id, { kind: 'info', text: `${user.name} sent you a friend request` });
    this.pushState(user.id);
    this.pushState(target.id);
    return { ok: true, autoAccepted: false };
  }

  respond(user: Identity, fromId: unknown, accept: unknown): Result {
    if (typeof fromId !== 'string') return fail('Bad request');
    const reqs = this.db.data.requests;
    const i = reqs.findIndex((r) => r.from === fromId && r.to === user.id);
    if (i < 0) return fail('Request not found');
    reqs.splice(i, 1);
    if (accept) {
      this.db.addFriendship(user.id, fromId);
      this.toast(fromId, { kind: 'success', text: `${user.name} accepted your friend request` });
    }
    this.db.save();
    this.pushState(user.id);
    this.pushState(fromId);
    return { ok: true };
  }

  cancel(user: Identity, toId: unknown): Result {
    const reqs = this.db.data.requests;
    const i = reqs.findIndex((r) => r.from === user.id && r.to === toId);
    if (i < 0) return fail('Request not found');
    reqs.splice(i, 1);
    this.db.save();
    this.pushState(user.id);
    this.pushState(toId as string);
    return { ok: true };
  }

  remove(user: Identity, otherId: unknown): Result {
    if (typeof otherId !== 'string' || !this.db.removeFriendship(user.id, otherId)) return fail('Not friends');
    this.pushState(user.id);
    this.pushState(otherId);
    return { ok: true };
  }

  // ── invites ───────────────────────────────────────────────────────────────
  private publicInvite(i: InviteRecord): InviteInfo {
    return {
      id: i.id,
      fromId: i.fromId,
      fromName: i.fromName,
      roomCode: i.roomCode,
      mode: i.mode,
      mapId: i.mapId,
      difficulty: i.difficulty,
      expiresAt: i.expiresAt,
    };
  }

  sendInvite(user: Identity, toId: unknown): Result {
    if (typeof toId !== 'string') return fail('Bad request');
    const room = this.rooms?.roomSummaryOf(user.id);
    if (!room) return fail('Create or join a room first');
    if (!room.joinable) return fail('Room is full or already playing');
    if (user.guest || !this.db.areFriends(user.id, toId)) return fail('You can only invite friends');
    if (!this.isOnline(toId)) return fail('That friend is offline');
    if (room.members.includes(toId)) return fail('Already in your room');
    // one live invite per (sender, target, room)
    for (const inv of this.invites.values()) {
      if (inv.fromId === user.id && inv.toId === toId && inv.roomId === room.id) this.dropInvite(inv.id);
    }
    const id = crypto.randomBytes(6).toString('hex');
    const expiresAt = Date.now() + TIMING.inviteTtl * 1000;
    const rec: InviteRecord = {
      id,
      fromId: user.id,
      fromName: user.name,
      toId,
      roomId: room.id,
      roomCode: room.code,
      mode: room.mode,
      mapId: room.mapId,
      difficulty: room.difficulty,
      expiresAt,
      timer: setTimeout(() => this.dropInvite(id), TIMING.inviteTtl * 1000),
    };
    this.invites.set(id, rec);
    this.emitTo(toId, EV.inviteIncoming, this.publicInvite(rec));
    return { ok: true };
  }

  /** Validates an invite response. Returns the invite's room code on accept. */
  takeInvite(user: Identity, inviteId: unknown, accept: unknown): Result<{ roomCode?: string }> {
    if (typeof inviteId !== 'string') return fail('Bad request');
    const inv = this.invites.get(inviteId);
    if (!inv || inv.toId !== user.id) return fail('Invite expired');
    this.dropInvite(inviteId);
    if (!this.rooms?.roomExists(inv.roomId)) return fail('That room no longer exists');
    if (!accept) {
      this.toast(inv.fromId, { kind: 'info', text: `${user.name} declined your invite` });
      return { ok: true };
    }
    return { ok: true, roomCode: inv.roomCode };
  }

  private dropInvite(id: string): void {
    const inv = this.invites.get(id);
    if (!inv) return;
    clearTimeout(inv.timer);
    this.invites.delete(id);
    this.emitTo(inv.toId, EV.inviteGone, { id });
  }

  cancelRoomInvites(roomId: string): void {
    for (const inv of [...this.invites.values()]) if (inv.roomId === roomId) this.dropInvite(inv.id);
  }

  dispose(): void {
    for (const inv of this.invites.values()) clearTimeout(inv.timer);
    this.invites.clear();
  }
}
