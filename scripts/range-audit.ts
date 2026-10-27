// Reports how much road each tower level can cover from legal build squares.
// This catches range upgrades that look larger but rarely add useful firing time.
import { TOWERS } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import { pathCoverage } from '../src/shared/reach';
import { TOWER_TYPES } from '../src/shared/types';

function spanLength(type: (typeof TOWER_TYPES)[number], level: number, tx: number, ty: number, map: (typeof MAPS)[keyof typeof MAPS]): number {
  const tower = TOWERS[type];
  const stats = tower.levels[level - 1];
  const radius = tower.support ? (stats.buffRadius ?? stats.range) : stats.range;
  return pathCoverage(map, tx, ty, radius, stats.minRange ?? 0).spans.reduce(
    (sum, span) => sum + Math.hypot(span.x2 - span.x1, span.y2 - span.y1),
    0,
  );
}

for (const type of TOWER_TYPES) {
  const tower = TOWERS[type];
  if (!tower.attacks && !tower.support) continue;
  const levels = tower.levels.map((stats, index) => {
    let total = 0;
    let useful = 0;
    let squares = 0;
    let best = 0;
    for (const map of Object.values(MAPS)) {
      for (let ty = 0; ty < map.height; ty++) {
        for (let tx = 0; tx < map.width; tx++) {
          if (map.tiles[ty * map.width + tx] !== TILE_BUILDABLE) continue;
          const coverage = spanLength(type, index + 1, tx, ty, map);
          total += coverage;
          best = Math.max(best, coverage);
          if (coverage > 0) useful++;
          squares++;
        }
      }
    }
    return {
      radius: tower.support ? stats.buffRadius : stats.range,
      averageRoad: total / squares,
      usefulSquares: useful / squares,
      bestRoad: best,
    };
  });
  const gain = (from: number, to: number) => ((levels[to].averageRoad / levels[from].averageRoad - 1) * 100).toFixed(0);
  console.log(
    `${tower.name.padEnd(13)} ${levels.map((l) => `r${l.radius}: avg ${l.averageRoad.toFixed(2)}, useful ${(l.usefulSquares * 100).toFixed(0)}%, best ${l.bestRoad.toFixed(1)}`).join(' | ')} | gains +${gain(0, 1)}%, +${gain(1, 2)}%`,
  );
}
