/**
 * ALL balance numbers live in this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  BALANCING MODEL  ("more defenders on a board ⇒ proportionally more of everything")
 * ─────────────────────────────────────────────────────────────────────────────
 *  Let k = number of players defending one board (co-op: everyone; 2v2: the team;
 *  FFA: always 1).  defenderScale(k) = 1 + 0.6·(k−1)   → 1.0, 1.6, 2.2, 2.8
 *
 *  Threat on a board with k defenders
 *   • AI wave enemy COUNT   × defenderScale(k)   (spawn spacing ÷ defenderScale(k), so a
 *                                                 wave lasts the same time, just denser)
 *   • enemy HP              × (1 + 0.05·(k−1))  small "coordination tax"
 *   • troops SENT to board  × defenderScale(k)   ← "armies sent are slightly bigger when
 *                                                    you're with each other"
 *     Counts are rounded (1 boss × 1.6 → 2); each unit's HP is multiplied by
 *     exact/rounded (here 0.8) so the TOTAL HP is exactly defenderScale(k) × solo.
 *   • board LIVES           × defenderScale(k)   (rounded) — k players face ds(k)× as many
 *     enemies, so the same leak *fraction* costs the same fraction of lives. Without this
 *     a 4-player co-op board would be 2.8× more fragile than a solo one.
 *
 *  Resources on a board with k defenders
 *   • kill bounty goes into a pot split evenly between the k defenders, so team
 *     bounty income = bounty × enemyCount, which already scales by defenderScale(k)
 *   • start cash per player     = soloStart        × defenderScale(k) / k
 *   • wave bonus per player     = soloBonus(wave)  × defenderScale(k) / k
 *  ⇒ total team resources scale exactly with the enemy count, and a dollar spent on
 *    sending buys the same "threat per defending dollar" no matter the team size, so
 *    2v2 and FFA stay symmetric.
 *
 *  Sent troops pay only `sentBountyFactor` (50%) of their bounty to the defender (sending
 *  is not a gift), and every send permanently raises the sender's per-wave INCOME
 *  (paid at each wave start on top of the wave bonus): classic eco-vs-defence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Difficulty, EnemyType, GameMode, MapId, PackId, TargetMode, TowerType } from './types';

// ── Simulation / grid ────────────────────────────────────────────────────────
export const TICK_RATE = 20; // sim steps per second
export const DT = 1 / TICK_RATE; // 0.05 s
export const GRID_W = 24;
export const GRID_H = 14;
export const MAX_PLAYERS = 4;

// ── Scaling model ────────────────────────────────────────────────────────────
export const SCALING = {
  /** extra enemies / sends / economy per additional defender */
  perExtraDefender: 0.6,
  /** extra enemy HP per additional defender ("coordination tax") */
  hpTaxPerExtraDefender: 0.05,
};

/** 1 → 1.0, 2 → 1.6, 3 → 2.2, 4 → 2.8 */
export function defenderScale(k: number): number {
  const n = Math.max(1, k);
  return 1 + SCALING.perExtraDefender * (n - 1);
}

/** 1 → 1.00, 2 → 1.05, 3 → 1.10, 4 → 1.15 */
export function defenderHpScale(k: number): number {
  const n = Math.max(1, k);
  return 1 + SCALING.hpTaxPerExtraDefender * (n - 1);
}

// ── Difficulty ───────────────────────────────────────────────────────────────
export interface DifficultyDef {
  label: string;
  hpMult: number;
  lives: number;
  startCashMult: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { label: 'Easy', hpMult: 0.8, lives: 40, startCashMult: 1.2 },
  normal: { label: 'Normal', hpMult: 1.0, lives: 25, startCashMult: 1.0 },
  hard: { label: 'Hard', hpMult: 1.3, lives: 15, startCashMult: 0.9 },
};

// ── Economy ──────────────────────────────────────────────────────────────────
export const ECONOMY = {
  /** start cash for a single defender on Normal */
  soloStartCash: 600,
  /** soloBonus(w) = waveBonusBase + waveBonusPerWave · w */
  waveBonusBase: 50,
  waveBonusPerWave: 8,
  /** fraction of bounty paid for killing troops that an opponent sent */
  sentBountyFactor: 0.5,
  /** fraction of total invested money refunded on sell */
  sellRefund: 0.7,
  /** everyone pressing "Ready" during the co-op countdown pays this × the wave bonus */
  earlyCallBonusFactor: 0.1,
  maxMinesPerPlayer: 3,
  startingIncome: 0,
};

export function soloWaveBonus(wave: number): number {
  return ECONOMY.waveBonusBase + ECONOMY.waveBonusPerWave * Math.max(1, wave);
}

/** Start cash for each player on a board with k defenders. */
export function startCashPerPlayer(k: number, difficulty: Difficulty): number {
  return Math.round((ECONOMY.soloStartCash * DIFFICULTY[difficulty].startCashMult * defenderScale(k)) / k);
}

/** End-of-wave bonus for each player on a board with k defenders. */
export function waveBonusPerPlayer(wave: number, k: number): number {
  return (soloWaveBonus(wave) * defenderScale(k)) / k;
}

// ── Timing (seconds) ─────────────────────────────────────────────────────────
export const TIMING = {
  coopFirstWave: 20,
  coopBetweenWaves: 10,
  versusFirstWave: 25,
  versusWaveInterval: 30,
  /** "INCOMING" warning before sent troops appear */
  sendWarning: 2,
  /** spacing between sent units of one pack (divided by defenderScale of the target) */
  sendSpacing: 0.45,
  /** keep a disconnected player's slot this long (in a running match) */
  reconnectGraceMatch: 60,
  /** keep a disconnected player's slot this long (waiting lobby) */
  reconnectGraceLobby: 20,
  inviteTtl: 60,
  /** max simulated speed multiplier (co-op ×2 when everyone votes) */
  fastSpeed: 2,
};

// ── Towers ───────────────────────────────────────────────────────────────────
export interface TowerLevel {
  /** price of this level (level 1 = build cost, others = upgrade cost) */
  cost: number;
  damage: number;
  /** shots per second */
  rate: number;
  /** tiles */
  range: number;
  splash?: number;
  slow?: number;
  slowDuration?: number;
  /** tesla: total number of targets hit (including the first) */
  chains?: number;
  /** frost L3: hits every enemy in range */
  pulse?: boolean;
  /** gold mine: paid to owner at each wave start */
  income?: number;
  /** flamethrower: cone half-angle in degrees */
  cone?: number;
  /** burn damage over time (ignores armor; refreshes, does not stack) */
  burnDps?: number;
  burnTime?: number;
  /** mortar: cannot hit enemies closer than this */
  minRange?: number;
  /** venom: poison damage per stack per second (ignores armor) */
  poisonDps?: number;
  poisonMaxStacks?: number;
  poisonTime?: number;
  /** prism: damage multiplier gained per second on the same target, and its cap */
  rampPerSec?: number;
  rampMax?: number;
  /** war totem: buff radius and buff amounts for nearby towers */
  buffRadius?: number;
  buffDmg?: number;
  buffRate?: number;
}

export interface TowerDef {
  type: TowerType;
  name: string;
  blurb: string;
  hotkey: string;
  attacks: boolean;
  ignoresArmor?: boolean;
  /** cannon shell speed (tiles/s); undefined → instant hit */
  projectileSpeed?: number;
  /** tesla damage falloff per jump */
  chainFalloff?: number;
  /** tesla: max distance between consecutive chain targets */
  chainRange?: number;
  /** shells home on their target (cannon) or fly to where it was (mortar) */
  homing?: boolean;
  /** continuous beam (prism) */
  beam?: boolean;
  /** support tower that buffs neighbours (war totem) */
  support?: boolean;
  levels: [TowerLevel, TowerLevel, TowerLevel];
}

export const TOWERS: Record<TowerType, TowerDef> = {
  archer: {
    type: 'archer',
    name: 'Archer',
    blurb: 'Fast single-target shots.',
    hotkey: '1',
    attacks: true,
    levels: [
      { cost: 100, damage: 10, rate: 2.0, range: 3.0 },
      // L2 clears knight armor (8). L1 sits on the 20% damage floor against them.
      { cost: 90, damage: 18, rate: 2.4, range: 3.3 },
      { cost: 200, damage: 28, rate: 3.0, range: 3.6 },
    ],
  },
  cannon: {
    type: 'cannon',
    name: 'Cannon',
    blurb: 'Slow shells that explode on impact.',
    hotkey: '2',
    attacks: true,
    projectileSpeed: 7,
    homing: true,
    levels: [
      { cost: 200, damage: 30, rate: 0.7, range: 2.8, splash: 1.0 },
      // L2 is the group-clear step: the blast grows more than the raw shot.
      { cost: 180, damage: 50, rate: 0.85, range: 2.9, splash: 1.45 },
      { cost: 350, damage: 85, rate: 0.95, range: 3.0, splash: 1.65 },
    ],
  },
  frost: {
    type: 'frost',
    name: 'Frost',
    blurb: 'Chills enemies. Slows never stack.',
    hotkey: '3',
    attacks: true,
    levels: [
      { cost: 150, damage: 4, rate: 1.2, range: 2.5, slow: 0.35, slowDuration: 1.5 },
      { cost: 120, damage: 6, rate: 1.2, range: 2.6, slow: 0.45, slowDuration: 1.5, splash: 0.8 },
      { cost: 250, damage: 9, rate: 1.2, range: 2.8, slow: 0.55, slowDuration: 1.6, pulse: true },
    ],
  },
  sniper: {
    type: 'sniper',
    name: 'Sniper',
    blurb: 'Huge range, ignores armor.',
    hotkey: '4',
    attacks: true,
    ignoresArmor: true,
    levels: [
      { cost: 300, damage: 90, rate: 0.45, range: 7 },
      // L2 picks up rate and a little reach. L3 is still the damage spike.
      { cost: 250, damage: 150, rate: 0.52, range: 7.2 },
      { cost: 500, damage: 280, rate: 0.55, range: 7.5 },
    ],
  },
  tesla: {
    type: 'tesla',
    name: 'Tesla',
    blurb: 'Lightning that chains between enemies.',
    hotkey: '5',
    attacks: true,
    chainFalloff: 0.2,
    chainRange: 1.8,
    levels: [
      { cost: 350, damage: 22, rate: 1.2, range: 2.6, chains: 3 },
      { cost: 300, damage: 30, rate: 1.2, range: 2.6, chains: 5 },
      { cost: 550, damage: 45, rate: 1.5, range: 2.8, chains: 7 },
    ],
  },
  mine: {
    type: 'mine',
    name: 'Gold Mine',
    blurb: 'Pays its owner every wave. Max 3.',
    hotkey: '6',
    attacks: false,
    levels: [
      // Each upgrade pays back faster than opening another level-1 mine.
      { cost: 250, damage: 0, rate: 0, range: 0, income: 42 },
      { cost: 220, damage: 0, rate: 0, range: 0, income: 100 },
      { cost: 380, damage: 0, rate: 0, range: 0, income: 175 },
    ],
  },
  flame: {
    type: 'flame',
    name: 'Flamethrower',
    blurb: 'Short-range cone that sets enemies ablaze. Melts swarms.',
    hotkey: '',
    attacks: true,
    levels: [
      { cost: 200, damage: 3, rate: 5, range: 2.0, cone: 35, burnDps: 6, burnTime: 2 },
      { cost: 170, damage: 5, rate: 5, range: 2.2, cone: 35, burnDps: 10, burnTime: 2 },
      { cost: 330, damage: 8, rate: 6, range: 2.4, cone: 40, burnDps: 16, burnTime: 2.5 },
    ],
  },
  mortar: {
    type: 'mortar',
    name: 'Mortar',
    blurb: 'Huge range and splash, but slow and cannot hit up close.',
    hotkey: '',
    attacks: true,
    projectileSpeed: 6,
    homing: false,
    levels: [
      { cost: 275, damage: 60, rate: 0.35, range: 8, minRange: 2, splash: 1.6 },
      { cost: 250, damage: 100, rate: 0.4, range: 8, minRange: 2, splash: 1.8 },
      { cost: 450, damage: 170, rate: 0.45, range: 9, minRange: 2, splash: 2.0 },
    ],
  },
  venom: {
    type: 'venom',
    name: 'Venom',
    blurb: 'Stacking poison that ignores armor.',
    hotkey: '',
    attacks: true,
    levels: [
      { cost: 250, damage: 3, rate: 1.5, range: 3.0, poisonDps: 5, poisonMaxStacks: 4, poisonTime: 3 },
      { cost: 220, damage: 4, rate: 1.7, range: 3.0, poisonDps: 7, poisonMaxStacks: 5, poisonTime: 3 },
      { cost: 420, damage: 6, rate: 2.0, range: 3.3, poisonDps: 10, poisonMaxStacks: 6, poisonTime: 3.5 },
    ],
  },
  prism: {
    type: 'prism',
    name: 'Prism',
    blurb: 'A beam that ramps up the longer it holds one target. Ignores armor. Boss killer.',
    hotkey: '',
    attacks: true,
    beam: true,
    levels: [
      { cost: 400, damage: 18, rate: 1, range: 3.2, rampPerSec: 0.5, rampMax: 4 },
      { cost: 350, damage: 28, rate: 1, range: 3.2, rampPerSec: 0.6, rampMax: 5 },
      { cost: 600, damage: 42, rate: 1, range: 3.5, rampPerSec: 0.7, rampMax: 6 },
    ],
  },
  totem: {
    type: 'totem',
    name: 'War Totem',
    blurb: 'Buffs nearby towers: more damage and fire rate. Buffs from several totems do not stack.',
    hotkey: '',
    attacks: false,
    support: true,
    levels: [
      { cost: 225, damage: 0, rate: 0, range: 2, buffRadius: 2, buffDmg: 0.15, buffRate: 0.1 },
      { cost: 200, damage: 0, rate: 0, range: 2.5, buffRadius: 2.5, buffDmg: 0.2, buffRate: 0.12 },
      { cost: 350, damage: 0, rate: 0, range: 3, buffRadius: 3, buffDmg: 0.25, buffRate: 0.15 },
    ],
  },
};

export const TARGET_MODE_LABEL: Record<TargetMode, string> = {
  first: 'First',
  last: 'Last',
  strong: 'Strongest',
  close: 'Closest',
};

/** Total money invested to reach `level` (1-based). */
export function towerInvested(type: TowerType, level: number): number {
  let sum = 0;
  for (let i = 0; i < level; i++) sum += TOWERS[type].levels[i].cost;
  return sum;
}

// ── Enemies ──────────────────────────────────────────────────────────────────
export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  /** tiles per second */
  speed: number;
  /** flat damage reduction per hit (min damage = armorMinFraction of the hit) */
  armor: number;
  bounty: number;
  /** lives lost when it leaks */
  lives: number;
  /** visual radius in tiles */
  radius: number;
  /** 0..1, fraction of slow effect ignored */
  slowResist?: number;
  /** healer: heals others within this radius (tiles) */
  healRadius?: number;
  /** healer: fraction of target max HP healed per second (does not stack) */
  healPerSec?: number;
  boss?: boolean;
  /** splitter: spawns this many of `splitInto` on death */
  splitInto?: EnemyType;
  splitCount?: number;
  /** shieldbearer: once, shields enemies within shieldRadius for shieldPct of their max HP */
  shieldPct?: number;
  shieldRadius?: number;
  /** path distance travelled before the shield pulse fires */
  shieldTriggerDist?: number;
}

export const ARMOR_MIN_FRACTION = 0.2;

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  grunt: { type: 'grunt', name: 'Grunt', hp: 40, speed: 1.0, armor: 0, bounty: 4, lives: 1, radius: 0.26 },
  runner: { type: 'runner', name: 'Runner', hp: 25, speed: 1.9, armor: 0, bounty: 4, lives: 1, radius: 0.22 },
  swarm: { type: 'swarm', name: 'Swarmling', hp: 12, speed: 1.4, armor: 0, bounty: 1, lives: 1, radius: 0.15 },
  knight: { type: 'knight', name: 'Knight', hp: 120, speed: 0.85, armor: 8, bounty: 12, lives: 2, radius: 0.3 },
  brute: { type: 'brute', name: 'Brute', hp: 220, speed: 0.6, armor: 4, bounty: 15, lives: 3, radius: 0.36 },
  healer: {
    type: 'healer',
    name: 'Healer',
    hp: 90,
    speed: 0.9,
    armor: 0,
    bounty: 10,
    lives: 1,
    radius: 0.26,
    healRadius: 1.5,
    healPerSec: 0.02,
  },
  warlord: {
    type: 'warlord',
    name: 'Warlord',
    hp: 2500,
    speed: 0.45,
    armor: 6,
    bounty: 150,
    lives: 20,
    radius: 0.48,
    slowResist: 0.5,
    boss: true,
  },
  splitter: { type: 'splitter', name: 'Splitter', hp: 150, speed: 0.9, armor: 2, bounty: 8, lives: 2, radius: 0.3, splitInto: 'splitling', splitCount: 3 },
  splitling: { type: 'splitling', name: 'Splitling', hp: 22, speed: 1.7, armor: 0, bounty: 1, lives: 1, radius: 0.15 },
  shield: {
    type: 'shield',
    name: 'Shieldbearer',
    hp: 170,
    speed: 0.8,
    armor: 3,
    bounty: 12,
    lives: 2,
    radius: 0.3,
    shieldPct: 0.3,
    shieldRadius: 1.6,
    shieldTriggerDist: 2,
  },
};

/** Per-wave HP growth.  Accelerates after `lateWave` so long versus games end. */
export const HP_GROWTH = {
  linear: 0.12,
  exponential: 1.03,
  lateWave: 30,
  lateExponential: 1.1,
};

export function waveHpMultiplier(wave: number): number {
  const w = Math.max(1, wave);
  let m = (1 + HP_GROWTH.linear * (w - 1)) * Math.pow(HP_GROWTH.exponential, w - 1);
  if (w > HP_GROWTH.lateWave) m *= Math.pow(HP_GROWTH.lateExponential, w - HP_GROWTH.lateWave);
  return m;
}

// ── Wave generator tuning (see waves.ts) ─────────────────────────────────────
export const WAVES = {
  seed: 0x5eed,
  /** budget(w) in "grunt points" = base + linear·(w−1) + quad·(w−1)² */
  budgetBase: 8,
  budgetLinear: 2.2,
  budgetQuad: 0.04,
  /** point cost of one unit of each type */
  points: { grunt: 1, runner: 1, swarm: 0.35, knight: 3.5, brute: 5, healer: 3, warlord: 0, splitter: 3, splitling: 0.3, shield: 4 } as Record<EnemyType, number>,
  /** first wave each type can appear in AI waves (splitters / shieldbearers are troop cards only) */
  unlock: { grunt: 1, runner: 3, swarm: 5, brute: 7, knight: 12, healer: 15, warlord: 10, splitter: 9999, splitling: 9999, shield: 9999 } as Record<EnemyType, number>,
  /** seconds between units in a group (divided by defenderScale) */
  spacing: { grunt: 0.9, runner: 0.7, swarm: 0.22, knight: 1.2, brute: 1.6, healer: 1.4, warlord: 5, splitter: 1.2, splitling: 0.3, shield: 1.3 } as Record<EnemyType, number>,
  /** max healers in one AI wave for a single defender; leftover budget becomes grunts */
  maxHealers: 4,
  bossEvery: 10,
};

// ── Send packs (versus) ──────────────────────────────────────────────────────
export interface SendPackDef {
  id: PackId;
  name: string;
  units: { type: EnemyType; count: number }[];
  cost: number;
  income: number;
  unlockWave: number;
  cooldown: number;
}

/**
 * Cheap packs return more income per gold (the eco buy). Heavy packs keep
 * their bodies and return less income per gold (the threat buy).
 */
export const SEND_PACKS: Record<PackId, SendPackDef> = {
  grunts: { id: 'grunts', name: '6 Grunts', units: [{ type: 'grunt', count: 6 }], cost: 60, income: 8, unlockWave: 1, cooldown: 3 },
  runners: { id: 'runners', name: '5 Runners', units: [{ type: 'runner', count: 5 }], cost: 90, income: 10, unlockWave: 3, cooldown: 4 },
  swarm: { id: 'swarm', name: '15 Swarmlings', units: [{ type: 'swarm', count: 15 }], cost: 100, income: 12, unlockWave: 5, cooldown: 5 },
  brutes: { id: 'brutes', name: '2 Brutes', units: [{ type: 'brute', count: 2 }], cost: 200, income: 18, unlockWave: 7, cooldown: 6 },
  knights: { id: 'knights', name: '3 Knights', units: [{ type: 'knight', count: 3 }], cost: 250, income: 20, unlockWave: 10, cooldown: 7 },
  healers: {
    id: 'healers',
    name: '2 Healers + 4 Grunts',
    units: [
      { type: 'healer', count: 2 },
      { type: 'grunt', count: 4 },
    ],
    cost: 300,
    income: 22,
    unlockWave: 12,
    cooldown: 8,
  },
  warlord: { id: 'warlord', name: '1 Warlord', units: [{ type: 'warlord', count: 1 }], cost: 1000, income: 70, unlockWave: 18, cooldown: 20 },
  splitters: { id: 'splitters', name: '3 Splitters', units: [{ type: 'splitter', count: 3 }], cost: 220, income: 22, unlockWave: 8, cooldown: 6 },
  shields: {
    id: 'shields',
    name: '2 Shieldbearers + 5 Grunts',
    units: [
      { type: 'shield', count: 2 },
      { type: 'grunt', count: 5 },
    ],
    cost: 280,
    income: 24,
    unlockWave: 11,
    cooldown: 8,
  },
};

// ── Maps: co-op final waves ──────────────────────────────────────────────────
export const COOP_FINAL_WAVE: Record<MapId, number> = {
  greenfield: 20,
  canyon: 25,
  crossroads: 30,
  spiral: 40,
};

// ── Modes ────────────────────────────────────────────────────────────────────
export const MODE_INFO: Record<GameMode, { label: string; short: string; minPlayers: number; maxPlayers: number; blurb: string }> = {
  coop: { label: 'Co-op', short: 'Co-op', minPlayers: 1, maxPlayers: 4, blurb: 'Defend one shared map together against AI waves.' },
  ffa: { label: 'Versus — Free-for-all', short: 'FFA', minPlayers: 2, maxPlayers: 4, blurb: 'Everyone defends their own map and sends troops at each other.' },
  teams: { label: 'Versus — Teams 2v2', short: '2v2', minPlayers: 2, maxPlayers: 4, blurb: 'Each team shares a board and sends troops at the other team.' },
};

// ── Players ──────────────────────────────────────────────────────────────────
export const PLAYER_COLORS = ['#4f8cff', '#ff5d5d', '#3fd27f', '#ffd23f'];
export const PLAYER_COLOR_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];

// ── Networking / anti-spam ───────────────────────────────────────────────────
export const NET = {
  /** token bucket for game intents */
  intentBurst: 30,
  intentPerSecond: 15,
  chatBurst: 5,
  chatPerSecond: 0.6,
  chatMaxLength: 200,
  sessionDays: 30,
};
