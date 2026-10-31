/**
 * Progression & competitive layer — ALL meta-game balance / economy numbers live here.
 *
 *  • Currencies: coins (soft) and gems (premium-feeling but EARNED ONLY — there is no
 *    real-money purchase code anywhere in this project).
 *  • Two trophy ladders (Ranked Duel 1v1 and Ranked Team 2v2) with arena gates.
 *  • Cards: every tower is a card with a rarity and a level (1–10); troops only unlock.
 *  • Reward loop: reward drops, chests, player XP levels, daily/weekly quests, a 30-tier
 *    season pass ("Tower Pass"), a daily shop, cosmetics and co-op campaign stars.
 *
 * Everything here is data; the rules that use it are in src/server/progression/.
 */
import type { MapId, PackId, TowerType } from './types';

// ── Rarities ─────────────────────────────────────────────────────────────────
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR: Record<Rarity | 'mythic', string> = {
  common: '#9fb3c8',
  rare: '#ff9f2e',
  epic: '#c25cff',
  mythic: '#ff4d8a',
  legendary: '#45e0ff',
};
export const RARITY_LABEL: Record<Rarity | 'mythic', string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  mythic: 'Mythic',
  legendary: 'Legendary',
};

// ── Arenas ───────────────────────────────────────────────────────────────────
export interface ArenaDef {
  index: number;
  id: string;
  name: string;
  /** trophies (highest of duel/team) needed to reach it */
  trophies: number;
  emoji: string;
  /** banner gradient + accent colour */
  colors: [string, string, string];
  /** towers added to the card drop pool / shop at this arena */
  towers: TowerType[];
  /** troop cards that can be found from this arena on */
  troops: PackId[];
  /** maps added to the ranked rotation */
  maps: MapId[];
}

export const ARENAS: ArenaDef[] = [
  { index: 0, id: 'meadow', name: 'Meadow Outpost', trophies: 0, emoji: '🌿', colors: ['#2f7d46', '#174a2a', '#8de07f'], towers: ['archer', 'crossbow', 'builder', 'cannon', 'frost', 'sniper'], troops: ['grunts', 'runners', 'swarm', 'brutes'], maps: ['greenfield'] },
  { index: 1, id: 'canyon', name: 'Canyon Fort', trophies: 300, emoji: '🏜️', colors: ['#b8672e', '#5e2c12', '#ffc27a'], towers: ['mine', 'flame'], troops: ['knights'], maps: ['canyon'] },
  { index: 2, id: 'frost', name: 'Frost Keep', trophies: 700, emoji: '❄️', colors: ['#3f8fd1', '#163a66', '#bfe8ff'], towers: ['tesla', 'venom'], troops: ['healers'], maps: ['crossroads'] },
  { index: 3, id: 'thunder', name: 'Thunder Peak', trophies: 1200, emoji: '⚡', colors: ['#6d4fd6', '#271a5e', '#ffe066'], towers: ['mortar'], troops: ['splitters'], maps: ['spiral'] },
  { index: 4, id: 'shadow', name: 'Shadow Citadel', trophies: 1800, emoji: '🌑', colors: ['#3b2f52', '#120d1d', '#c084fc'], towers: ['prism'], troops: ['shields'], maps: [] },
  { index: 5, id: 'dragon', name: 'Dragon Spire', trophies: 2600, emoji: '🐉', colors: ['#c0392b', '#3d0d0a', '#ffb347'], towers: ['totem'], troops: ['warlord'], maps: [] },
  { index: 6, id: 'legendary', name: 'Legendary Arena', trophies: 3500, emoji: '👑', colors: ['#d4a017', '#3a2a00', '#fff3b0'], towers: [], troops: [], maps: [] },
];

export function arenaForTrophies(trophies: number): number {
  let idx = 0;
  for (const a of ARENAS) if (trophies >= a.trophies) idx = a.index;
  return idx;
}

/** Towers that can drop for a player who has reached arena `arena`. */
export function towerPool(arena: number): TowerType[] {
  return ARENAS.filter((a) => a.index <= arena).flatMap((a) => a.towers);
}
export function troopPool(arena: number): PackId[] {
  return ARENAS.filter((a) => a.index <= arena).flatMap((a) => a.troops);
}
export function rankedMaps(arena: number): MapId[] {
  return ARENAS.filter((a) => a.index <= arena).flatMap((a) => a.maps);
}
export function towerArena(t: TowerType): number {
  return ARENAS.find((a) => a.towers.includes(t))?.index ?? 0;
}
export function troopArena(p: PackId): number {
  return ARENAS.find((a) => a.troops.includes(p))?.index ?? 0;
}

// ── Cards ────────────────────────────────────────────────────────────────────
export const TOWER_RARITY: Record<TowerType, Rarity> = {
  archer: 'common',
  crossbow: 'common',
  builder: 'rare',
  cannon: 'common',
  frost: 'common',
  sniper: 'rare',
  mine: 'rare',
  flame: 'rare',
  tesla: 'epic',
  mortar: 'epic',
  venom: 'epic',
  prism: 'legendary',
  totem: 'legendary',
};

export const STARTER_TOWERS: TowerType[] = ['archer', 'crossbow', 'builder', 'cannon', 'frost', 'sniper'];
export const STARTER_TROOPS: PackId[] = ['grunts', 'runners', 'swarm', 'brutes'];
export const MAX_LOADOUT_TOWERS = 6;
export const MAX_ARMY = 5;
export const MAX_CARD_LEVEL = 10;

/** Copies needed to go from level L to L+1 (index L-1). Clash-Royale-style curve. */
export const COPIES_PER_LEVEL: Record<Rarity, number[]> = {
  common: [2, 4, 10, 20, 50, 100, 200, 400, 800],
  // rarer cards need proportionally fewer copies
  rare: [1, 2, 4, 7, 17, 34, 67, 134, 267],
  epic: [1, 1, 1, 2, 5, 10, 20, 40, 80],
  legendary: [1, 1, 1, 1, 2, 3, 5, 10, 20],
};
/** Coins to go from level L to L+1 (index L-1). */
export const COINS_PER_LEVEL = [5, 20, 50, 150, 400, 1000, 2000, 4000, 8000];
/** XP granted for upgrading to level L+1 (index L-1). */
export const UPGRADE_XP = [4, 5, 6, 10, 25, 50, 100, 200, 400];

/** +5% damage per card level (Gold Mine: +5% income). */
export const LEVEL_STAT_BONUS = 0.05;
/** War Totem: +1% to both of its buffs per card level. */
export const TOTEM_LEVEL_BONUS = 0.01;
/** "Equal levels" friendly-lobby toggle treats every tower as this level. */
export const EQUAL_LEVEL = 5;

export function levelStatMult(level: number): number {
  return 1 + LEVEL_STAT_BONUS * (Math.max(1, Math.min(MAX_CARD_LEVEL, level)) - 1);
}

// ── Trophies & matchmaking ───────────────────────────────────────────────────
export const TROPHIES = {
  winBase: 30,
  winMin: 20,
  winMax: 40,
  lossBase: 26,
  lossMin: 15,
  lossMax: 35,
  /** trophy difference divisor */
  diffDivisor: 25,
  /** below this many trophies, losses are halved */
  newbieProtection: 300,
  botMatchesAwardTrophies: true,
};

export const MATCHMAKING = {
  /** acceptable trophy gap at the start of a search */
  gapStart: 100,
  /** gap widens by this much ... */
  gapGrowth: 50,
  /** ... every this many seconds */
  gapEverySec: 3,
  /** fill empty seats with bots after this long */
  botTimeoutSec: 12,
  /** VS splash shown before a ranked match starts */
  vsSplashSec: 3,
};

/** Ranked ruleset: snappy matches (~6–9 min). */
export const RANKED_RULES = {
  firstWaveDelay: 15,
  waveInterval: 20,
  escalationStartWave: 18,
  escalationHpPerWave: 1.15,
  difficulty: 'normal' as const,
};

// ── Player level / XP ────────────────────────────────────────────────────────
export const MAX_PLAYER_LEVEL = 50;
/** XP needed to go from level L to L+1. */
export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.35));
}
export const MATCH_XP = { played: 20, win: 20, ranked: 10, coopVictory: 25, perCoopWave: 1 };

// ── Reward drops (Starr-Drop style) ──────────────────────────────────────────
export type DropRarity = 'common' | 'rare' | 'epic' | 'mythic' | 'legendary';
export const DROP_RARITIES: DropRarity[] = ['common', 'rare', 'epic', 'mythic', 'legendary'];
export const DROPS_PER_DAY = 8;
/** chance that each tap upgrades the drop to the next rarity (index = current rarity) */
export const DROP_UPGRADE_CHANCE = [0.5, 0.32, 0.18, 0.25];

export type DropRewardSpec =
  | { kind: 'coins'; min: number; max: number; weight: number }
  | { kind: 'gems'; min: number; max: number; weight: number }
  | { kind: 'cards'; rarity: Rarity; min: number; max: number; weight: number }
  | { kind: 'unlock'; weight: number }
  | { kind: 'cosmetic'; weight: number };

export const DROP_TABLE: Record<DropRarity, DropRewardSpec[]> = {
  common: [
    { kind: 'coins', min: 40, max: 80, weight: 60 },
    { kind: 'cards', rarity: 'common', min: 3, max: 6, weight: 40 },
  ],
  rare: [
    { kind: 'coins', min: 120, max: 200, weight: 40 },
    { kind: 'cards', rarity: 'common', min: 8, max: 15, weight: 25 },
    { kind: 'cards', rarity: 'rare', min: 2, max: 4, weight: 25 },
    { kind: 'gems', min: 5, max: 10, weight: 10 },
  ],
  epic: [
    { kind: 'coins', min: 300, max: 500, weight: 30 },
    { kind: 'cards', rarity: 'rare', min: 5, max: 8, weight: 20 },
    { kind: 'cards', rarity: 'epic', min: 1, max: 2, weight: 20 },
    { kind: 'gems', min: 15, max: 25, weight: 12 },
    { kind: 'unlock', weight: 10 },
    { kind: 'cosmetic', weight: 8 },
  ],
  mythic: [
    { kind: 'coins', min: 700, max: 1000, weight: 20 },
    { kind: 'cards', rarity: 'epic', min: 3, max: 4, weight: 20 },
    { kind: 'gems', min: 40, max: 60, weight: 20 },
    { kind: 'unlock', weight: 25 },
    { kind: 'cosmetic', weight: 15 },
  ],
  legendary: [
    { kind: 'coins', min: 1500, max: 2500, weight: 15 },
    { kind: 'cards', rarity: 'legendary', min: 1, max: 1, weight: 20 },
    { kind: 'gems', min: 80, max: 120, weight: 15 },
    { kind: 'unlock', weight: 50 },
  ],
};

// ── Chests ───────────────────────────────────────────────────────────────────
export type ChestTier = 'silver' | 'gold' | 'magic' | 'legendary';
export interface ChestDef {
  name: string;
  coins: [number, number];
  gems: [number, number];
  /** number of distinct card stacks */
  stacks: number;
  /** total copies, split by rarity (rare = total/4, epic = total/10 ...) */
  copies: number;
  /** guaranteed stack of at least this rarity */
  guarantee: Rarity;
  color: string;
}
export const CHESTS: Record<ChestTier, ChestDef> = {
  silver: { name: 'Silver Chest', coins: [60, 100], gems: [0, 0], stacks: 3, copies: 14, guarantee: 'common', color: '#c0c8d6' },
  gold: { name: 'Gold Chest', coins: [180, 260], gems: [0, 5], stacks: 4, copies: 40, guarantee: 'rare', color: '#ffc247' },
  magic: { name: 'Magic Chest', coins: [400, 600], gems: [10, 20], stacks: 5, copies: 90, guarantee: 'epic', color: '#c25cff' },
  legendary: { name: 'Legendary Chest', coins: [1000, 1400], gems: [30, 40], stacks: 5, copies: 150, guarantee: 'legendary', color: '#45e0ff' },
};
/** copies of a rarity relative to commons in chests */
export const CHEST_RARITY_DIVISOR: Record<Rarity, number> = { common: 1, rare: 4, epic: 12, legendary: 60 };

// ── Trophy Road ──────────────────────────────────────────────────────────────
export type RewardSpec =
  | { type: 'coins'; amount: number }
  | { type: 'gems'; amount: number }
  | { type: 'chest'; tier: ChestTier }
  | { type: 'tower'; tower: TowerType }
  | { type: 'troop'; troop: PackId }
  | { type: 'icon'; icon: string }
  | { type: 'emote'; emote: string }
  | { type: 'arena'; arena: number }
  | { type: 'cards'; tower: TowerType; copies: number }
  | { type: 'tokens'; amount: number };

export interface RoadNode {
  id: number;
  /** progress value = highest-ever duel + highest-ever team trophies */
  trophies: number;
  rewards: RewardSpec[];
  milestone?: boolean;
}

export const TROPHY_ROAD: RoadNode[] = (() => {
  const raw: [number, RewardSpec[], boolean?][] = [
    [25, [{ type: 'coins', amount: 100 }]],
    [75, [{ type: 'chest', tier: 'silver' }]],
    [125, [{ type: 'gems', amount: 20 }]],
    [175, [{ type: 'icon', icon: 'knight' }]],
    [225, [{ type: 'chest', tier: 'gold' }]],
    [300, [{ type: 'arena', arena: 1 }, { type: 'gems', amount: 50 }], true],
    [350, [{ type: 'tower', tower: 'flame' }]],
    [400, [{ type: 'coins', amount: 300 }]],
    [450, [{ type: 'troop', troop: 'knights' }]],
    [500, [{ type: 'emote', emote: 'fire' }]],
    [560, [{ type: 'tower', tower: 'mine' }]],
    [630, [{ type: 'chest', tier: 'gold' }]],
    [700, [{ type: 'arena', arena: 2 }, { type: 'gems', amount: 60 }], true],
    [775, [{ type: 'tower', tower: 'venom' }]],
    [850, [{ type: 'coins', amount: 600 }]],
    [925, [{ type: 'troop', troop: 'healers' }]],
    [1000, [{ type: 'chest', tier: 'magic' }]],
    [1075, [{ type: 'tower', tower: 'tesla' }]],
    [1150, [{ type: 'icon', icon: 'wizard' }]],
    [1200, [{ type: 'arena', arena: 3 }, { type: 'gems', amount: 80 }], true],
    [1300, [{ type: 'tower', tower: 'mortar' }]],
    [1400, [{ type: 'troop', troop: 'splitters' }]],
    [1500, [{ type: 'coins', amount: 1000 }]],
    [1600, [{ type: 'emote', emote: 'crown' }]],
    [1700, [{ type: 'chest', tier: 'magic' }]],
    [1800, [{ type: 'arena', arena: 4 }, { type: 'gems', amount: 100 }], true],
    [1900, [{ type: 'tower', tower: 'prism' }]],
    [2000, [{ type: 'troop', troop: 'shields' }]],
    [2150, [{ type: 'coins', amount: 1500 }]],
    [2300, [{ type: 'icon', icon: 'phoenix' }]],
    [2450, [{ type: 'chest', tier: 'legendary' }]],
    [2600, [{ type: 'arena', arena: 5 }, { type: 'gems', amount: 150 }], true],
    [2750, [{ type: 'tower', tower: 'totem' }]],
    [2900, [{ type: 'troop', troop: 'warlord' }]],
    [3100, [{ type: 'coins', amount: 3000 }]],
    [3300, [{ type: 'emote', emote: 'skull' }]],
    [3500, [{ type: 'arena', arena: 6 }, { type: 'chest', tier: 'legendary' }, { type: 'gems', amount: 250 }], true],
    [3750, [{ type: 'icon', icon: 'dragon' }]],
    [4000, [{ type: 'chest', tier: 'legendary' }]],
  ];
  return raw.map(([trophies, rewards, milestone], i) => ({ id: i + 1, trophies, rewards, milestone: !!milestone }));
})();

// ── Quests ───────────────────────────────────────────────────────────────────
export type QuestMetric =
  | 'played'
  | 'wins'
  | 'rankedWins'
  | 'teamWins'
  | 'kills'
  | 'sent'
  | 'built'
  | 'builtCannon'
  | 'damage'
  | 'damageTesla'
  | 'damageArcher'
  | 'coopWave';

export interface QuestDef {
  id: string;
  text: string;
  metric: QuestMetric;
  /** 'sum' accumulates over matches; 'max' needs it in a single match */
  mode: 'sum' | 'max';
  target: number;
  coins: number;
  xp: number;
  tokens: number;
}

export const DAILY_QUESTS: QuestDef[] = [
  { id: 'd_win_ranked', text: 'Win 2 ranked matches', metric: 'rankedWins', mode: 'sum', target: 2, coins: 200, xp: 50, tokens: 40 },
  { id: 'd_destroy', text: 'Destroy 600 enemies', metric: 'kills', mode: 'sum', target: 600, coins: 150, xp: 40, tokens: 30 },
  { id: 'd_send', text: 'Send 40 troops', metric: 'sent', mode: 'sum', target: 40, coins: 150, xp: 40, tokens: 30 },
  { id: 'd_cannons', text: 'Build 15 Cannons', metric: 'builtCannon', mode: 'sum', target: 15, coins: 120, xp: 30, tokens: 25 },
  { id: 'd_coop15', text: 'Reach wave 15 in co-op', metric: 'coopWave', mode: 'max', target: 15, coins: 180, xp: 45, tokens: 35 },
  { id: 'd_tesla', text: 'Deal 50,000 damage with Tesla', metric: 'damageTesla', mode: 'sum', target: 50_000, coins: 180, xp: 45, tokens: 35 },
  { id: 'd_win2v2', text: 'Win a 2v2', metric: 'teamWins', mode: 'sum', target: 1, coins: 150, xp: 40, tokens: 30 },
  { id: 'd_play3', text: 'Play 3 matches', metric: 'played', mode: 'sum', target: 3, coins: 100, xp: 30, tokens: 25 },
  { id: 'd_build20', text: 'Build 20 towers', metric: 'built', mode: 'sum', target: 20, coins: 100, xp: 30, tokens: 25 },
  { id: 'd_damage', text: 'Deal 100,000 damage', metric: 'damage', mode: 'sum', target: 100_000, coins: 150, xp: 40, tokens: 30 },
  { id: 'd_win2', text: 'Win 2 matches', metric: 'wins', mode: 'sum', target: 2, coins: 150, xp: 40, tokens: 30 },
  { id: 'd_archer', text: 'Deal 20,000 damage with Archers', metric: 'damageArcher', mode: 'sum', target: 20_000, coins: 120, xp: 30, tokens: 25 },
];

export const WEEKLY_QUESTS: QuestDef[] = [
  { id: 'w_win10', text: 'Win 10 matches', metric: 'wins', mode: 'sum', target: 10, coins: 1000, xp: 250, tokens: 150 },
  { id: 'w_destroy', text: 'Destroy 5,000 enemies', metric: 'kills', mode: 'sum', target: 5000, coins: 800, xp: 200, tokens: 120 },
  { id: 'w_send', text: 'Send 300 troops', metric: 'sent', mode: 'sum', target: 300, coins: 800, xp: 200, tokens: 120 },
  { id: 'w_play15', text: 'Play 15 matches', metric: 'played', mode: 'sum', target: 15, coins: 700, xp: 180, tokens: 100 },
  { id: 'w_damage', text: 'Deal 1,000,000 damage', metric: 'damage', mode: 'sum', target: 1_000_000, coins: 900, xp: 220, tokens: 130 },
  { id: 'w_coop25', text: 'Reach wave 25 in co-op', metric: 'coopWave', mode: 'max', target: 25, coins: 1000, xp: 250, tokens: 150 },
];
export const DAILY_QUEST_COUNT = 3;
export const WEEKLY_QUEST_COUNT = 3;
export const FREE_REROLLS_PER_DAY = 1;

// ── Season pass ("Tower Pass") ───────────────────────────────────────────────
export const SEASON = {
  lengthDays: 28,
  passTiers: 30,
  tokensPerTier: 100,
  /** unlocked with EARNED gems only */
  premiumGemCost: 500,
  matchTokens: 15,
  winTokens: 15,
  /** soft trophy reset at season end */
  softResetAbove: 1500,
  softResetKeep: 0.5,
};

export function passFreeReward(tier: number): RewardSpec {
  if (tier % 10 === 0) return { type: 'chest', tier: 'gold' };
  if (tier % 5 === 0) return { type: 'gems', amount: 20 };
  if (tier % 3 === 0) return { type: 'chest', tier: 'silver' };
  return { type: 'coins', amount: 100 + tier * 10 };
}
export function passPremiumReward(tier: number): RewardSpec {
  if (tier === SEASON.passTiers) return { type: 'chest', tier: 'legendary' };
  if (tier === 15) return { type: 'emote', emote: 'clap' };
  if (tier === 25) return { type: 'icon', icon: 'crown' };
  if (tier % 10 === 0) return { type: 'chest', tier: 'magic' };
  if (tier % 4 === 0) return { type: 'gems', amount: 40 };
  if (tier % 2 === 0) return { type: 'chest', tier: 'gold' };
  return { type: 'coins', amount: 250 + tier * 20 };
}

/** Season-end reward by the peak arena reached this season. */
export const SEASON_END_REWARD: { coins: number; gems: number }[] = [
  { coins: 100, gems: 5 },
  { coins: 250, gems: 10 },
  { coins: 500, gems: 20 },
  { coins: 800, gems: 35 },
  { coins: 1200, gems: 50 },
  { coins: 2000, gems: 80 },
  { coins: 3000, gems: 120 },
];

// ── Shop ─────────────────────────────────────────────────────────────────────
export const SHOP = {
  dailyOffers: 6,
  /** coins per card copy by rarity */
  copyPrice: { common: 10, rare: 60, epic: 500, legendary: 2500 } as Record<Rarity, number>,
  copiesPerOffer: { common: 20, rare: 5, epic: 1, legendary: 1 } as Record<Rarity, number>,
  chestOffers: [
    { tier: 'gold' as ChestTier, gems: 60 },
    { tier: 'magic' as ChestTier, gems: 150 },
  ],
  cosmeticGemPrice: 80,
  freeGift: { coins: 120 },
  bundles: [
    { id: 'b_small', gems: 80, coins: 800 },
    { id: 'b_medium', gems: 400, coins: 4500 },
    { id: 'b_large', gems: 1200, coins: 15000 },
  ],
};

// ── Cosmetics ────────────────────────────────────────────────────────────────
export interface IconDef {
  id: string;
  emoji: string;
  bg: string;
  name: string;
}
export const ICONS: IconDef[] = [
  { id: 'shield', emoji: '🛡️', bg: '#3b5bdb', name: 'Shield' },
  { id: 'sword', emoji: '⚔️', bg: '#c92a2a', name: 'Swords' },
  { id: 'castle', emoji: '🏰', bg: '#5f3dc4', name: 'Castle' },
  { id: 'knight', emoji: '🤺', bg: '#495057', name: 'Knight' },
  { id: 'wizard', emoji: '🧙', bg: '#7048e8', name: 'Wizard' },
  { id: 'phoenix', emoji: '🐦‍🔥', bg: '#e8590c', name: 'Phoenix' },
  { id: 'dragon', emoji: '🐲', bg: '#2b8a3e', name: 'Dragon' },
  { id: 'crown', emoji: '👑', bg: '#e67700', name: 'Crown' },
  { id: 'skull', emoji: '💀', bg: '#212529', name: 'Skull' },
  { id: 'wolf', emoji: '🐺', bg: '#364fc7', name: 'Wolf' },
  { id: 'owl', emoji: '🦉', bg: '#8f5b2e', name: 'Owl' },
  { id: 'bolt', emoji: '⚡', bg: '#f08c00', name: 'Bolt' },
  { id: 'gem', emoji: '💎', bg: '#1098ad', name: 'Gem' },
  { id: 'fire', emoji: '🔥', bg: '#d9480f', name: 'Fire' },
];
export const STARTER_ICONS = ['shield', 'sword', 'castle'];

export interface EmoteDef {
  id: string;
  emoji: string;
  text: string;
}
export const EMOTES: EmoteDef[] = [
  { id: 'gg', emoji: '🤝', text: 'GG!' },
  { id: 'wow', emoji: '😮', text: 'Wow!' },
  { id: 'laugh', emoji: '😂', text: 'Haha!' },
  { id: 'angry', emoji: '😠', text: 'Grr!' },
  { id: 'fire', emoji: '🔥', text: 'On fire!' },
  { id: 'crown', emoji: '👑', text: 'King me!' },
  { id: 'skull', emoji: '💀', text: 'Rekt' },
  { id: 'clap', emoji: '👏', text: 'Well played' },
  { id: 'cry', emoji: '😭', text: 'Nooo!' },
  { id: 'think', emoji: '🤔', text: 'Hmm...' },
  { id: 'heart', emoji: '❤️', text: 'Thanks!' },
  { id: 'thumbs', emoji: '👍', text: 'Nice!' },
];
export const STARTER_EMOTES = ['gg', 'wow', 'laugh', 'angry'];
export const EMOTE_COOLDOWN_SEC = 3;

// ── Co-op campaign ───────────────────────────────────────────────────────────
export const CAMPAIGN_ORDER: MapId[] = ['greenfield', 'canyon', 'crossroads', 'spiral'];
export const STARS_FOR: Record<'easy' | 'normal' | 'hard', number> = { easy: 1, normal: 2, hard: 3 };
/** stars on the previous map needed to unlock the next */
export const STARS_TO_UNLOCK_NEXT = 2;
export function firstClearReward(mapIndex: number, difficulty: 'easy' | 'normal' | 'hard'): RewardSpec[] {
  const m = 1 + mapIndex * 0.5;
  if (difficulty === 'easy') return [{ type: 'coins', amount: Math.round(150 * m) }];
  if (difficulty === 'normal') return [{ type: 'coins', amount: Math.round(300 * m) }, { type: 'gems', amount: Math.round(20 * m) }];
  return [{ type: 'chest', tier: mapIndex >= 2 ? 'magic' : 'gold' }, { type: 'gems', amount: Math.round(50 * m) }];
}

// ── Starting wallet ─────────────────────────────────────────────────────────
export const STARTING_COINS = 300;
export const STARTING_GEMS = 50;

// ── Ranked bots ──────────────────────────────────────────────────────────────
export const BOT_NAMES = [
  'SirBuildsALot', 'TowerTina', 'MoatMarauder', 'Archibald', 'CannonCarla', 'FrostByte', 'ZapZoe', 'GoblinGary',
  'RampartRuth', 'BarrackBob', 'Catapultz', 'TurretTom', 'Wardenly', 'SiegeSally', 'KeepKeeper', 'ParapetPete',
  'BastionBea', 'Lancelittle', 'MinerMax', 'VenomVic', 'PrismPaula', 'TotemTed', 'MortarMia', 'FlameFinn',
  'GateGuard', 'Oakshield', 'Stonewall', 'IronIvy', 'Ballista', 'Drawbridge', 'Merlon', 'Crenel',
];
/** Card level a bot brings, by arena index (arena-appropriate). */
export const BOT_LEVEL_BY_ARENA = [1, 3, 4, 5, 6, 8, 9];

export function rewardLabel(r: RewardSpec): string {
  switch (r.type) {
    case 'coins':
      return `${r.amount} coins`;
    case 'gems':
      return `${r.amount} gems`;
    case 'chest':
      return CHESTS[r.tier].name;
    case 'tower':
      return `Unlock ${r.tower}`;
    case 'troop':
      return `Unlock ${r.troop}`;
    case 'icon':
      return 'Profile icon';
    case 'emote':
      return 'Emote';
    case 'arena':
      return ARENAS[r.arena].name;
    case 'cards':
      return `${r.copies}× ${r.tower}`;
    case 'tokens':
      return `${r.amount} pass tokens`;
  }
}
