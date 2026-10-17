// Client-facing types for the progression / competitive layer.
import type { ChestTier, DropRarity } from './progression';
import type { MapId, PackId, TowerType } from './types';

export type Granted =
  | { kind: 'coins'; amount: number }
  | { kind: 'gems'; amount: number }
  | { kind: 'xp'; amount: number }
  | { kind: 'tokens'; amount: number }
  | { kind: 'card'; tower: TowerType; copies: number; isNew: boolean; level: number; copiesAfter: number; copiesNeeded: number | null }
  | { kind: 'troop'; troop: PackId; isNew: boolean }
  | { kind: 'icon'; id: string; isNew: boolean }
  | { kind: 'emote'; id: string; isNew: boolean }
  | { kind: 'chest'; tier: ChestTier; chestId: string }
  | { kind: 'arena'; arena: number };

export interface LevelUp {
  level: number;
  chest: ChestTier;
  gems: number;
}

export interface QuestProgress {
  id: string;
  text: string;
  before: number;
  after: number;
  target: number;
  completed: boolean;
  weekly: boolean;
}

export interface MatchRewards {
  matchId: string;
  ranked: 'duel' | 'team' | null;
  vsBot: boolean;
  won: boolean;
  trophies: { ladder: 'duel' | 'team'; before: number; after: number; delta: number } | null;
  arena: { before: number; after: number; unlocked: boolean };
  xp: { gained: number; levelBefore: number; levelAfter: number; intoBefore: number; needBefore: number; intoAfter: number; needAfter: number };
  levelUps: LevelUp[];
  tokens: number;
  quests: QuestProgress[];
  drop: { granted: boolean; capped: boolean; dropId: string | null; earnedToday: number };
  stars: { mapId: MapId; before: number; after: number } | null;
  firstClear: Granted[] | null;
  endlessRecord: number | null;
}

export interface SeasonNotice {
  season: number;
  peakArena: number;
  coins: number;
  gems: number;
  duelBefore: number;
  duelAfter: number;
  teamBefore: number;
  teamAfter: number;
}

export interface CardView {
  level: number;
  copies: number;
  /** copies needed for the next level (null at max) */
  need: number | null;
  /** coins needed for the next level (null at max) */
  coins: number | null;
  canUpgrade: boolean;
}

export interface QuestView {
  id: string;
  text: string;
  progress: number;
  target: number;
  claimed: boolean;
  weekly: boolean;
  coins: number;
  xp: number;
  tokens: number;
}

export interface ShopOfferView {
  id: string;
  kind: 'card' | 'chest' | 'cosmetic';
  tower?: TowerType;
  copies?: number;
  tier?: ChestTier;
  cosmetic?: { type: 'icon' | 'emote'; id: string };
  price: number;
  currency: 'coins' | 'gems';
  bought: boolean;
}

export interface Top3View {
  season: number;
  duel: { userId: string; name: string; icon: string; trophies: number }[];
  team: { userId: string; name: string; icon: string; trophies: number }[];
}

export interface Badges {
  shop: number;
  collection: number;
  battle: number;
  progress: number;
  road: number;
  pass: number;
  quests: number;
}

export interface ProfileView {
  coins: number;
  gems: number;
  level: number;
  xpInto: number;
  xpNeed: number;
  duel: number;
  team: number;
  duelBest: number;
  teamBest: number;
  arena: number;
  arenaReached: number;
  roadProgress: number;
  roadClaimed: number[];
  roadClaimable: number[];
  cards: Partial<Record<TowerType, CardView>>;
  troops: PackId[];
  loadout: TowerType[];
  army: PackId[];
  icons: string[];
  emotes: string[];
  icon: string;
  drops: { earnedToday: number; cap: number; pending: { id: string; source: string }[] };
  chests: { id: string; tier: ChestTier; source: string }[];
  quests: { daily: QuestView[]; weekly: QuestView[]; rerollsLeft: number; dailyResetIn: number };
  pass: { season: number; tokens: number; tier: number; premium: boolean; claimedFree: number[]; claimedPremium: number[]; claimableFree: number[]; claimablePremium: number[] };
  shop: { offers: ShopOfferView[]; giftClaimed: boolean; refreshesIn: number };
  campaign: Partial<Record<MapId, number>>;
  endlessBest: Partial<Record<MapId, number>>;
  endlessUnlocked: boolean;
  unlockedMaps: MapId[];
  ranked: { duelWins: number; duelLosses: number; teamWins: number; teamLosses: number };
  season: { id: number; endsAt: number; lastTop3: Top3View | null };
  seasonNotice: SeasonNotice | null;
  badges: Badges;
}

export interface DropOpenResult {
  steps: DropRarity[];
  rarity: DropRarity;
  granted: Granted[];
}

export interface LbRowView {
  rank: number;
  userId: string;
  name: string;
  icon: string;
  level: number;
  arena: number;
  value: number;
  players?: { id: string; name: string }[];
}

export interface LeaderboardQuery {
  board: 'duel' | 'team' | 'endless';
  mapId?: MapId;
  scope: 'global' | 'friends';
  period: 'season' | 'all';
}

export interface LeaderboardView {
  rows: LbRowView[];
  me: LbRowView | null;
  lastTop3: Top3View | null;
}

export type RankedMode = 'duel' | 'team';

export interface MmStatus {
  state: 'idle' | 'searching' | 'found';
  mode: RankedMode | null;
  /** server time the search started */
  since: number;
  /** members searching together (party) */
  party: string[];
}

export interface VsSide {
  id: string;
  name: string;
  level: number;
  trophies: number;
  arena: number;
  icon: string;
  bot: boolean;
}

export interface VsInfo {
  mode: RankedMode;
  mapId: MapId;
  teams: [VsSide[], VsSide[]];
  /** which side the receiving player is on */
  mySide: 0 | 1;
  startsIn: number;
}

export interface PartyView {
  id: string;
  leaderId: string;
  members: { id: string; name: string; icon: string; level: number }[];
}

export interface PartyInvite {
  partyId: string;
  fromId: string;
  fromName: string;
  expiresAt: number;
}

export interface EmoteEvent {
  playerId: string;
  emoteId: string;
}

export interface FaceEvent {
  playerId: string;
  icon: string;
}
