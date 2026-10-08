// Everything a finished match grants one account: trophies (ranked), arena unlocks, XP,
// quest progress, pass tokens, a reward drop (wins / co-op victories, daily cap), co-op
// campaign stars + first-clear rewards and endless records.
import type { PlayerMatchStats } from '../../shared/protocol';
import {
  arenaForTrophies,
  CAMPAIGN_ORDER,
  DROPS_PER_DAY,
  firstClearReward,
  MATCH_XP,
  SEASON,
  STARS_FOR,
  TROPHIES,
} from '../../shared/progression';
import type { Difficulty, GameMode, MapId } from '../../shared/types';
import { levelInfo, newId, type Clock, type Profile } from './profile';
import { trackQuests, type MatchMetrics } from './quests';
import { grantReward, grantXp, type Granted } from './rewards';
import { applyTrophies } from './trophies';

export interface PlayerOutcome {
  mode: GameMode;
  mapId: MapId;
  difficulty: Difficulty;
  endless: boolean;
  ranked: 'duel' | 'team' | null;
  vsBot: boolean;
  won: boolean;
  coopVictory: boolean;
  wavesSurvived: number;
  stats: PlayerMatchStats;
  /** ranked: average trophies of the opposing side */
  oppAvg?: number;
}

import type { MatchRewards as SharedMatchRewards } from '../../shared/progProtocol';
export type MatchRewards = Omit<SharedMatchRewards, 'matchId'>;

export function metricsFor(o: PlayerOutcome): MatchMetrics {
  const s = o.stats;
  return {
    played: 1,
    wins: o.won ? 1 : 0,
    rankedWins: o.won && o.ranked ? 1 : 0,
    teamWins: o.won && o.mode === 'teams' ? 1 : 0,
    kills: s.kills,
    sent: s.sent,
    built: s.built,
    builtCannon: s.builtBy?.cannon ?? 0,
    damage: s.damage,
    damageTesla: s.damageBy?.tesla ?? 0,
    damageArcher: s.damageBy?.archer ?? 0,
    coopWave: o.mode === 'coop' ? o.wavesSurvived : 0,
  };
}

export function applyMatchResult(p: Profile, o: PlayerOutcome, clock: Clock): MatchRewards {
  const arenaBefore = p.arenaReached;
  // ── trophies ──
  let trophies: MatchRewards['trophies'] = null;
  if (o.ranked && (!o.vsBot || TROPHIES.botMatchesAwardTrophies)) {
    const ladder = o.ranked;
    const bestKey = ladder === 'duel' ? 'duelBest' : 'teamBest';
    const ch = applyTrophies(p[ladder], p[bestKey], o.oppAvg ?? p[ladder], o.won);
    p[ladder] = ch.after;
    p[bestKey] = ch.best;
    trophies = { ladder, before: ch.before, after: ch.after, delta: ch.delta };
  }
  if (o.ranked) {
    if (o.ranked === 'duel') o.won ? p.ranked.duelWins++ : p.ranked.duelLosses++;
    else o.won ? p.ranked.teamWins++ : p.ranked.teamLosses++;
  }
  const arenaNow = arenaForTrophies(Math.max(p.duel, p.team));
  p.arenaReached = Math.max(p.arenaReached, arenaNow);
  p.seasonPeakArena = Math.max(p.seasonPeakArena, arenaNow);

  // ── xp ──
  const before = levelInfo(p.xp);
  let xp = MATCH_XP.played;
  if (o.won) xp += MATCH_XP.win;
  if (o.ranked) xp += MATCH_XP.ranked;
  if (o.coopVictory) xp += MATCH_XP.coopVictory;
  if (o.mode === 'coop') xp += MATCH_XP.perCoopWave * o.wavesSurvived;
  const levelUps = grantXp(p, xp);
  const after = levelInfo(p.xp);

  // ── pass tokens ──
  const tokens = SEASON.matchTokens + (o.won ? SEASON.winTokens : 0);
  p.pass.tokens += tokens;

  // ── quests ──
  const quests = trackQuests(p, metricsFor(o));

  // ── reward drop ──
  let drop: MatchRewards['drop'] = { granted: false, capped: false, dropId: null, earnedToday: p.drops.earnedToday };
  if (o.won && !o.endless) {
    if (p.drops.earnedToday < DROPS_PER_DAY) {
      const id = newId(p, 'd');
      p.drops.pending.push({ id, source: o.ranked ? 'Ranked win' : o.mode === 'coop' ? 'Co-op victory' : 'Versus win', at: clock.now() });
      p.drops.earnedToday++;
      drop = { granted: true, capped: false, dropId: id, earnedToday: p.drops.earnedToday };
    } else drop = { granted: false, capped: true, dropId: null, earnedToday: p.drops.earnedToday };
  }

  // ── co-op campaign / endless ──
  let stars: MatchRewards['stars'] = null;
  let firstClear: Granted[] | null = null;
  let endlessRecord: number | null = null;
  if (o.mode === 'coop' && !o.endless && o.coopVictory) {
    const prev = p.campaign[o.mapId] ?? 0;
    const got = STARS_FOR[o.difficulty];
    p.campaign[o.mapId] = Math.max(prev, got);
    stars = { mapId: o.mapId, before: prev, after: p.campaign[o.mapId]! };
    const key = `${o.mapId}:${o.difficulty}`;
    if (!p.firstClears.includes(key)) {
      p.firstClears.push(key);
      firstClear = firstClearReward(CAMPAIGN_ORDER.indexOf(o.mapId), o.difficulty).flatMap((r) => grantReward(p, r, 'First clear'));
    }
  }
  if (o.mode === 'coop' && o.endless) {
    const prev = p.endlessBest[o.mapId] ?? 0;
    if (o.wavesSurvived > prev) {
      p.endlessBest[o.mapId] = o.wavesSurvived;
      endlessRecord = o.wavesSurvived;
    }
  }

  return {
    ranked: o.ranked,
    vsBot: o.vsBot,
    won: o.won,
    trophies,
    arena: { before: arenaBefore, after: p.arenaReached, unlocked: p.arenaReached > arenaBefore },
    xp: {
      gained: xp,
      levelBefore: before.level,
      levelAfter: after.level,
      intoBefore: before.into,
      needBefore: before.need,
      intoAfter: after.into,
      needAfter: after.need,
    },
    levelUps,
    tokens,
    quests,
    drop,
    stars,
    firstClear,
    endlessRecord,
  };
}
