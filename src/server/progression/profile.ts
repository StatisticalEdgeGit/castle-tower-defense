// Account progression state (stored in db.users[id].progression) + shared helpers:
// clock/day keys, seeded RNG, level math, and safe defaults/migration.
import {
  ARENAS,
  arenaForTrophies,
  CHESTS,
  MAX_PLAYER_LEVEL,
  STARTER_EMOTES,
  STARTER_ICONS,
  STARTER_TOWERS,
  STARTER_TROOPS,
  STARTING_COINS,
  STARTING_GEMS,
  xpToNext,
  type ChestTier,
} from '../../shared/progression';
import { hashSeed, mulberry32 } from '../../shared/rng';
import type { MapId, PackId, TowerType } from '../../shared/types';

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export interface CardState {
  level: number;
  copies: number;
}
export interface QuestState {
  id: string;
  progress: number;
  claimed: boolean;
}
export interface PendingDrop {
  id: string;
  source: string;
  at: number;
}
export interface PendingChest {
  id: string;
  tier: ChestTier;
  source: string;
  at: number;
}
export interface ShopOffer {
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
import type { SeasonNotice } from '../../shared/progProtocol';
export type { SeasonNotice };

export interface Profile {
  v: 1;
  coins: number;
  gems: number;
  /** total XP ever earned (level is derived) */
  xp: number;
  duel: number;
  team: number;
  duelBest: number;
  teamBest: number;
  seasonId: number;
  /** highest arena reached this season (season-end reward) */
  seasonPeakArena: number;
  /** permanent: highest arena ever reached (unlocks) */
  arenaReached: number;
  roadClaimed: number[];
  cards: Partial<Record<TowerType, CardState>>;
  troops: PackId[];
  loadout: TowerType[];
  army: PackId[];
  icons: string[];
  emotes: string[];
  icon: string;
  drops: { day: string; earnedToday: number; pending: PendingDrop[] };
  chests: PendingChest[];
  quests: { day: string; daily: QuestState[]; rerolls: number; week: string; weekly: QuestState[] };
  pass: { season: number; tokens: number; premium: boolean; claimedFree: number[]; claimedPremium: number[] };
  shop: { day: string; offers: ShopOffer[]; giftClaimed: boolean };
  campaign: Partial<Record<MapId, number>>;
  firstClears: string[];
  endlessBest: Partial<Record<MapId, number>>;
  ranked: { duelWins: number; duelLosses: number; teamWins: number; teamLosses: number };
  seasonNotice: SeasonNotice | null;
  /** monotonically increasing counter (ids + RNG streams) */
  seq: number;
}

export function newProfile(seasonId = 1): Profile {
  const cards: Partial<Record<TowerType, CardState>> = {};
  for (const t of STARTER_TOWERS) cards[t] = { level: 1, copies: 0 };
  return {
    v: 1,
    coins: STARTING_COINS,
    gems: STARTING_GEMS,
    xp: 0,
    duel: 0,
    team: 0,
    duelBest: 0,
    teamBest: 0,
    seasonId,
    seasonPeakArena: 0,
    arenaReached: 0,
    roadClaimed: [],
    cards,
    troops: [...STARTER_TROOPS],
    loadout: [...STARTER_TOWERS],
    army: [...STARTER_TROOPS],
    icons: [...STARTER_ICONS],
    emotes: [...STARTER_EMOTES],
    icon: STARTER_ICONS[0],
    drops: { day: '', earnedToday: 0, pending: [] },
    chests: [],
    quests: { day: '', daily: [], rerolls: 0, week: '', weekly: [] },
    pass: { season: seasonId, tokens: 0, premium: false, claimedFree: [], claimedPremium: [] },
    shop: { day: '', offers: [], giftClaimed: false },
    campaign: {},
    firstClears: [],
    endlessBest: {},
    ranked: { duelWins: 0, duelLosses: 0, teamWins: 0, teamLosses: 0 },
    seasonNotice: null,
    seq: 1,
  };
}

/** Fill in any missing fields (forward-compatible migration of stored profiles). */
export function normalizeProfile(raw: Partial<Profile> | Record<string, unknown> | undefined, seasonId = 1): Profile {
  const base = newProfile(seasonId);
  if (!raw || (raw as Partial<Profile>).v !== 1) return base;
  // fill missing fields IN PLACE so every caller keeps working on the same stored object
  const p = raw as Profile;
  const rec = p as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) if (rec[k] === undefined) rec[k] = v;
  const fill = <T extends object>(target: T, defaults: T) => {
    const t = target as Record<string, unknown>;
    for (const [k, v] of Object.entries(defaults)) if (t[k] === undefined) t[k] = v;
  };
  fill(p.drops, base.drops);
  fill(p.quests, base.quests);
  fill(p.pass, base.pass);
  fill(p.shop, base.shop);
  fill(p.ranked, base.ranked);
  if (!p.cards || typeof p.cards !== 'object') p.cards = base.cards;
  for (const t of STARTER_TOWERS) if (!p.cards[t]) p.cards[t] = { level: 1, copies: 0 };
  for (const t of STARTER_TROOPS) if (!p.troops.includes(t)) p.troops.push(t);
  return p;
}

// ── keys / clock ─────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

/** Local-date key (daily rollover at local midnight). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local ISO-week key, weeks start on Monday. */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // Mon=0
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${pad(week)}`;
}

/** Milliseconds until the next local midnight. */
export function msUntilMidnight(ms: number): number {
  const d = new Date(ms);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getTime() - ms;
}

// ── rng ──────────────────────────────────────────────────────────────────────
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded RNG stream derived from (userId, a profile counter, salt). Advances profile.seq. */
export function profileRng(userId: string, p: Profile, salt: string): () => number {
  const seed = hashSeed(hashString(userId + ':' + salt), p.seq++);
  return mulberry32(seed);
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pickWeighted<T extends { weight: number }>(rng: () => number, items: T[]): T {
  const total = items.reduce((a, b) => a + b.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function newId(p: Profile, prefix: string): string {
  return `${prefix}${(p.seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ── levels / arenas ──────────────────────────────────────────────────────────
export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, xp);
  while (level < MAX_PLAYER_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: level >= MAX_PLAYER_LEVEL ? 0 : xpToNext(level) };
}

/** Current arena (for unlocks/matchmaking) = max(arena of highest current ladder, arena reached). */
export function currentArena(p: Profile): number {
  return Math.max(arenaForTrophies(Math.max(p.duel, p.team)), p.arenaReached);
}

export function roadProgress(p: Profile): number {
  return p.duelBest + p.teamBest;
}

export function chestName(tier: ChestTier): string {
  return CHESTS[tier].name;
}

export function arenaName(i: number): string {
  return ARENAS[Math.max(0, Math.min(ARENAS.length - 1, i))].name;
}
