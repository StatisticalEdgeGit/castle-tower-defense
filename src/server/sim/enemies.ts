// Enemy creation, movement along paths, healing, shields, damage-over-time, damage and
// slow rules.
import { ENEMIES } from '../../shared/config';
import { mitigatedDamage } from '../../shared/combatMath';
import { pointOnPath } from '../../shared/maps';
import { ENEMY_TYPES, type EnemyType } from '../../shared/types';
import type { Board, Enemy, QueuedSpawn, Tower } from './board';

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
    hpMult: s.hp / def.hp,
    shield: 0,
    pulsed: false,
    burnDps: 0,
    burnTime: 0,
    burnTower: null,
    poisonStacks: 0,
    poisonDps: 0,
    poisonTime: 0,
    poisonTower: null,
    towerTarget: -1,
    towerAttackCooldown: 0,
    towerScanCooldown: 0,
  };
}

/** Children spawned where a splitter died (same path, slightly behind each other). */
export function createSplitChildren(nextId: () => number, parent: Enemy): Enemy[] {
  const def = parent.def;
  if (!def.splitInto || !def.splitCount) return [];
  const childType: EnemyType = def.splitInto;
  const cdef = ENEMIES[childType];
  const out: Enemy[] = [];
  for (let i = 0; i < def.splitCount; i++) {
    const hp = Math.max(1, Math.round(cdef.hp * parent.hpMult));
    out.push({
      id: nextId(),
      type: childType,
      typeIdx: ENEMY_TYPES.indexOf(childType),
      def: cdef,
      path: parent.path,
      dist: Math.max(0, parent.dist - 0.18 * i),
      x: parent.x,
      y: parent.y,
      hp,
      maxHp: hp,
      armor: cdef.armor,
      speed: cdef.speed,
      bounty: cdef.bounty * (parent.bounty / Math.max(1e-9, def.bounty)),
      lives: cdef.lives,
      slowAmt: 0,
      slowTime: 0,
      sent: parent.sent,
      senderId: parent.senderId,
      alive: true,
      hpMult: parent.hpMult,
      shield: 0,
      pulsed: false,
      burnDps: 0,
      burnTime: 0,
      burnTower: null,
      poisonStacks: 0,
      poisonDps: 0,
      poisonTime: 0,
      poisonTower: null,
      towerTarget: -1,
      towerAttackCooldown: 0,
      towerScanCooldown: 0,
    });
  }
  return out;
}

/**
 * Apply a hit. Armor reduces damage per hit, but a hit always deals at least
 * ARMOR_MIN_FRACTION (20%) of its raw damage. Shields absorb damage before HP.
 * Returns the HP + shield actually removed.
 */
export function damageEnemy(e: Enemy, raw: number, ignoreArmor = false): number {
  if (!e.alive || raw <= 0) return 0;
  let dmg = mitigatedDamage(raw, e.armor, ignoreArmor);
  let dealt = 0;
  if (e.shield > 0) {
    const absorbed = Math.min(e.shield, dmg);
    e.shield -= absorbed;
    dmg -= absorbed;
    dealt += absorbed;
  }
  dealt += Math.min(dmg, Math.max(0, e.hp));
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

/** Burn: does not stack — the stronger burn wins, duration refreshes. */
export function applyBurn(e: Enemy, dps: number, time: number, tower: Tower | null): void {
  if (!e.alive || dps <= 0) return;
  if (e.burnTime <= 0 || dps >= e.burnDps) {
    e.burnDps = dps;
    e.burnTower = tower;
  }
  e.burnTime = Math.max(e.burnTime, time);
}

/** Poison: every hit adds a stack (up to maxStacks) and refreshes the duration. */
export function applyPoison(e: Enemy, dpsPerStack: number, maxStacks: number, time: number, tower: Tower | null): void {
  if (!e.alive || dpsPerStack <= 0) return;
  if (e.poisonTime <= 0) e.poisonStacks = 0;
  e.poisonStacks = Math.min(maxStacks, e.poisonStacks + 1);
  e.poisonDps = Math.max(e.poisonDps, dpsPerStack);
  e.poisonTime = time;
  e.poisonTower = tower;
}

/** Burn and poison tick damage (both ignore armor). */
export function applyDots(board: Board, dt: number, onDot: (tower: Tower | null, e: Enemy, dealt: number) => void): void {
  for (const e of board.enemies) {
    if (!e.alive) continue;
    if (e.burnTime > 0) {
      const dealt = damageEnemy(e, e.burnDps * Math.min(dt, e.burnTime), true);
      e.burnTime -= dt;
      if (e.burnTime <= 0) {
        e.burnTime = 0;
        e.burnDps = 0;
      }
      onDot(e.burnTower, e, dealt);
      if (!e.alive) continue;
    }
    if (e.poisonTime > 0 && e.poisonStacks > 0) {
      const dealt = damageEnemy(e, e.poisonDps * e.poisonStacks * Math.min(dt, e.poisonTime), true);
      e.poisonTime -= dt;
      if (e.poisonTime <= 0) {
        e.poisonTime = 0;
        e.poisonStacks = 0;
        e.poisonDps = 0;
      }
      onDot(e.poisonTower, e, dealt);
    }
  }
}

/**
 * Healers restore healPerSec·maxHp per second to nearby non-healers.
 * A target is healed by at most one healer, so a clump cannot outheal focused fire.
 */
export function applyHealers(board: Board, dt: number): void {
  const enemies = board.enemies;
  const healed = new Set<Enemy>();
  for (const h of enemies) {
    if (!h.alive || !h.def.healRadius || !h.def.healPerSec) continue;
    const r2 = h.def.healRadius * h.def.healRadius;
    for (const o of enemies) {
      if (o === h || !o.alive || o.hp >= o.maxHp || o.type === 'healer' || healed.has(o)) continue;
      const dx = o.x - h.x;
      const dy = o.y - h.y;
      if (dx * dx + dy * dy > r2) continue;
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * h.def.healPerSec * dt);
      healed.add(o);
    }
  }
}

/**
 * Shieldbearers fire ONE pulse once they have walked shieldTriggerDist tiles: every other
 * enemy within shieldRadius gets a shield worth shieldPct of its max HP (shields don't
 * stack — the bigger one is kept). Returns the pulses fired (for fx).
 */
export function applyShieldbearers(board: Board): { x: number; y: number; r: number }[] {
  const fired: { x: number; y: number; r: number }[] = [];
  for (const s of board.enemies) {
    const d = s.def;
    if (!s.alive || s.pulsed || !d.shieldPct || !d.shieldRadius) continue;
    if (s.dist < (d.shieldTriggerDist ?? 0)) continue;
    s.pulsed = true;
    const r2 = d.shieldRadius * d.shieldRadius;
    for (const o of board.enemies) {
      if (o === s || !o.alive) continue;
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      if (dx * dx + dy * dy <= r2) o.shield = Math.max(o.shield, o.maxHp * d.shieldPct);
    }
    fired.push({ x: s.x, y: s.y, r: d.shieldRadius });
  }
  return fired;
}

/**
 * Raiders, Shades, Golems and siege bosses stop when they can reach a building. They
 * focus the nearest living structure until it is destroyed, then resume walking.
 */
export function updateSiegeAttacks(board: Board, dt: number): { stalled: Set<number>; destroyed: Tower[] } {
  const stalled = new Set<number>();
  const destroyed = new Set<Tower>();
  if (board.towers.length === 0) return { stalled, destroyed: [] };
  for (const e of board.enemies) {
    const def = e.def;
    if (!e.alive || !def.towerDamage || !def.towerAttackRate || !def.towerAttackRange) {
      e.towerTarget = -1;
      continue;
    }
    const inRange = (t: Tower) => {
      if (t.hp <= 0 || destroyed.has(t)) return false;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      return dx * dx + dy * dy <= def.towerAttackRange! * def.towerAttackRange!;
    };
    let target = board.towers.find((t) => t.id === e.towerTarget && inRange(t));
    if (!target) {
      e.towerTarget = -1;
      e.towerScanCooldown -= dt;
      if (e.towerScanCooldown > 0) continue;
      e.towerScanCooldown = 0.25;
      let bestD = Infinity;
      for (const t of board.towers) {
        if (!inRange(t)) continue;
        const d = (t.x - e.x) ** 2 + (t.y - e.y) ** 2;
        if (d < bestD) {
          bestD = d;
          target = t;
        }
      }
    }
    if (!target) {
      e.towerAttackCooldown = Math.max(0, e.towerAttackCooldown - dt);
      continue;
    }
    e.towerTarget = target.id;
    stalled.add(e.id);
    e.towerAttackCooldown -= dt;
    if (e.towerAttackCooldown > 0) continue;
    e.towerAttackCooldown += 1 / def.towerAttackRate;
    target.hp = Math.max(0, target.hp - def.towerDamage);
    board.fx.push({ k: 'towerhit', x: target.x, y: target.y, n: def.towerDamage });
    if (target.hp <= 0) {
      destroyed.add(target);
      e.towerTarget = -1;
    }
  }
  return { stalled, destroyed: [...destroyed] };
}

/** Performance-sensitive live-game path: siege attacks and movement in one enemy pass. */
export function updateEnemies(board: Board, dt: number, onLeak: (e: Enemy) => void): Tower[] {
  const destroyed = new Set<Tower>();
  const hasStructures = board.towers.length > 0;
  for (const e of board.enemies) {
    if (!e.alive) continue;
    if (e.slowTime > 0) {
      e.slowTime -= dt;
      if (e.slowTime <= 0) {
        e.slowTime = 0;
        e.slowAmt = 0;
      }
    }

    const def = e.def;
    let attacking = false;
    if (hasStructures && def.towerDamage && def.towerAttackRate && def.towerAttackRange) {
      const r2 = def.towerAttackRange * def.towerAttackRange;
      const inRange = (t: Tower) => t.hp > 0 && !destroyed.has(t) && (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= r2;
      let target = e.towerTarget >= 0 ? board.towers.find((t) => t.id === e.towerTarget && inRange(t)) : undefined;
      if (!target) {
        e.towerTarget = -1;
        e.towerScanCooldown -= dt;
        if (e.towerScanCooldown <= 0) {
          e.towerScanCooldown = 0.25;
          let bestD = Infinity;
          for (const t of board.towers) {
            if (!inRange(t)) continue;
            const d = (t.x - e.x) ** 2 + (t.y - e.y) ** 2;
            if (d < bestD) {
              bestD = d;
              target = t;
            }
          }
        }
      }
      if (target) {
        attacking = true;
        e.towerTarget = target.id;
        e.towerAttackCooldown -= dt;
        if (e.towerAttackCooldown <= 0) {
          e.towerAttackCooldown += 1 / def.towerAttackRate;
          target.hp = Math.max(0, target.hp - def.towerDamage);
          board.fx.push({ k: 'towerhit', x: target.x, y: target.y, n: def.towerDamage });
          if (target.hp <= 0) {
            destroyed.add(target);
            e.towerTarget = -1;
          }
        }
      }
    } else {
      e.towerTarget = -1;
    }
    if (attacking) continue;

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
  return [...destroyed];
}

/**
 * Move every enemy along its path. Calls onLeak for enemies that reach the end
 * (they are marked dead and should be removed).
 */
export function moveEnemies(board: Board, dt: number, onLeak: (e: Enemy) => void, stalled: Set<number> = new Set()): void {
  for (const e of board.enemies) {
    if (!e.alive) continue;
    if (e.slowTime > 0) {
      e.slowTime -= dt;
      if (e.slowTime <= 0) {
        e.slowTime = 0;
        e.slowAmt = 0;
      }
    }
    if (stalled.has(e.id)) continue;
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
