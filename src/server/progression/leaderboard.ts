// Leaderboards: Duel and Team trophies, and Endless co-op best wave per map (team entries).
// Only real accounts live in the db, so ranked bots can never appear here.
import type { MapId } from '../../shared/types';
import type { UserRecord } from '../db';
import { currentArena, levelInfo, normalizeProfile, type Profile } from './profile';
import type { EndlessEntry } from './season';

export interface LbRow {
  rank: number;
  userId: string;
  name: string;
  icon: string;
  level: number;
  arena: number;
  value: number;
  players?: { id: string; name: string }[];
}

export interface LbResult {
  rows: LbRow[];
  me: LbRow | null;
}

export const LB_SIZE = 100;

/**
 * @param scope  null = global, otherwise the set of user ids to include (friends + me)
 * @param period 'season' = current trophies, 'all' = highest ever
 */
export function trophyLeaderboard(
  users: UserRecord[],
  ladder: 'duel' | 'team',
  period: 'season' | 'all',
  scope: Set<string> | null,
  viewerId: string | null,
): LbResult {
  const key = period === 'season' ? ladder : ladder === 'duel' ? 'duelBest' : 'teamBest';
  const all = users
    .filter((u) => !scope || scope.has(u.id))
    .map((u) => ({ u, p: normalizeProfile(u.progression as Partial<Profile>) }))
    .filter(({ u, p }) => p[key] > 0 || u.id === viewerId)
    .sort((a, b) => b.p[key] - a.p[key] || a.u.username.localeCompare(b.u.username))
    .map(({ u, p }, i) => ({
      rank: i + 1,
      userId: u.id,
      name: u.username,
      icon: p.icon,
      level: levelInfo(p.xp).level,
      arena: currentArena(p),
      value: p[key],
    }));
  return { rows: all.slice(0, LB_SIZE), me: all.find((r) => r.userId === viewerId) ?? null };
}

/** Composition key: one entry per distinct set of players. */
export function endlessKey(mapId: MapId, playerIds: string[]): string {
  return `${mapId}|${playerIds.slice().sort().join(',')}`;
}

/** Record an endless run (keeps the best wave per composition and season). */
export function recordEndless(entries: EndlessEntry[], e: Omit<EndlessEntry, 'key'>): boolean {
  const key = endlessKey(e.mapId, e.players.map((p) => p.id)) + `|s${e.season}`;
  const prev = entries.find((x) => x.key === key);
  if (prev && prev.wave >= e.wave) return false;
  if (prev) Object.assign(prev, { ...e, key });
  else entries.push({ ...e, key });
  return true;
}

export function endlessLeaderboard(
  entries: EndlessEntry[],
  mapId: MapId,
  period: 'season' | 'all',
  seasonId: number,
  scope: Set<string> | null,
  viewerId: string | null,
  userLookup: (id: string) => { icon: string; level: number; arena: number } | null,
): LbResult {
  // best per composition across the chosen period
  const best = new Map<string, EndlessEntry>();
  for (const e of entries) {
    if (e.mapId !== mapId) continue;
    if (period === 'season' && e.season !== seasonId) continue;
    if (scope && !e.players.some((p) => scope.has(p.id))) continue;
    const k = endlessKey(e.mapId, e.players.map((p) => p.id));
    const cur = best.get(k);
    if (!cur || e.wave > cur.wave || (e.wave === cur.wave && e.at < cur.at)) best.set(k, e);
  }
  const sorted = [...best.values()].sort((a, b) => b.wave - a.wave || a.at - b.at);
  const rows: LbRow[] = sorted.map((e, i) => {
    const lead = e.players[0];
    const info = userLookup(lead.id);
    return {
      rank: i + 1,
      userId: lead.id,
      name: e.players.map((p) => p.name).join(' & '),
      icon: info?.icon ?? 'shield',
      level: info?.level ?? 1,
      arena: info?.arena ?? 0,
      value: e.wave,
      players: e.players,
    };
  });
  const me = rows.find((r) => r.players?.some((p) => p.id === viewerId)) ?? null;
  return { rows: rows.slice(0, LB_SIZE), me };
}
