// Enemy creation, movement along paths, healing, damage and slow rules.
import { ARMOR_MIN_FRACTION, ENEMIES } from '../../shared/config';
import { pointOnPath } from '../../shared/maps';
import { ENEMY_TYPES } from '../../shared/types';
import type { Board, Enemy, QueuedSpawn } from './board';

export function createEnemy(id: number, board: Board, s: QueuedSpawn): Enemy {
  const def = ENEMIES[s.type];
  const path = board.map.paths.length > 1 ? board.spawnCounter++ % board.map.paths.length : 0;
  const p = pointOnPath(board.map.paths[path], 0);
  return {
    id,
    type: s.type,
    typeIdx: ENEMY_TYPES.indexOf(s.type),
    def,
    path,
    dist: 0,
    x: p.x,
    y: p.y,
    hp: s.hp,
    maxHp: s.hp,
    armor: def.armor,
    speed: def.speed,
    bounty: def.bounty * s.bountyMult,
    lives: def.lives,
    slowAmt: 0,
    slowTime: 0,
    sent: s.sent,
    senderId: s.senderId,
    alive: true,
  };
}

/**
 * Apply a hit. Armor reduces damage per hit, but a hit always deals at least
 * ARMOR_MIN_FRACTION (20%) of its raw damage. Returns the HP actually removed.
 */
export function damageEnemy(e: Enemy, raw: number, ignoreArmor = false): number {
  if (!e.alive || raw <= 0) return 0;
  const dmg = ignoreArmor ? raw : Math.max(raw - e.armor, raw * ARMOR_MIN_FRACTION);
  const dealt = Math.min(dmg, e.hp);
  e.hp -= dmg;
  return dealt;
}

/**
 * Slows never stack: the strongest active slow wins. A weaker slow arriving while a
 * stronger one is active is ignored; an equal one refreshes the duration.
 * Bosses (slowResist) only take part of the effect.
 */
export function applySlow(e: Enemy, amount: number, duration: number): void {
  if (!e.alive || amount <= 0) return;
  const eff = amount * (1 - (e.def.slowResist ?? 0));
  if (e.slowTime <= 0 || eff > e.slowAmt + 1e-9) {
    e.slowAmt = eff;
    e.slowTime = duration;
  } else if (Math.abs(eff - e.slowAmt) <= 1e-9) {
    e.slowTime = Math.max(e.slowTime, duration);
  }
}

/** Healers restore healPerSec·maxHp per second to OTHER enemies within healRadius. */
export function applyHealers(board: Board, dt: number): void {
  const enemies = board.enemies;
  for (const h of enemies) {
    if (!h.alive || !h.def.healRadius || !h.def.healPerSec) continue;
    const r2 = h.def.healRadius * h.def.healRadius;
    for (const o of enemies) {
      if (o === h || !o.alive || o.hp >= o.maxHp) continue;
      const dx = o.x - h.x;
      const dy = o.y - h.y;
      if (dx * dx + dy * dy <= r2) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * h.def.healPerSec * dt);
    }
  }
}

/**
 * Move every enemy along its path. Calls onLeak for enemies that reach the end
 * (they are marked dead and should be removed).
 */
export function moveEnemies(board: Board, dt: number, onLeak: (e: Enemy) => void): void {
  for (const e of board.enemies) {
    if (!e.alive) continue;
    if (e.slowTime > 0) {
      e.slowTime -= dt;
      if (e.slowTime <= 0) {
        e.slowTime = 0;
        e.slowAmt = 0;
      }
    }
    const speed = e.speed * (1 - e.slowAmt);
    e.dist += speed * dt;
    const path = board.map.paths[e.path];
    if (e.dist >= path.length) {
      e.dist = path.length;
      const p = pointOnPath(path, e.dist);
      e.x = p.x;
      e.y = p.y;
      e.alive = false;
      onLeak(e);
      continue;
    }
    const p = pointOnPath(path, e.dist);
    e.x = p.x;
    e.y = p.y;
  }
}
