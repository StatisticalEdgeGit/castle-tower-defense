// Fast-forward balance checks with the greedy bot (no wall clock).
import { describe, expect, it } from 'vitest';
import { runCoop } from '../src/server/sim/balance';

describe('co-op balance (Greenfield, Normal)', () => {
  const solo = runCoop({ mapId: 'greenfield', difficulty: 'normal', players: 1 });
  const quad = runCoop({ mapId: 'greenfield', difficulty: 'normal', players: 4 });
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
