// Socket.IO event names and payload types shared by server and client.
import type {
  DropOpenResult,
  EmoteEvent,
  FaceEvent,
  Granted,
  LeaderboardQuery,
  LeaderboardView,
  LevelUp,
  MatchRewards,
  MmStatus,
  PartyInvite,
  PartyView,
  ProfileView,
  RankedMode,
  VsInfo,
} from './progProtocol';
import type { ChestTier } from './progression';
import type {
  Difficulty,
  GameMode,
  MapId,
  MatchPhase,
  PackId,
  PlayerStats,
  PublicUser,
  TargetMode,
  TowerType,
} from './types';

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
export type AckFn<T extends object = object> = (res: Ack<T>) => void;

export const EV = {
  // ── client → server ──
  roomCreate: 'room:create',
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomSettings: 'room:settings',
  roomReady: 'room:ready',
  roomTeam: 'room:team',
  roomKick: 'room:kick',
  roomChat: 'room:chat',
  roomStart: 'room:start',
  browseSubscribe: 'browse:subscribe',
  browseUnsubscribe: 'browse:unsubscribe',
  friendRequest: 'friends:request',
  friendRespond: 'friends:respond',
  friendCancel: 'friends:cancel',
  friendRemove: 'friends:remove',
  inviteSend: 'invite:send',
  inviteRespond: 'invite:respond',
  placeTower: 'game:placeTower',
  moveTower: 'game:moveTower',
  upgradeTower: 'game:upgradeTower',
  sellTower: 'game:sellTower',
  repairTower: 'game:repairTower',
  setTargeting: 'game:setTargeting',
  setGroundTarget: 'game:setGroundTarget',
  sendTroops: 'game:sendTroops',
  ready: 'game:ready',
  speedVote: 'game:speedVote',
  chat: 'game:chat',
  resync: 'game:resync',
  emote: 'game:emote',
  setFace: 'game:setFace',
  roomQueueRanked: 'room:queueRanked',
  progGet: 'prog:get',
  progClaimRoad: 'prog:claimRoad',
  progOpenDrop: 'prog:openDrop',
  progOpenChest: 'prog:openChest',
  progUpgradeCard: 'prog:upgradeCard',
  progSetLoadout: 'prog:setLoadout',
  progSetIcon: 'prog:setIcon',
  progClaimQuest: 'prog:claimQuest',
  progRerollQuest: 'prog:rerollQuest',
  progClaimPass: 'prog:claimPass',
  progBuyPremium: 'prog:buyPremium',
  progShopBuy: 'prog:shopBuy',
  progClaimGift: 'prog:claimGift',
  progBuyBundle: 'prog:buyBundle',
  progLeaderboard: 'prog:leaderboard',
  progAckSeason: 'prog:ackSeason',
  mmQueue: 'mm:queue',
  mmCancel: 'mm:cancel',
  partyInvite: 'party:invite',
  partyRespond: 'party:respond',
  partyLeave: 'party:leave',
  // ── server → client ──
  hello: 'session:hello',
  toast: 'toast',
  roomState: 'room:state',
  roomClosed: 'room:closed',
  browseList: 'browse:list',
  socialState: 'social:state',
  presence: 'social:presence',
  inviteIncoming: 'invite:incoming',
  inviteGone: 'invite:gone',
  matchStart: 'match:start',
  matchSnap: 'match:snap',
  matchOver: 'match:over',
  chatMsg: 'chat:msg',
  progState: 'prog:state',
  progMatchRewards: 'prog:matchRewards',
  mmStatus: 'mm:status',
  mmFound: 'mm:found',
  partyState: 'party:state',
  partyInvited: 'party:invited',
  matchEmote: 'match:emote',
  matchFace: 'match:face',
} as const;

// ── Social ───────────────────────────────────────────────────────────────────
export type PresenceStatus = 'offline' | 'online' | 'lobby' | 'game';

export interface FriendInfo {
  id: string;
  name: string;
  status: PresenceStatus;
}

export interface FriendRequestInfo {
  userId: string;
  name: string;
  at: number;
}

export interface SocialState {
  friends: FriendInfo[];
  incoming: FriendRequestInfo[];
  outgoing: FriendRequestInfo[];
}

export interface InviteInfo {
  id: string;
  fromId: string;
  fromName: string;
  roomCode: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  expiresAt: number;
}

export interface ToastMsg {
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
}

export interface HelloPayload {
  user: PublicUser;
  stats: PlayerStats | null;
}

// ── Rooms ────────────────────────────────────────────────────────────────────
export interface RoomPlayer {
  id: string;
  name: string;
  guest: boolean;
  color: number;
  team: number;
  ready: boolean;
  connected: boolean;
  bot: boolean;
  /** towers this player will bring (their loadout) */
  loadout: TowerType[];
  level: number;
  icon: string;
}

export interface ChatMsg {
  id: number;
  fromId: string | null; // null = system
  name: string;
  color: number;
  text: string;
  at: number;
}

export interface RoomState {
  id: string;
  code: string;
  hostId: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  isPublic: boolean;
  state: 'waiting' | 'playing';
  players: RoomPlayer[];
  chat: ChatMsg[];
  maxPlayers: number;
  lastResults: MatchResults | null;
  /** friendly lobbies: everyone's towers count as level 5 */
  equalLevels: boolean;
  /** co-op without a final wave */
  endless: boolean;
  /** unrestricted custom play: all towers/troops and maps, with no progression rewards */
  sandbox: boolean;
  ranked: RankedMode | null;
}

export interface PublicRoomInfo {
  code: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  players: number;
  maxPlayers: number;
  hostName: string;
  sandbox: boolean;
}

export interface RoomSettingsPatch {
  mode?: GameMode;
  mapId?: MapId;
  difficulty?: Difficulty;
  isPublic?: boolean;
  equalLevels?: boolean;
  endless?: boolean;
}

// ── Match ────────────────────────────────────────────────────────────────────
export interface MatchPlayerInfo {
  id: string;
  name: string;
  guest: boolean;
  color: number;
  team: number;
  boardId: number;
  loadout: TowerType[];
  troops: PackId[];
  bot: boolean;
  icon: string;
  level: number;
  emotes: string[];
}

export interface MatchBoardInfo {
  id: number;
  defenders: string[];
  maxLives: number;
}

export interface MatchStartInfo {
  matchId: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  finalWave: number | null;
  ranked: boolean;
  endless: boolean;
  vsBot: boolean;
  players: MatchPlayerInfo[];
  boards: MatchBoardInfo[];
  /** Seed for the AI wave generator, so the client can preview the same spawns as the sim. */
  waveSeed: number;
}

/** One-shot visual effects since the previous snapshot. Coordinates are in tiles. */
export type Fx =
  | { k: 'shot'; t: TowerType; x1: number; y1: number; x2: number; y2: number }
  | { k: 'chain'; pts: number[] }
  | { k: 'boom'; x: number; y: number; r: number }
  | { k: 'pulse'; x: number; y: number; r: number }
  | { k: 'death'; x: number; y: number; e: number; b: number }
  | { k: 'leak'; x: number; y: number; n: number }
  | { k: 'inc'; from: string; pack: PackId; count: number; delay: number }
  | { k: 'build'; x: number; y: number }
  | { k: 'sell'; x: number; y: number; v: number }
  | { k: 'wave'; wave: number; boss: boolean }
  | { k: 'flame'; x: number; y: number; a: number; r: number; c: number }
  | { k: 'shieldup'; x: number; y: number; r: number }
  | { k: 'towerhit'; x: number; y: number; n: number }
  | { k: 'towerdown'; x: number; y: number }
  | { k: 'repair'; x: number; y: number }
  | { k: 'log'; pts: number[]; width: number };

export interface TowerSnap {
  id: number;
  type: TowerType;
  level: number;
  tx: number;
  ty: number;
  owner: string;
  targeting: TargetMode;
  invested: number;
  kills: number;
  /** false after the owner has used the one free reposition */
  freeMove: boolean;
  /** Card-level stat multiplier already applied by the sim. 1 means a level-1 card. */
  mult: number;
  hp: number;
  maxHp: number;
  /** Persistent impact point for manually aimed towers (tile coordinates). */
  targetX: number;
  targetY: number;
}

/** [id, typeIndex, x, y, hpFrac, slowed(0|1)] */
export type EnemyTuple = [number, number, number, number, number, number];
/** [id, x, y, kind(0 cannon, 1 mortar, 2 catapult)] */
export type ShellTuple = [number, number, number, number];
/** [towerId, currentHp, maxHp] */
export type TowerHpTuple = [number, number, number];
/** [hutTowerId, workerX, workerY, targetTowerId, repairing(0|1)] */
export type BuilderTuple = [number, number, number, number, number];

export interface BoardSnap {
  id: number;
  lives: number;
  alive: boolean;
  enemies: EnemyTuple[];
  towersVersion: number;
  /** only present when towersVersion changed (or on full snapshots) */
  towers?: TowerSnap[];
  shells: ShellTuple[];
  /** flattened [towerId, angle*100, ...] for towers currently tracking a target */
  aim: number[];
  /** flattened [towerId, enemyId, ramp*100, ...] for active prism beams */
  beams: number[];
  /** ids of towers currently buffed by a War Totem */
  buffed: number[];
  towerHp: TowerHpTuple[];
  builders: BuilderTuple[];
  fx: Fx[];
}

export interface PlayerSnap {
  id: string;
  money: number;
  income: number;
  ready: boolean;
  speedVote: boolean;
  alive: boolean;
  connected: boolean;
  /** seconds of cooldown remaining per pack, aligned with PACK_IDS */
  cds: number[];
}

export interface Snapshot {
  seq: number;
  time: number;
  phase: MatchPhase;
  wave: number;
  nextWaveIn: number | null;
  speed: number;
  players: PlayerSnap[];
  boards: BoardSnap[];
}

export interface PlayerMatchStats {
  kills: number;
  damage: number;
  earned: number;
  sent: number;
  built: number;
  builtBy: Partial<Record<TowerType, number>>;
  damageBy: Partial<Record<TowerType, number>>;
}

export interface MatchResults {
  matchId: string;
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  outcome: 'victory' | 'defeat' | 'versus';
  ranked: boolean;
  endless: boolean;
  vsBot: boolean;
  winners: string[];
  wave: number;
  wavesSurvived: number;
  durationSec: number;
  players: (MatchPlayerInfo & { stats: PlayerMatchStats; eliminatedWave: number | null })[];
}

// ── Intents ──────────────────────────────────────────────────────────────────
export interface PlaceTowerIntent {
  boardId: number;
  tx: number;
  ty: number;
  type: TowerType;
}
export interface TowerRefIntent {
  towerId: number;
}
export interface MoveTowerIntent {
  towerId: number;
  tx: number;
  ty: number;
}
export interface SetTargetingIntent {
  towerId: number;
  mode: TargetMode;
}
export interface SetGroundTargetIntent {
  towerId: number;
  tx: number;
  ty: number;
}
export interface SendTroopsIntent {
  packId: PackId;
  targetPlayerId?: string;
}

// ── Typed socket maps ────────────────────────────────────────────────────────
export interface ServerToClientEvents {
  [EV.hello]: (p: HelloPayload) => void;
  [EV.toast]: (t: ToastMsg) => void;
  [EV.roomState]: (r: RoomState) => void;
  [EV.roomClosed]: (p: { reason: string; silent?: boolean }) => void;
  [EV.browseList]: (rooms: PublicRoomInfo[]) => void;
  [EV.socialState]: (s: SocialState) => void;
  [EV.presence]: (p: { userId: string; status: PresenceStatus }) => void;
  [EV.inviteIncoming]: (i: InviteInfo) => void;
  [EV.inviteGone]: (p: { id: string }) => void;
  [EV.matchStart]: (m: MatchStartInfo) => void;
  [EV.matchSnap]: (s: Snapshot) => void;
  [EV.matchOver]: (r: MatchResults) => void;
  [EV.chatMsg]: (m: ChatMsg) => void;
  [EV.progState]: (p: ProfileView) => void;
  [EV.progMatchRewards]: (r: MatchRewards) => void;
  [EV.mmStatus]: (s: MmStatus) => void;
  [EV.mmFound]: (v: VsInfo) => void;
  [EV.partyState]: (p: PartyView | null) => void;
  [EV.partyInvited]: (i: PartyInvite) => void;
  [EV.matchEmote]: (e: EmoteEvent) => void;
  [EV.matchFace]: (e: FaceEvent) => void;
}

export interface ClientToServerEvents {
  [EV.roomCreate]: (
    p: { mode: GameMode; mapId: MapId; difficulty: Difficulty; isPublic?: boolean; endless?: boolean; equalLevels?: boolean; sandbox?: boolean },
    ack: AckFn<{ room: RoomState }>,
  ) => void;
  [EV.roomJoin]: (p: { code: string }, ack: AckFn<{ room: RoomState }>) => void;
  [EV.roomLeave]: (ack?: AckFn) => void;
  [EV.roomSettings]: (p: RoomSettingsPatch, ack?: AckFn) => void;
  [EV.roomReady]: (p: { ready: boolean }, ack?: AckFn) => void;
  [EV.roomTeam]: (p: { team: number }, ack?: AckFn) => void;
  [EV.roomKick]: (p: { playerId: string }, ack?: AckFn) => void;
  [EV.roomChat]: (p: { text: string }, ack?: AckFn) => void;
  [EV.roomStart]: (ack: AckFn) => void;
  [EV.browseSubscribe]: () => void;
  [EV.browseUnsubscribe]: () => void;
  [EV.friendRequest]: (p: { username: string }, ack: AckFn<{ autoAccepted: boolean }>) => void;
  [EV.friendRespond]: (p: { userId: string; accept: boolean }, ack?: AckFn) => void;
  [EV.friendCancel]: (p: { userId: string }, ack?: AckFn) => void;
  [EV.friendRemove]: (p: { userId: string }, ack?: AckFn) => void;
  [EV.inviteSend]: (p: { userId: string }, ack: AckFn) => void;
  [EV.inviteRespond]: (p: { inviteId: string; accept: boolean }, ack: AckFn<{ room?: RoomState }>) => void;
  [EV.placeTower]: (p: PlaceTowerIntent, ack?: AckFn<{ towerId?: number }>) => void;
  [EV.moveTower]: (p: MoveTowerIntent, ack?: AckFn) => void;
  [EV.upgradeTower]: (p: TowerRefIntent, ack?: AckFn) => void;
  [EV.sellTower]: (p: TowerRefIntent, ack?: AckFn) => void;
  [EV.repairTower]: (p: TowerRefIntent, ack?: AckFn<{ cost?: number }>) => void;
  [EV.setTargeting]: (p: SetTargetingIntent, ack?: AckFn) => void;
  [EV.setGroundTarget]: (p: SetGroundTargetIntent, ack?: AckFn) => void;
  [EV.sendTroops]: (p: SendTroopsIntent, ack?: AckFn) => void;
  [EV.ready]: (p: { value?: boolean }, ack?: AckFn) => void;
  [EV.speedVote]: (p: { value?: boolean }, ack?: AckFn) => void;
  [EV.chat]: (p: { text: string }, ack?: AckFn) => void;
  [EV.resync]: () => void;
  [EV.emote]: (p: { emoteId: string }, ack?: AckFn) => void;
  [EV.setFace]: (p: { icon: string }, ack?: AckFn) => void;
  [EV.roomQueueRanked]: (ack?: AckFn) => void;
  [EV.progGet]: (ack: AckFn<{ profile: ProfileView }>) => void;
  [EV.progClaimRoad]: (p: { nodeId: number }, ack: AckFn<{ granted: Granted[] }>) => void;
  [EV.progOpenDrop]: (p: { dropId: string }, ack: AckFn<DropOpenResult>) => void;
  [EV.progOpenChest]: (p: { chestId: string }, ack: AckFn<{ tier: ChestTier; granted: Granted[] }>) => void;
  [EV.progUpgradeCard]: (p: { tower: TowerType }, ack: AckFn<{ level: number; xp: number; levelUps: LevelUp[] }>) => void;
  [EV.progSetLoadout]: (p: { towers: TowerType[]; troops: PackId[] }, ack: AckFn) => void;
  [EV.progSetIcon]: (p: { icon: string }, ack: AckFn) => void;
  [EV.progClaimQuest]: (p: { questId: string }, ack: AckFn<{ granted: Granted[]; levelUps: LevelUp[] }>) => void;
  [EV.progRerollQuest]: (p: { questId: string }, ack: AckFn) => void;
  [EV.progClaimPass]: (p: { tier: number; track: 'free' | 'premium' }, ack: AckFn<{ granted: Granted[] }>) => void;
  [EV.progBuyPremium]: (ack: AckFn) => void;
  [EV.progShopBuy]: (p: { offerId: string }, ack: AckFn<{ granted: Granted[] }>) => void;
  [EV.progClaimGift]: (ack: AckFn<{ granted: Granted[] }>) => void;
  [EV.progBuyBundle]: (p: { bundleId: string }, ack: AckFn<{ granted: Granted[] }>) => void;
  [EV.progLeaderboard]: (p: LeaderboardQuery, ack: AckFn<LeaderboardView>) => void;
  [EV.progAckSeason]: (ack?: AckFn) => void;
  [EV.mmQueue]: (p: { mode: RankedMode }, ack: AckFn) => void;
  [EV.mmCancel]: (ack?: AckFn) => void;
  [EV.partyInvite]: (p: { userId: string }, ack: AckFn) => void;
  [EV.partyRespond]: (p: { partyId: string; accept: boolean }, ack: AckFn) => void;
  [EV.partyLeave]: (ack?: AckFn) => void;
}

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  if (c.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of c) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return c;
}
