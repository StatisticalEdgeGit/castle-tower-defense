// Core shared domain types used by the server simulation, the protocol and the client.

export type GameMode = 'coop' | 'ffa' | 'teams';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type MapId = 'greenfield' | 'canyon' | 'crossroads' | 'spiral';

export const TOWER_TYPES = ['archer', 'cannon', 'frost', 'sniper', 'tesla', 'mine'] as const;
export type TowerType = (typeof TOWER_TYPES)[number];

/** Order matters: the index is the `typeIndex` sent in compact enemy snapshots. */
export const ENEMY_TYPES = ['grunt', 'runner', 'swarm', 'knight', 'brute', 'healer', 'warlord'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export const TARGET_MODES = ['first', 'last', 'strong', 'close'] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const PACK_IDS = ['grunts', 'runners', 'swarm', 'brutes', 'knights', 'healers', 'warlord'] as const;
export type PackId = (typeof PACK_IDS)[number];

export type MatchPhase = 'prep' | 'running' | 'between' | 'over';

/** Logged-in identity (account or guest) as seen by clients. */
export interface PublicUser {
  id: string;
  name: string;
  guest: boolean;
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
