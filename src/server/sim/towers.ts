// Tower attack logic. Archer / sniper / frost / tesla hit instantly (with fx events for
// the client); cannon shells are simulated projectiles that explode on arrival.
import { TOWERS } from '../../shared/config';
import type { Board, Enemy, Shell, Tower } from './board';
import { applySlow, damageEnemy } from './enemies';
import { enemiesInRadius, nearestEnemy, selectTarget } from './targeting';

export interface SimContext {
  nextId(): number;
  /** called whenever a tower removes HP; handles stats + kill bookkeeping */
  onHit(board: Board, tower: Tower | null, e: Enemy, dealt: number): void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function hit(ctx: SimContext, board: Board, tower: Tower, e: Enemy, raw: number, ignoreArmor: boolean): void {
  const dealt = damageEnemy(e, raw, ignoreArmor);
  ctx.onHit(board, tower, e, dealt);
}

export function updateTowers(ctx: SimContext, board: Board, dt: number): void {
  for (const t of board.towers) {
    const def = TOWERS[t.type];
    if (!def.attacks) continue;
    const lvl = def.levels[t.level - 1];
    t.cooldown -= dt;
    const target = selectTarget(board, t.x, t.y, lvl.range, t.targeting);
    if (!target) {
      t.targetId = -1;
      if (t.cooldown < 0) t.cooldown = 0;
      continue;
    }
    t.targetId = target.id;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (t.cooldown > 0) continue;
    t.cooldown += 1 / lvl.rate;
    if (t.cooldown < 0) t.cooldown = 0;
    fire(ctx, board, t, target);
  }
}

export function fire(ctx: SimContext, board: Board, t: Tower, target: Enemy): void {
  const def = TOWERS[t.type];
  const lvl = def.levels[t.level - 1];
  const dmg = lvl.damage * t.mult;
  switch (t.type) {
    case 'archer':
    case 'sniper': {
      board.fx.push({ k: 'shot', t: t.type, x1: r2(t.x), y1: r2(t.y), x2: r2(target.x), y2: r2(target.y) });
      hit(ctx, board, t, target, dmg, !!def.ignoresArmor);
      break;
    }
    case 'frost': {
      const slow = lvl.slow ?? 0;
      const dur = lvl.slowDuration ?? 1.5;
      let victims: Enemy[];
      if (lvl.pulse) {
        victims = enemiesInRadius(board, t.x, t.y, lvl.range);
        board.fx.push({ k: 'pulse', x: r2(t.x), y: r2(t.y), r: lvl.range });
      } else if (lvl.splash) {
        victims = enemiesInRadius(board, target.x, target.y, lvl.splash);
        if (!victims.includes(target)) victims.push(target);
        board.fx.push({ k: 'shot', t: 'frost', x1: r2(t.x), y1: r2(t.y), x2: r2(target.x), y2: r2(target.y) });
        board.fx.push({ k: 'pulse', x: r2(target.x), y: r2(target.y), r: lvl.splash });
      } else {
        victims = [target];
        board.fx.push({ k: 'shot', t: 'frost', x1: r2(t.x), y1: r2(t.y), x2: r2(target.x), y2: r2(target.y) });
      }
      for (const v of victims) {
        applySlow(v, slow, dur);
        hit(ctx, board, t, v, dmg, false);
      }
      break;
    }
    case 'tesla': {
      const chains = lvl.chains ?? 1;
      const falloff = def.chainFalloff ?? 0.2;
      const jump = def.chainRange ?? 1.8;
      const hitSet = new Set<number>();
      const pts: number[] = [r2(t.x), r2(t.y)];
      let cur: Enemy | null = target;
      let d = dmg;
      for (let i = 0; i < chains && cur; i++) {
        hitSet.add(cur.id);
        pts.push(r2(cur.x), r2(cur.y));
        const next: Enemy | null = nearestEnemy(board, cur.x, cur.y, jump, hitSet);
        hit(ctx, board, t, cur, d, false);
        d *= 1 - falloff;
        cur = next;
      }
      board.fx.push({ k: 'chain', pts });
      break;
    }
    case 'cannon': {
      const shell: Shell = {
        id: ctx.nextId(),
        x: t.x,
        y: t.y,
        tx: target.x,
        ty: target.y,
        targetId: target.id,
        speed: def.projectileSpeed ?? 7,
        damage: dmg,
        splash: lvl.splash ?? 1,
        tower: t,
      };
      board.shells.push(shell);
      break;
    }
    case 'mine':
      break;
  }
}

/** Splash damage at a point: every enemy within radius takes the full hit (armor applies). */
export function explode(ctx: SimContext, board: Board, tower: Tower, x: number, y: number, radius: number, damage: number): number {
  const victims = enemiesInRadius(board, x, y, radius);
  for (const v of victims) hit(ctx, board, tower, v, damage, false);
  board.fx.push({ k: 'boom', x: r2(x), y: r2(y), r: radius });
  return victims.length;
}

export function updateShells(ctx: SimContext, board: Board, dt: number): void {
  if (board.shells.length === 0) return;
  const byId = new Map<number, Enemy>();
  for (const e of board.enemies) if (e.alive) byId.set(e.id, e);
  const keep: Shell[] = [];
  for (const s of board.shells) {
    const tgt = byId.get(s.targetId);
    if (tgt) {
      s.tx = tgt.x;
      s.ty = tgt.y;
    }
    const dx = s.tx - s.x;
    const dy = s.ty - s.y;
    const dist = Math.hypot(dx, dy);
    const step = s.speed * dt;
    if (dist <= step) {
      explode(ctx, board, s.tower, s.tx, s.ty, s.splash, s.damage);
      continue;
    }
    s.x += (dx / dist) * step;
    s.y += (dy / dist) * step;
    keep.push(s);
  }
  board.shells = keep;
}
