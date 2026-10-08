// Tower attack logic. Archer / sniper / frost / tesla / flame / venom hit instantly (with fx
// events for the client); cannon and mortar shells are simulated projectiles; the prism is
// a continuous beam; the war totem buffs its neighbours.
import { TOTEM_LEVEL_BONUS } from '../../shared/progression';
import { TOWERS, type TowerLevel } from '../../shared/config';
import { pointOnPath } from '../../shared/maps';
import type { Board, Enemy, Shell, Tower } from './board';
import { applyBurn, applyPoison, applySlow, damageEnemy } from './enemies';
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

/**
 * War Totem buffs: every non-support tower within a totem's radius gets its damage and
 * fire-rate buff. Buffs from several totems do NOT stack — the strongest one applies.
 */
export function applyTotemBuffs(board: Board): void {
  const totems = board.towers.filter((t) => TOWERS[t.type].support);
  for (const t of board.towers) {
    t.buffDmg = 0;
    t.buffRate = 0;
  }
  if (!totems.length) return;
  for (const tot of totems) {
    const lvl = TOWERS.totem.levels[tot.level - 1];
    const bonus = TOTEM_LEVEL_BONUS * (tot.cardLevel - 1);
    const dmg = (lvl.buffDmg ?? 0) + bonus;
    const rate = (lvl.buffRate ?? 0) + bonus;
    const rr = (lvl.buffRadius ?? 0) ** 2;
    for (const t of board.towers) {
      if (t === tot || TOWERS[t.type].support || !TOWERS[t.type].attacks) continue;
      const dx = t.x - tot.x;
      const dy = t.y - tot.y;
      if (dx * dx + dy * dy > rr + 1e-9) continue;
      t.buffDmg = Math.max(t.buffDmg, dmg);
      t.buffRate = Math.max(t.buffRate, rate);
    }
  }
}

function pickTarget(board: Board, t: Tower, lvl: TowerLevel): Enemy | null {
  if (t.type === 'venom') {
    // spread poison: prefer targets that are not yet at max stacks
    const max = lvl.poisonMaxStacks ?? 1;
    const saved = board.enemies;
    const fresh = saved.filter((e) => e.alive && (e.poisonStacks < max || e.poisonTime < 1));
    if (fresh.length && fresh.length !== saved.length) {
      board.enemies = fresh;
      const best = selectTarget(board, t.x, t.y, lvl.range, t.targeting, lvl.minRange ?? 0);
      board.enemies = saved;
      if (best) return best;
    }
  }
  return selectTarget(board, t.x, t.y, lvl.range, t.targeting, lvl.minRange ?? 0);
}

export function updateTowers(ctx: SimContext, board: Board, dt: number): void {
  for (const t of board.towers) {
    const def = TOWERS[t.type];
    if (!def.attacks) continue;
    const lvl = def.levels[t.level - 1];
    const target = pickTarget(board, t, lvl);
    if (def.beam) {
      updateBeam(ctx, board, t, lvl, target, dt);
      continue;
    }
    t.cooldown -= dt;
    if (!target) {
      t.targetId = -1;
      if (t.cooldown < 0) t.cooldown = 0;
      continue;
    }
    t.targetId = target.id;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (t.cooldown > 0) continue;
    t.cooldown += 1 / (lvl.rate * (1 + t.buffRate));
    if (t.cooldown < 0) t.cooldown = 0;
    fire(ctx, board, t, target);
  }
}

/** Prism: continuous beam whose damage ramps while it holds the same target. */
function updateBeam(ctx: SimContext, board: Board, t: Tower, lvl: TowerLevel, target: Enemy | null, dt: number): void {
  if (!target) {
    t.targetId = -1;
    t.beamTarget = -1;
    t.beamTime = 0;
    return;
  }
  if (target.id !== t.beamTarget) {
    t.beamTarget = target.id;
    t.beamTime = 0;
  } else {
    t.beamTime += dt;
  }
  t.targetId = target.id;
  t.angle = Math.atan2(target.y - t.y, target.x - t.x);
  const ramp = beamRamp(lvl, t.beamTime);
  const dps = lvl.damage * t.mult * (1 + t.buffDmg) * (1 + t.buffRate) * ramp;
  hit(ctx, board, t, target, dps * dt, true);
}

export function beamRamp(lvl: TowerLevel, held: number): number {
  return Math.min(lvl.rampMax ?? 1, 1 + (lvl.rampPerSec ?? 0) * held);
}

export function fire(ctx: SimContext, board: Board, t: Tower, target: Enemy): void {
  const def = TOWERS[t.type];
  const lvl = def.levels[t.level - 1];
  const dmg = lvl.damage * t.mult * (1 + t.buffDmg);
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
    case 'flame': {
      // every enemy inside the cone (towards the target) is hit and set on fire
      const cone = ((lvl.cone ?? 30) * Math.PI) / 180;
      const victims = flameVictims(board, t, lvl.range, t.angle, cone);
      for (const v of victims) {
        applyBurn(v, (lvl.burnDps ?? 0) * t.mult * (1 + t.buffDmg), lvl.burnTime ?? 2, t);
        hit(ctx, board, t, v, dmg, false);
      }
      board.fx.push({ k: 'flame', x: r2(t.x), y: r2(t.y), a: Math.round(t.angle * 100) / 100, r: lvl.range, c: lvl.cone ?? 30 });
      break;
    }
    case 'venom': {
      applyPoison(target, (lvl.poisonDps ?? 0) * t.mult * (1 + t.buffDmg), lvl.poisonMaxStacks ?? 1, lvl.poisonTime ?? 3, t);
      hit(ctx, board, t, target, dmg, false);
      board.fx.push({ k: 'shot', t: 'venom', x1: r2(t.x), y1: r2(t.y), x2: r2(target.x), y2: r2(target.y) });
      break;
    }
    case 'cannon':
    case 'mortar': {
      const speed = def.projectileSpeed ?? 7;
      let tx = target.x;
      let ty = target.y;
      if (!def.homing) {
        // lob the shell to where the target will be when it lands
        const flight = Math.hypot(target.x - t.x, target.y - t.y) / speed;
        const ahead = target.dist + target.speed * (1 - target.slowAmt) * flight;
        const p = pointOnPath(board.map.paths[target.path], ahead);
        tx = p.x;
        ty = p.y;
      }
      const shell: Shell = {
        id: ctx.nextId(),
        x: t.x,
        y: t.y,
        tx,
        ty,
        targetId: target.id,
        speed,
        damage: dmg,
        splash: lvl.splash ?? 1,
        tower: t,
        homing: def.homing !== false,
        kind: t.type === 'mortar' ? 1 : 0,
      };
      board.shells.push(shell);
      break;
    }
    case 'mine':
    case 'prism':
    case 'totem':
      break;
  }
}

/** Enemies within `range` whose bearing from the tower is within ±cone of `angle`. */
export function flameVictims(board: Board, t: { x: number; y: number }, range: number, angle: number, cone: number): Enemy[] {
  const out: Enemy[] = [];
  const rr = range * range;
  for (const e of board.enemies) {
    if (!e.alive) continue;
    const dx = e.x - t.x;
    const dy = e.y - t.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > rr) continue;
    if (d2 < 0.04) {
      out.push(e);
      continue;
    }
    let da = Math.atan2(dy, dx) - angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) <= cone + 1e-9) out.push(e);
  }
  return out;
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
    if (s.homing) {
      const tgt = byId.get(s.targetId);
      if (tgt) {
        s.tx = tgt.x;
        s.ty = tgt.y;
      }
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
