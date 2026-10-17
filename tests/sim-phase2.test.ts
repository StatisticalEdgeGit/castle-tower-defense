// New towers (flame, mortar, venom, prism, totem), new enemies (splitter, shieldbearer)
// and card-level stat multipliers.
import { describe, expect, it } from 'vitest';
import { ENEMIES, TOWERS } from '../src/shared/config';
import { MAPS, TILE_BUILDABLE } from '../src/shared/maps';
import { levelStatMult } from '../src/shared/progression';
import { applyDots, applyShieldbearers, damageEnemy, moveEnemies } from '../src/server/sim/enemies';
import { selectTarget } from '../src/server/sim/targeting';
import { applyTotemBuffs, flameVictims, updateShells, updateTowers } from '../src/server/sim/towers';
import { GameSim, makeRuleset } from '../src/server/sim/game';
import { enemyAtXY, firstTile, makeSim, spawnAt } from './helpers';

const map = MAPS.greenfield;
function tileAt(x: number, y: number) {
  return firstTile(map, TILE_BUILDABLE, (tx, ty) => tx === x && ty === y);
}
function richSim(players = 1) {
  const sim = makeSim('coop', players);
  sim.nextWaveIn = null;
  for (const p of sim.players.values()) {
    p.money = 1_000_000;
    p.loadout = ['archer', 'flame', 'mortar', 'venom', 'prism', 'totem'];
  }
  return sim;
}
function place(sim: GameSim, type: Parameters<GameSim['placeTower']>[4], x: number, y: number, pid = 'p0') {
  const { tx, ty } = tileAt(x, y);
  const r = sim.placeTower(pid, 0, tx, ty, type);
  if (!r.ok) throw new Error(r.error);
  return sim.getTower(r.towerId)!;
}

describe('Flamethrower', () => {
  it('hits every enemy in its cone, not behind it, and sets them burning', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const t = place(sim, 'flame', 6, 6);
    const front1 = enemyAtXY(sim, b, 'swarm', t.x + 1.2, t.y, 100);
    const front2 = enemyAtXY(sim, b, 'swarm', t.x + 1.6, t.y + 0.4, 100);
    const behind = enemyAtXY(sim, b, 'swarm', t.x - 1.2, t.y, 100);
    front1.dist = 30; // "first" target is in front
    behind.dist = 1;
    updateTowers(sim, b, 0.05);
    const lvl = TOWERS.flame.levels[0];
    expect(front1.hp).toBe(100 - lvl.damage);
    expect(front2.hp).toBe(100 - lvl.damage);
    expect(behind.hp).toBe(100);
    expect(front1.burnTime).toBeCloseTo(lvl.burnTime!);
    expect(b.fx.some((f) => f.k === 'flame')).toBe(true);
    expect(flameVictims(b, t, 2, 0, (35 * Math.PI) / 180).map((e) => e.id).sort()).toEqual([front1.id, front2.id].sort());
  });

  it('burn ignores armor, does not stack (strongest wins) and expires', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const k = spawnAt(sim, b, 'knight', 5, 1000);
    k.burnDps = 10;
    k.burnTime = 1;
    let dealt = 0;
    for (let i = 0; i < 20; i++) applyDots(b, 0.05, (_t, _e, d) => (dealt += d));
    expect(1000 - k.hp).toBeCloseTo(10, 5); // 10 dps × 1 s, armor 8 ignored
    expect(k.burnTime).toBe(0);
    expect(dealt).toBeCloseTo(10, 5);
  });
});

describe('Mortar', () => {
  it('cannot target enemies inside its minimum range', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const close = enemyAtXY(sim, b, 'grunt', 10.5, 10.5, 100);
    const far = enemyAtXY(sim, b, 'grunt', 14.5, 10.5, 100);
    close.dist = 40;
    far.dist = 10;
    const min = TOWERS.mortar.levels[0].minRange!;
    expect(selectTarget(b, 10.5, 11.0, 8, 'first', min)?.id).toBe(far.id);
    expect(selectTarget(b, 10.5, 11.0, 8, 'first', 0)?.id).toBe(close.id);
  });

  it('lobs a non-homing shell to where the target will be and splashes', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const t = place(sim, 'mortar', 7, 7);
    // a grunt walking the path some way off
    const e = spawnAt(sim, b, 'grunt', 30, 1000);
    const buddy = spawnAt(sim, b, 'grunt', 30.4, 1000);
    expect(Math.hypot(e.x - t.x, e.y - t.y)).toBeGreaterThan(2);
    updateTowers(sim, b, 0.05);
    expect(b.shells.length).toBe(1);
    expect(b.shells[0].homing).toBe(false);
    const aim = { x: b.shells[0].tx, y: b.shells[0].ty };
    for (let i = 0; i < 80 && b.shells.length; i++) {
      moveEnemies(b, 0.05, () => {});
      updateShells(sim, b, 0.05);
    }
    expect(b.shells.length).toBe(0);
    const boom = b.fx.find((f) => f.k === 'boom')!;
    expect(boom).toMatchObject({ x: Math.round(aim.x * 100) / 100, y: Math.round(aim.y * 100) / 100 });
    const dmg = TOWERS.mortar.levels[0].damage;
    expect(1000 - e.hp).toBeCloseTo(dmg, 5);
    expect(1000 - buddy.hp).toBeCloseTo(dmg, 5);
  });
});

describe('Venom', () => {
  it('stacks poison per hit up to the cap, and poison ignores armor', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const t = place(sim, 'venom', 6, 6);
    const k = enemyAtXY(sim, b, 'knight', t.x + 1, t.y, 10_000);
    k.speed = 0;
    const lvl = TOWERS.venom.levels[0];
    for (let i = 0; i < lvl.poisonMaxStacks! + 3; i++) {
      t.cooldown = 0;
      updateTowers(sim, b, 0.05);
    }
    expect(k.poisonStacks).toBe(lvl.poisonMaxStacks);
    const before = k.hp;
    applyDots(b, 1, () => {});
    // 4 stacks × 5 dps, armor 8 does not apply to poison
    expect(before - k.hp).toBeCloseTo(lvl.poisonDps! * lvl.poisonMaxStacks!, 5);
  });

  it('prefers targets that are not yet fully poisoned', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const t = place(sim, 'venom', 6, 6);
    const a = enemyAtXY(sim, b, 'grunt', t.x + 1, t.y, 1000);
    const c = enemyAtXY(sim, b, 'grunt', t.x + 1.5, t.y, 1000);
    a.dist = 40;
    c.dist = 10;
    a.poisonStacks = TOWERS.venom.levels[0].poisonMaxStacks!;
    a.poisonTime = 3;
    a.poisonDps = 5;
    updateTowers(sim, b, 0.05);
    expect(c.poisonStacks).toBe(1);
  });
});

describe('Prism', () => {
  it('beam damage ramps while it holds the same target and caps at rampMax', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const t = place(sim, 'prism', 6, 6);
    const boss = enemyAtXY(sim, b, 'warlord', t.x + 1, t.y, 1_000_000);
    boss.speed = 0;
    const lvl = TOWERS.prism.levels[0];
    let first = 0;
    let last = 0;
    for (let i = 0; i < 200; i++) {
      const hp = boss.hp;
      updateTowers(sim, b, 0.05);
      const d = hp - boss.hp;
      if (i === 0) first = d;
      last = d;
    }
    expect(first).toBeCloseTo(lvl.damage * 0.05, 5); // ignores armor, ramp 1 at start
    expect(last).toBeCloseTo(lvl.damage * 0.05 * lvl.rampMax!, 5);
    // switching target resets the ramp
    const other = enemyAtXY(sim, b, 'grunt', t.x + 0.5, t.y, 1_000_000);
    other.dist = 999;
    const hp = other.hp;
    updateTowers(sim, b, 0.05);
    expect(hp - other.hp).toBeCloseTo(lvl.damage * 0.05, 5);
    expect(sim.snapshot(null, false).boards[0].beams.slice(0, 2)).toEqual([t.id, other.id]);
  });
});

describe('War Totem', () => {
  it('buffs nearby towers (+15% damage, +10% rate); several totems do not stack', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const archer = place(sim, 'archer', 6, 6);
    place(sim, 'totem', 7, 6);
    applyTotemBuffs(b);
    expect(archer.buffDmg).toBeCloseTo(0.15);
    expect(archer.buffRate).toBeCloseTo(0.1);
    // a second totem right next to it: still the strongest single buff, not the sum
    place(sim, 'totem', 6, 7);
    applyTotemBuffs(b);
    expect(archer.buffDmg).toBeCloseTo(0.15);
    // buffed archer hits for 10 × 1.15 and reloads faster
    const g = enemyAtXY(sim, b, 'grunt', archer.x + 1, archer.y - 1, 1000);
    g.speed = 0;
    updateTowers(sim, b, 0.05);
    expect(1000 - g.hp).toBeCloseTo(10 * 1.15, 5);
    expect(archer.cooldown).toBeCloseTo(1 / (2 * 1.1) - 0.05, 5);
    // far towers get nothing
    const far = place(sim, 'archer', 20, 2);
    applyTotemBuffs(b);
    expect(far.buffDmg).toBe(0);
  });

  it('card level adds +1% to both totem buffs per level', () => {
    const rules = makeRuleset('coop', 'greenfield', 'normal');
    const sim = new GameSim(rules, [{ id: 'p0', name: 'P0', colorIndex: 0, team: 0, loadout: ['archer', 'totem'], cardLevels: { totem: 6 } }]);
    sim.nextWaveIn = null;
    sim.players.get('p0')!.money = 10_000;
    const archer = place(sim, 'archer', 6, 6);
    place(sim, 'totem', 7, 6);
    applyTotemBuffs(sim.boards[0]);
    expect(archer.buffDmg).toBeCloseTo(0.15 + 0.05);
    expect(archer.buffRate).toBeCloseTo(0.1 + 0.05);
  });
});

describe('Splitter & Shieldbearer', () => {
  it('a splitter splits into 3 fast splitlings with scaled HP when it dies', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const s = spawnAt(sim, b, 'splitter', 12, Math.round(ENEMIES.splitter.hp * 2));
    s.sent = true;
    const dealt = damageEnemy(s, 99999, true);
    sim.onHit(b, null, s, dealt);
    const kids = b.enemies.filter((e) => e.type === 'splitling');
    expect(kids.length).toBe(3);
    for (const k of kids) {
      expect(k.maxHp).toBe(ENEMIES.splitling.hp * 2);
      expect(k.speed).toBeGreaterThan(s.speed);
      expect(k.sent).toBe(true);
      expect(k.dist).toBeLessThanOrEqual(12);
    }
  });

  it('a shieldbearer shields nearby enemies for 30% max HP exactly once; shields absorb damage first', () => {
    const sim = richSim();
    const b = sim.boards[0];
    const sb = spawnAt(sim, b, 'shield', 1.9, 170);
    const near = spawnAt(sim, b, 'grunt', 1.0, 100);
    const far = spawnAt(sim, b, 'grunt', 10, 100);
    expect(applyShieldbearers(b)).toHaveLength(0); // not walked far enough yet
    sb.dist = 2.1;
    expect(applyShieldbearers(b)).toHaveLength(1);
    expect(near.shield).toBeCloseTo(30);
    expect(far.shield).toBe(0);
    expect(sb.shield).toBe(0);
    near.shield = 5;
    expect(applyShieldbearers(b)).toHaveLength(0); // once only
    expect(near.shield).toBe(5);
    damageEnemy(near, 12, true);
    expect(near.shield).toBe(0);
    expect(near.hp).toBe(93);
  });
});

describe('card levels', () => {
  it('each level adds +5% damage; gold mine income scales too', () => {
    expect(levelStatMult(1)).toBe(1);
    expect(levelStatMult(5)).toBeCloseTo(1.2);
    expect(levelStatMult(10)).toBeCloseTo(1.45);
    const rules = makeRuleset('coop', 'greenfield', 'normal');
    const sim = new GameSim(rules, [{ id: 'p0', name: 'P0', colorIndex: 0, team: 0, cardLevels: { archer: 5, mine: 5 } }]);
    sim.nextWaveIn = null;
    const p = sim.players.get('p0')!;
    p.money = 10_000;
    const a = place(sim, 'archer', 6, 6);
    expect(a.mult).toBeCloseTo(1.2);
    const g = enemyAtXY(sim, sim.boards[0], 'grunt', a.x + 1, a.y, 1000);
    g.speed = 0;
    updateTowers(sim, sim.boards[0], 0.05);
    expect(1000 - g.hp).toBeCloseTo(12, 5);
    place(sim, 'mine', 20, 2);
    expect(sim.mineIncome(p)).toBeCloseTo((TOWERS.mine.levels[0].income ?? 0) * 1.2);
  });
});
