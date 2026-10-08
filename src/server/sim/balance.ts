// Fast-forward balance harness (no wall clock). Shared by tests/balance.test.ts and
// scripts/balance.ts.
import type { Difficulty, MapId } from '../../shared/types';
import { TICK_RATE } from '../../shared/config';
import { Bot } from './bot';
import { GameSim, makeRuleset } from './game';

export interface CoopRunOptions {
  mapId: MapId;
  difficulty: Difficulty;
  players: number;
  doNothing?: boolean;
  seed?: number;
  skill?: number;
  /** safety cap in simulated seconds */
  maxSeconds?: number;
}

export interface CoopRunResult {
  mapId: MapId;
  difficulty: Difficulty;
  players: number;
  won: boolean;
  /** waves fully survived (final wave if won) */
  survived: number;
  finalWave: number;
  livesLeft: number;
  simSeconds: number;
  towers: number;
}

export function runCoop(opts: CoopRunOptions): CoopRunResult {
  const rules = makeRuleset('coop', opts.mapId, opts.difficulty);
  const inits = Array.from({ length: opts.players }, (_, i) => ({ id: `bot${i}`, name: `Bot ${i + 1}`, colorIndex: i, team: 0 }));
  const sim = new GameSim(rules, inits);
  const bots = opts.doNothing ? [] : inits.map((p, i) => new Bot(sim, p.id, { seed: (opts.seed ?? 1) * 101 + i, skill: opts.skill ?? 1 }));
  const maxTicks = (opts.maxSeconds ?? 3 * 3600) * TICK_RATE;
  while (sim.phase !== 'over' && sim.tick < maxTicks) {
    const steps = sim.speed;
    for (let s = 0; s < steps; s++) sim.step();
    for (const b of bots) b.update();
  }
  const r = sim.result;
  return {
    mapId: opts.mapId,
    difficulty: opts.difficulty,
    players: opts.players,
    won: r?.outcome === 'victory',
    survived: r ? r.wavesSurvived : sim.wave,
    finalWave: rules.finalWave ?? 0,
    livesLeft: sim.boards[0].lives,
    simSeconds: Math.round(sim.time),
    towers: sim.boards[0].towers.length,
  };
}
