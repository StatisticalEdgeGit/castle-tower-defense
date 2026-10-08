// Enemy creation, movement along paths, healing, shields, damage-over-time, damage and
// slow rules.
import { ARMOR_MIN_FRACTION, ENEMIES } from '../../shared/config';
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
  let dmg = ignoreArmor ? raw : Math.max(raw - e.armor, raw * ARMOR_MIN_FRACTION);
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
