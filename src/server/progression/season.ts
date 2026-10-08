// Seasons (28 days): soft trophy reset, season-end rewards by peak arena, pass reset and an
// archive of the last season's top 3. Server-wide state lives in db.data.meta.
import { ARENAS, arenaForTrophies, SEASON, SEASON_END_REWARD } from '../../shared/progression';
import type { MapId } from '../../shared/types';
import type { JsonDb } from '../db';
import { normalizeProfile, type Clock, type Profile } from './profile';
import { softReset } from './trophies';

export interface SeasonMeta {
  id: number;
  startedAt: number;
  endsAt: number;
}
export interface Top3Entry {
  userId: string;
  name: string;
  icon: string;
  trophies: number;
}
export interface EndlessEntry {
  key: string;
  mapId: MapId;
  players: { id: string; name: string }[];
  wave: number;
  season: number;
  at: number;
}
export interface ProgMeta {
  season: SeasonMeta;
  lastTop3: { season: number; duel: Top3Entry[]; team: Top3Entry[] } | null;
  endless: EndlessEntry[];
}

const DAY = 86_400_000;

export function getMeta(db: JsonDb, clock: Clock): ProgMeta {
  const m = db.data.meta as { prog?: ProgMeta };
  if (!m.prog) {
    const now = clock.now();
    m.prog = { season: { id: 1, startedAt: now, endsAt: now + SEASON.lengthDays * DAY }, lastTop3: null, endless: [] };
    db.save();
  }
  return m.prog;
}

export function profileOf(db: JsonDb, userId: string, clock: Clock): Profile | null {
  const u = db.userById(userId);
  if (!u) return null;
  const meta = getMeta(db, clock);
  const p = normalizeProfile(u.progression as Partial<Profile>, meta.season.id);
  u.progression = p as unknown as Record<string, unknown>;
  return p;
}

function top3(db: JsonDb, ladder: 'duel' | 'team', clock: Clock): Top3Entry[] {
  return Object.values(db.data.users)
    .map((u) => ({ u, p: normalizeProfile(u.progression as Partial<Profile>, getMeta(db, clock).season.id) }))
    .filter(({ p }) => p[ladder] > 0)
    .sort((a, b) => b.p[ladder] - a.p[ladder] || a.u.username.localeCompare(b.u.username))
    .slice(0, 3)
    .map(({ u, p }) => ({ userId: u.id, name: u.username, icon: p.icon, trophies: p[ladder] }));
}

/** End the current season now: archive, reward, soft-reset, reset the pass. */
export function endSeason(db: JsonDb, clock: Clock): { ended: number; started: number } {
  const meta = getMeta(db, clock);
  const ended = meta.season.id;
  meta.lastTop3 = { season: ended, duel: top3(db, 'duel', clock), team: top3(db, 'team', clock) };
  const next = ended + 1;
  for (const u of Object.values(db.data.users)) {
    const p = normalizeProfile(u.progression as Partial<Profile>, ended);
    const peak = Math.max(p.seasonPeakArena, arenaForTrophies(Math.max(p.duel, p.team)));
    const reward = SEASON_END_REWARD[Math.min(peak, SEASON_END_REWARD.length - 1)];
    const duelBefore = p.duel;
    const teamBefore = p.team;
    p.coins += reward.coins;
    p.gems += reward.gems;
    p.duel = softReset(p.duel, SEASON.softResetAbove, SEASON.softResetKeep);
    p.team = softReset(p.team, SEASON.softResetAbove, SEASON.softResetKeep);
    p.seasonNotice = { season: ended, peakArena: peak, coins: reward.coins, gems: reward.gems, duelBefore, duelAfter: p.duel, teamBefore, teamAfter: p.team };
    p.seasonId = next;
    p.seasonPeakArena = arenaForTrophies(Math.max(p.duel, p.team));
    p.pass = { season: next, tokens: 0, premium: false, claimedFree: [], claimedPremium: [] };
    u.progression = p as unknown as Record<string, unknown>;
  }
  const now = clock.now();
  meta.season = { id: next, startedAt: now, endsAt: now + SEASON.lengthDays * DAY };
  db.save();
  return { ended, started: next };
}

/** End the season if its time is up. Returns true if a season ended. */
export function checkSeason(db: JsonDb, clock: Clock): boolean {
  const meta = getMeta(db, clock);
  if (clock.now() >= meta.season.endsAt) {
    endSeason(db, clock);
    return true;
  }
  return false;
}

export function seasonArenaName(i: number): string {
  return ARENAS[i]?.name ?? '?';
}
