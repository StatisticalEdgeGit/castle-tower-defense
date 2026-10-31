// Core shared domain types used by the server simulation, the protocol and the client.

export type GameMode = 'coop' | 'ffa' | 'teams';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type MapId = 'greenfield' | 'canyon' | 'crossroads' | 'spiral';

/** The six classic towers come first: they are the default loadout (hotkeys 1–6). */
export const TOWER_TYPES = ['archer', 'cannon', 'frost', 'sniper', 'tesla', 'mine', 'builder', 'crossbow', 'flame', 'mortar', 'venom', 'prism', 'totem'] as const;
export type TowerType = (typeof TOWER_TYPES)[number];
export const CLASSIC_TOWERS: TowerType[] = ['archer', 'cannon', 'frost', 'sniper', 'tesla', 'mine'];

/** Order matters: the index is the `typeIndex` sent in compact enemy snapshots. */
export const ENEMY_TYPES = [
  // 15 regular enemies (splitlings are spawned by splitters)
  'grunt',
  'runner',
  'swarm',
  'knight',
  'brute',
  'healer',
  'splitter',
  'splitling',
  'shield',
  'raider',
  'golem',
  'shade',
  'bat',
  'harpy',
  'drake',
  // five bosses, in encounter order
  'warlord',
  'titan',
  'stormRoc',
  'colossus',
  'voidDragon',
] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];
export type EnemyMovement = 'ground' | 'air';

/** Bit flags packed into the 6th element of an enemy snapshot tuple. */
export const ENEMY_FLAG = { slowed: 1, shielded: 2, burning: 4, poisoned: 8, attackingTower: 16 } as const;

export const TARGET_MODES = ['first', 'last', 'strong', 'close'] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const PACK_IDS = ['grunts', 'runners', 'swarm', 'brutes', 'knights', 'healers', 'warlord', 'splitters', 'shields'] as const;
export type PackId = (typeof PACK_IDS)[number];
export const CLASSIC_PACKS: PackId[] = ['grunts', 'runners', 'swarm', 'brutes', 'knights', 'healers', 'warlord'];

export type MatchPhase = 'prep' | 'running' | 'between' | 'over';

/** Logged-in identity (account or guest) as seen by clients. */
export interface PublicUser {
  id: string;
  name: string;
  guest: boolean;
  /** true when the account has a password (can log in on another device); unset for guests */
  secured?: boolean;
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  /** key `${mapId}:${difficulty}` -> best wave survived in co-op */
  bestCoop: Record<string, number>;
}

export interface SpawnGroup {
  type: EnemyType;
  count: number;
  /** seconds between consecutive spawns in this group */
  spacing: number;
  /** seconds after wave start when the first unit of this group spawns */
  delay: number;
}

export interface MapDecoration {
  x: number;
  y: number;
  kind: 'rock' | 'tree' | 'water' | 'bush';
}

export interface Point {
  x: number;
  y: number;
}
