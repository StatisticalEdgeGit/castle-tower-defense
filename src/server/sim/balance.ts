// Fast-forward balance harness (no wall clock). Shared by tests/balance.test.ts and
// scripts/balance.ts.
import type { Difficulty, MapId, TowerType } from '../../shared/types';
import { TICK_RATE } from '../../shared/config';
import { RANKED_RULES } from '../../shared/progression';
import { Bot, botLoadout, botProfileForTrophies } from './bot';
import { GameSim, makeRuleset } from './game';

export interface DuelRunOptions {
  seed: number;
  /** card level of seat A / seat B */
  levelA: number;
  levelB: number;
  mapId?: MapId;
  /** trophies used for bot strength + arena (loadout) */
  trophies?: number;
  maxSeconds?: number;
}

export interface DuelRunResult {
  winner: 'A' | 'B' | 'draw' | 'timeout';
  waves: number;
  simSeconds: number;
}

/** One ranked-rules duel between two identical sending bots (only card levels differ). */
export function runRankedDuel(o: DuelRunOptions): DuelRunResult {
  const trophies = o.trophies ?? 1500;
  const prof = botProfileForTrophies(trophies);
  const { towers, troops } = botLoadout(prof.arena);
  const rules = makeRuleset('ffa', o.mapId ?? 'greenfield', RANKED_RULES.difficulty, {
    firstWaveDelay: RANKED_RULES.firstWaveDelay,
    waveInterval: RANKED_RULES.waveInterval,
    escalation: { startWave: RANKED_RULES.escalationStartWave, hpPerWave: RANKED_RULES.escalationHpPerWave },
    ranked: true,
  });
  const levels = (lv: number) => Object.fromEntries(towers.map((t) => [t, lv])) as Partial<Record<TowerType, number>>;
  const sim = new GameSim(rules, [
    { id: 'A', name: 'A', colorIndex: 0, team: 0, loadout: towers, troops, cardLevels: levels(o.levelA), bot: true },
    { id: 'B', name: 'B', colorIndex: 1, team: 1, loadout: towers, troops, cardLevels: levels(o.levelB), bot: true },
  ]);
  const opts = { sends: true, skill: prof.skill, thinkEvery: prof.thinkEvery, aggression: prof.aggression };
  const bots = [new Bot(sim, 'A', { ...opts, seed: o.seed * 2 + 1 }), new Bot(sim, 'B', { ...opts, seed: o.seed * 2 + 2 })];
  const maxTicks = (o.maxSeconds ?? 3600) * TICK_RATE;
  while (sim.phase !== 'over' && sim.tick < maxTicks) {
    sim.step();
    for (const b of bots) b.update();
  }
  const r = sim.result;
  let winner: DuelRunResult['winner'] = 'timeout';
  if (r) winner = r.winners.length === 1 ? (r.winners[0] as 'A' | 'B') : 'draw';
  return { winner, waves: sim.wave, simSeconds: Math.round(sim.time) };
}

export interface DuelStats {
  games: number;
  /** win rate of the "favoured" side (seat-alternated), draws count half */
  winRate: number;
  draws: number;
  avgMinutes: number;
  avgWaves: number;
}

/** N duels alternating seats; `levelFav` is the level of the side whose win rate is reported. */
export function duelSeries(n: number, levelFav: number, levelOther: number, maps: MapId[] = ['greenfield', 'canyon', 'crossroads', 'spiral']): DuelStats {
  let wins = 0;
  let draws = 0;
  let secs = 0;
  let waves = 0;
  for (let i = 0; i < n; i++) {
    const favIsA = i % 2 === 0;
    const r = runRankedDuel({ seed: 1000 + i, levelA: favIsA ? levelFav : levelOther, levelB: favIsA ? levelOther : levelFav, mapId: maps[i % maps.length] });
    const fav = favIsA ? 'A' : 'B';
    if (r.winner === fav) wins++;
    else if (r.winner === 'draw' || r.winner === 'timeout') draws++;
    secs += r.simSeconds;
    waves += r.waves;
  }
  return { games: n, winRate: (wins + draws / 2) / n, draws, avgMinutes: secs / n / 60, avgWaves: waves / n };
}

export interface CoopRunOptions {
  mapId: MapId;
  difficulty: Difficulty;
  players: number;
  doNothing?: boolean;
  seed?: number;
  skill?: number;
  /** towers each bot may use (default: the classic six) */
  loadout?: TowerType[];
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
  const inits = Array.from({ length: opts.players }, (_, i) => ({ id: `bot${i}`, name: `Bot ${i + 1}`, colorIndex: i, team: 0, loadout: opts.loadout }));
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
