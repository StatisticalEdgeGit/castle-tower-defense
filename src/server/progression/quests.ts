// Daily (3, local-midnight rollover, 1 free reroll) and weekly (3) quests, plus the daily
// rollover of reward-drop counters and the shop.
import {
  DAILY_QUEST_COUNT,
  DAILY_QUESTS,
  FREE_REROLLS_PER_DAY,
  WEEKLY_QUEST_COUNT,
  WEEKLY_QUESTS,
  type QuestDef,
  type QuestMetric,
} from '../../shared/progression';
import { hashSeed, mulberry32 } from '../../shared/rng';
import { generateOffers, grantXp, type Granted, type LevelUp, type Res } from './rewards';
import { dayKey, hashString, profileRng, weekKey, type Clock, type Profile, type QuestState } from './profile';

const ALL_QUESTS = new Map<string, QuestDef>([...DAILY_QUESTS, ...WEEKLY_QUESTS].map((q) => [q.id, q]));
export function questDef(id: string): QuestDef | undefined {
  return ALL_QUESTS.get(id);
}

function pickQuests(pool: QuestDef[], n: number, seed: number, exclude: string[] = []): QuestState[] {
  const rng = mulberry32(seed);
  const opts = pool.filter((q) => !exclude.includes(q.id));
  const out: QuestState[] = [];
  while (out.length < n && opts.length) {
    const i = Math.floor(rng() * opts.length);
    out.push({ id: opts[i].id, progress: 0, claimed: false });
    opts.splice(i, 1);
  }
  return out;
}

/**
 * Daily rollover (quests, rerolls, reward-drop counter, shop) and weekly rollover.
 * Idempotent; call before reading or mutating any daily state.
 */
export function ensureDaily(p: Profile, userId: string, clock: Clock): void {
  const now = clock.now();
  const day = dayKey(now);
  if (p.quests.day !== day) {
    p.quests.day = day;
    p.quests.rerolls = 0;
    p.quests.daily = pickQuests(DAILY_QUESTS, DAILY_QUEST_COUNT, hashSeed(hashString(userId), hashString(day)));
  }
  const week = weekKey(now);
  if (p.quests.week !== week) {
    p.quests.week = week;
    p.quests.weekly = pickQuests(WEEKLY_QUESTS, WEEKLY_QUEST_COUNT, hashSeed(hashString(userId + 'w'), hashString(week)));
  }
  if (p.drops.day !== day) {
    p.drops.day = day;
    p.drops.earnedToday = 0;
  }
  if (p.shop.day !== day) {
    p.shop.day = day;
    p.shop.giftClaimed = false;
    p.shop.offers = generateOffers(p, mulberry32(hashSeed(hashString(userId + 'shop'), hashString(day))));
  }
}

export type MatchMetrics = Record<QuestMetric, number>;

import type { QuestProgress } from '../../shared/progProtocol';
export type { QuestProgress };

/** Apply one match's metrics to all open quests. */
export function trackQuests(p: Profile, m: MatchMetrics): QuestProgress[] {
  const out: QuestProgress[] = [];
  const apply = (list: QuestState[], weekly: boolean) => {
    for (const q of list) {
      const def = questDef(q.id);
      if (!def || q.claimed) continue;
      const before = q.progress;
      if (before >= def.target) continue;
      const v = m[def.metric] ?? 0;
      q.progress = Math.min(def.target, def.mode === 'max' ? Math.max(q.progress, v) : q.progress + v);
      if (q.progress !== before) {
        out.push({ id: q.id, text: def.text, before, after: q.progress, target: def.target, completed: q.progress >= def.target, weekly });
      }
    }
  };
  apply(p.quests.daily, false);
  apply(p.quests.weekly, true);
  return out;
}

export function claimQuest(p: Profile, questId: unknown): Res<{ granted: Granted[]; levelUps: LevelUp[] }> {
  const q = [...p.quests.daily, ...p.quests.weekly].find((x) => x.id === questId);
  const def = typeof questId === 'string' ? questDef(questId) : undefined;
  if (!q || !def) return fail('Quest not found');
  if (q.claimed) return fail('Already claimed');
  if (q.progress < def.target) return fail('Quest not complete yet');
  q.claimed = true;
  p.coins += def.coins;
  p.pass.tokens += def.tokens;
  const levelUps = grantXp(p, def.xp);
  return {
    ok: true,
    granted: [
      { kind: 'coins', amount: def.coins },
      { kind: 'xp', amount: def.xp },
      { kind: 'tokens', amount: def.tokens },
    ],
    levelUps,
  };
}

export function rerollQuest(p: Profile, userId: string, questId: unknown): Res<{ quest: QuestState }> {
  const i = p.quests.daily.findIndex((q) => q.id === questId);
  if (i < 0) return fail('Only daily quests can be rerolled');
  if (p.quests.rerolls >= FREE_REROLLS_PER_DAY) return fail('No rerolls left today');
  if (p.quests.daily[i].claimed) return fail('Quest already claimed');
  const rng = profileRng(userId, p, 'reroll');
  const [fresh] = pickQuests(DAILY_QUESTS, 1, Math.floor(rng() * 2 ** 31), p.quests.daily.map((q) => q.id));
  if (!fresh) return fail('No other quests available');
  p.quests.daily[i] = fresh;
  p.quests.rerolls++;
  return { ok: true, quest: fresh };
}

export function claimableQuests(p: Profile): string[] {
  return [...p.quests.daily, ...p.quests.weekly]
    .filter((q) => {
      const d = questDef(q.id);
      return d && !q.claimed && q.progress >= d.target;
    })
    .map((q) => q.id);
}

function fail(error: string) {
  return { ok: false as const, error };
}
