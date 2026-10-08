// `npm run balance` — fast-forward co-op runs with the greedy bot and print a table of
// players × difficulty × waves survived (per map).
import { DIFFICULTY } from '../src/shared/config';
import { MAP_IDS, MAPS } from '../src/shared/maps';
import type { Difficulty } from '../src/shared/types';
import { runCoop } from '../src/server/sim/balance';

const difficulties: Difficulty[] = ['easy', 'normal', 'hard'];
const args = process.argv.slice(2);
const maps = args.includes('--all-maps') ? MAP_IDS : (['greenfield'] as const);
const t0 = Date.now();

for (const mapId of maps) {
  const map = MAPS[mapId];
  console.log(`\nCo-op balance — ${map.name} (final wave ${map.finalWave}), greedy bot per player`);
  const header = ['players', ...difficulties.map((d) => DIFFICULTY[d].label.padStart(14))];
  console.log(header.join(' | '));
  console.log('-'.repeat(header.join(' | ').length));
  for (const players of [1, 2, 3, 4]) {
    const cells = difficulties.map((difficulty) => {
      const r = runCoop({ mapId, difficulty, players });
      const txt = r.won ? `WIN ${r.survived} (${r.livesLeft}♥)` : `lost @${r.survived + 1}`;
      return txt.padStart(14);
    });
    console.log([String(players).padStart(7), ...cells].join(' | '));
  }
  const idle = runCoop({ mapId, difficulty: 'normal', players: 1, doNothing: true });
  console.log(`do-nothing player (Normal): survived ${idle.survived} wave(s), lost on wave ${idle.survived + 1}`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
