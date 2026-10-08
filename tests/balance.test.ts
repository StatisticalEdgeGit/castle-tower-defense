// Fast-forward balance checks with the headless bot (no wall clock). Seeded → deterministic.
import { describe, expect, it } from 'vitest';
import { STARTER_TOWERS } from '../src/shared/progression';
import { duelSeries, runCoop } from '../src/server/sim/balance';

describe('co-op balance (Greenfield, Normal, starter loadout)', () => {
  const loadout = STARTER_TOWERS;
  const solo = runCoop({ mapId: 'greenfield', difficulty: 'normal', players: 1, loadout });
  const quad = runCoop({ mapId: 'greenfield', difficulty: 'normal', players: 4, loadout });
  const idle = runCoop({ mapId: 'greenfield', difficulty: 'normal', players: 1, doNothing: true });

  it('a greedy bot survives at least wave 12 alone', () => {
    expect(solo.survived).toBeGreaterThanOrEqual(12);
  });

  it('four greedy bots survive at least wave 12 together', () => {
    expect(quad.survived).toBeGreaterThanOrEqual(12);
  });

  it('a player who does nothing loses by about wave 5', () => {
    expect(idle.won).toBe(false);
    expect(idle.survived + 1).toBeLessThanOrEqual(5);
  });

  it('1-player and 4-player outcomes are within a fair band', () => {
    expect(Math.abs(solo.survived - quad.survived)).toBeLessThanOrEqual(4);
  });
});

describe('ranked bot-vs-bot (ranked rules, sending bots)', () => {
  it('equal card levels are close to a coin flip', () => {
    const s = duelSeries(40, 5, 5);
    expect(s.winRate).toBeGreaterThanOrEqual(0.25);
    expect(s.winRate).toBeLessThanOrEqual(0.75);
    // matches are snappy (~6–9 minutes)
    expect(s.avgMinutes).toBeGreaterThan(4);
    expect(s.avgMinutes).toBeLessThan(11);
  });

  it('+3 card levels win noticeably more often, but not always', () => {
    const s = duelSeries(40, 8, 5);
    expect(s.winRate).toBeGreaterThanOrEqual(0.6);
    expect(s.winRate).toBeLessThan(1);
  });
});
