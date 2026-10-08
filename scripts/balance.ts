// `npm run balance` — fast-forward balance runs with the headless bot.
//  1. Co-op: players × difficulty × waves survived (per map), starter loadout + classic six.
//  2. Ranked bot-vs-bot duels under ranked rules: win rate by card-level difference.
//  Flags: --all-maps (co-op on every map), --games N (ranked games per row, default 80),
//         --skip-coop / --skip-ranked
import { DIFFICULTY } from '../src/shared/config';
import { MAP_IDS, MAPS } from '../src/shared/maps';
import { STARTER_TOWERS } from '../src/shared/progression';
import type { Difficulty, TowerType } from '../src/shared/types';
import { CLASSIC_TOWERS } from '../src/shared/types';
import { duelSeries, runCoop } from '../src/server/sim/balance';

const difficulties: Difficulty[] = ['easy', 'normal', 'hard'];
const args = process.argv.slice(2);
const maps = args.includes('--all-maps') ? MAP_IDS : (['greenfield'] as const);
const gamesArg = args.indexOf('--games');
const games = gamesArg >= 0 ? Number(args[gamesArg + 1]) || 80 : 80;
const t0 = Date.now();

function coopTable(label: string, loadout: TowerType[]) {
  for (const mapId of maps) {
    const map = MAPS[mapId];
    console.log(`\nCo-op balance — ${map.name} (final wave ${map.finalWave}), one greedy bot per player, ${label}`);
    const header = ['players', ...difficulties.map((d) => DIFFICULTY[d].label.padStart(14))];
    console.log(header.join(' | '));
    console.log('-'.repeat(header.join(' | ').length));
    for (const players of [1, 2, 3, 4]) {
      const cells = difficulties.map((difficulty) => {
        const r = runCoop({ mapId, difficulty, players, loadout });
        const txt = r.won ? `WIN ${r.survived} (${r.livesLeft}♥)` : `lost @${r.survived + 1}`;
        return txt.padStart(14);
      });
      console.log([String(players).padStart(7), ...cells].join(' | '));
    }
    const idle = runCoop({ mapId, difficulty: 'normal', players: 1, doNothing: true });
    console.log(`do-nothing player (Normal): survived ${idle.survived} wave(s), lost on wave ${idle.survived + 1}`);
  }
}

if (!args.includes('--skip-coop')) {
  coopTable('starter loadout (archer, cannon, frost, sniper)', STARTER_TOWERS);
  coopTable('classic six (+ tesla, gold mine)', CLASSIC_TOWERS);
}

if (!args.includes('--skip-ranked')) {
  console.log(`\nRanked bot-vs-bot — Ranked Duel rules (waves every 20 s, ×1.15 HP/wave after 18), ${games} games per row,`);
  console.log('seats alternated, maps rotated, both bots send troops; only card levels differ.');
  const header = ['matchup', 'favoured win %', 'draws', 'avg length', 'avg waves'];
  console.log(header.map((h) => h.padStart(14)).join(' | '));
  for (const [fav, other, label] of [
    [5, 5, 'L5 vs L5'],
    [6, 5, 'L6 vs L5 (+1)'],
    [8, 5, 'L8 vs L5 (+3)'],
    [10, 5, 'L10 vs L5 (+5)'],
  ] as const) {
    const s = duelSeries(games, fav, other);
    console.log(
      [label, `${(s.winRate * 100).toFixed(0)}%`, String(s.draws), `${s.avgMinutes.toFixed(1)} min`, s.avgWaves.toFixed(1)].map((c) => c.padStart(14)).join(' | '),
    );
  }
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
