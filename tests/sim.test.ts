import { describe, expect, it } from 'vitest';
import {
  defenderHpScale,
  defenderScale,
  DIFFICULTY,
  ECONOMY,
  ENEMIES,
  SEND_PACKS,
  startCashPerPlayer,
  TIMING,
  TOWERS,
  waveBonusPerPlayer,
} from '../src/shared/config';
import { MAPS, pointOnPath, TILE_BLOCKED } from '../src/shared/maps';
import { bossCount, generateWave, waveUnitCount } from '../src/shared/waves';
import { applyHealers, applySlow, damageEnemy, moveEnemies } from '../src/server/sim/enemies';
import { boardLives, enemyHp, scaledSendCount, scaleWaveForBoard } from '../src/server/sim/economy';
import { selectTarget } from '../src/server/sim/targeting';
import { explode, updateShells, updateTowers } from '../src/server/sim/towers';
import { enemyAtXY, firstTile, greenfield, makeSim, spawnAt, stepFor, TILE_BUILDABLE, TILE_PATH } from './helpers';

describe('path following', () => {
  it('moves enemies along axis-aligned waypoints at their speed, around corners', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const path = b.map.paths[0];
    const e = spawnAt(sim, b, 'grunt', 0); // speed 1 tile/s
    expect(e.x).toBeCloseTo(-0.5);
    expect(e.y).toBeCloseTo(2.5);
    for (let i = 0; i < 60; i++) moveEnemies(b, 0.05, () => {});
    expect(e.dist).toBeCloseTo(3, 5);
    expect(e.x).toBeCloseTo(2.5, 5);
    expect(e.y).toBeCloseTo(2.5, 5);
    // corner at (4.5, 2.5) is at distance 5; 1.5 tiles later we are heading down
    for (let i = 0; i < 70; i++) moveEnemies(b, 0.05, () => {});
    expect(e.x).toBeCloseTo(4.5, 5);
    expect(e.y).toBeCloseTo(4.0, 5);
    expect(pointOnPath(path, path.length).x).toBeCloseTo(24.5);
  });

  it('runners are faster and a leak costs lives', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const runner = spawnAt(sim, b, 'runner', 0);
    moveEnemies(b, 1, () => {});
    expect(runner.dist).toBeCloseTo(ENEMIES.runner.speed);
    const brute = spawnAt(sim, b, 'brute', b.map.paths[0].length - 0.1);
    const leaked: number[] = [];
    moveEnemies(b, 0.5, (e) => leaked.push(e.id));
    expect(leaked).toContain(brute.id);
    expect(brute.alive).toBe(false);
  });

  it('leaks reduce board lives in the real step loop', () => {
    const sim = makeSim('coop', 1);
    sim.nextWaveIn = null;
    const b = sim.boards[0];
    const lives = b.lives;
    spawnAt(sim, b, 'knight', b.map.paths[0].length - 0.01);
    sim.step();
    expect(b.lives).toBe(lives - ENEMIES.knight.lives);
  });
});

describe('targeting modes', () => {
  it('first / last / strongest / closest', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    // three enemies around (10,10), different progress + hp
    const a = enemyAtXY(sim, b, 'grunt', 10, 10, 30);
    a.dist = 20;
    const c = enemyAtXY(sim, b, 'grunt', 11.5, 10, 80);
    c.dist = 30; // furthest along → "first"
    const d = enemyAtXY(sim, b, 'grunt', 9, 11.5, 50);
    d.dist = 10; // least progress → "last"
    expect(selectTarget(b, 10, 10.5, 3, 'first')?.id).toBe(c.id);
    expect(selectTarget(b, 10, 10.5, 3, 'last')?.id).toBe(d.id);
    expect(selectTarget(b, 10, 10.5, 3, 'strong')?.id).toBe(c.id);
    expect(selectTarget(b, 10, 10.5, 3, 'close')?.id).toBe(a.id);
    // out of range → ignored
    expect(selectTarget(b, 0, 0, 1, 'first')).toBeNull();
  });
});

describe('damage rules', () => {
  it('armor reduces damage but a hit always deals at least 20%', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const k = spawnAt(sim, b, 'knight', 1, 1000); // armor 8
    expect(damageEnemy(k, 30)).toBe(22);
    expect(damageEnemy(k, 10)).toBe(2); // max(10-8, 2)
    expect(damageEnemy(k, 5)).toBe(1); // max(-3, 1)
    expect(damageEnemy(k, 90, true)).toBe(90); // sniper ignores armor
  });

  it('slows never stack: strongest wins, weaker does not override; bosses take half', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const g = spawnAt(sim, b, 'grunt', 1);
    applySlow(g, 0.35, 1.5);
    expect(g.slowAmt).toBeCloseTo(0.35);
    applySlow(g, 0.55, 1.6);
    expect(g.slowAmt).toBeCloseTo(0.55);
    applySlow(g, 0.35, 5);
    expect(g.slowAmt).toBeCloseTo(0.55);
    expect(g.slowTime).toBeCloseTo(1.6);
    const before = g.dist;
    moveEnemies(b, 0.1, () => {});
    expect(g.dist - before).toBeCloseTo(0.1 * (1 - 0.55), 6);
    // expires
    moveEnemies(b, 2, () => {});
    expect(g.slowAmt).toBe(0);
    const boss = spawnAt(sim, b, 'warlord', 1);
    applySlow(boss, 0.5, 1);
    expect(boss.slowAmt).toBeCloseTo(0.25);
  });

  it('cannon splash hits everything in the radius and nothing outside', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const near1 = enemyAtXY(sim, b, 'grunt', 10, 10, 100);
    const near2 = enemyAtXY(sim, b, 'grunt', 10.8, 10, 100);
    const far = enemyAtXY(sim, b, 'grunt', 11.5, 10, 100);
    const r = sim.placeTower('p0', 0, firstTile(greenfield, TILE_BUILDABLE).tx, firstTile(greenfield, TILE_BUILDABLE).ty, 'cannon');
    expect(r.ok).toBe(true);
    const tower = b.towers[0];
    const n = explode(sim, b, tower, 10, 10, 1.0, 30);
    expect(n).toBe(2);
    expect(near1.hp).toBe(70);
    expect(near2.hp).toBe(70);
    expect(far.hp).toBe(100);
  });

  it('cannon shells travel to the target before exploding', () => {
    const sim = makeSim('coop', 1);
    sim.nextWaveIn = null;
    const b = sim.boards[0];
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE, (x, y) => x === 5 && y === 4);
    expect(sim.placeTower('p0', 0, tx, ty, 'cannon').ok).toBe(true);
    const e = enemyAtXY(sim, b, 'brute', tx + 0.5 - 2.3, ty + 0.5, 1000);
    e.speed = 0;
    updateTowers(sim, b, 0.05);
    expect(b.shells.length).toBe(1);
    expect(e.hp).toBe(1000);
    for (let i = 0; i < 10 && b.shells.length; i++) updateShells(sim, b, 0.05);
    expect(b.shells.length).toBe(0);
    expect(e.hp).toBe(1000 - (30 - ENEMIES.brute.armor));
  });

  it('tesla chains to N targets losing 20% per jump', () => {
    const sim = makeSim('coop', 1);
    sim.nextWaveIn = null;
    const b = sim.boards[0];
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE, (x, y) => x === 6 && y === 6);
    sim.players.get('p0')!.money = 5000;
    expect(sim.placeTower('p0', 0, tx, ty, 'tesla').ok).toBe(true);
    const cx = tx + 0.5;
    const cy = ty + 0.5;
    const es = [0, 1, 2, 3].map((i) => {
      const e = enemyAtXY(sim, b, 'grunt', cx + 1 + i * 1.2, cy, 1000);
      e.dist = 50 - i; // first enemy is the "first" target
      return e;
    });
    updateTowers(sim, b, 0.05);
    expect(1000 - es[0].hp).toBeCloseTo(22, 5);
    expect(1000 - es[1].hp).toBeCloseTo(17.6, 5);
    expect(1000 - es[2].hp).toBeCloseTo(14.08, 5);
    expect(es[3].hp).toBe(1000); // L1 chains to 3 targets total
    expect(b.fx.some((f) => f.k === 'chain')).toBe(true);
  });

  it('frost L3 pulse hits every enemy in range', () => {
    const sim = makeSim('coop', 1);
    sim.nextWaveIn = null;
    const b = sim.boards[0];
    sim.players.get('p0')!.money = 5000;
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE, (x, y) => x === 6 && y === 6);
    const r = sim.placeTower('p0', 0, tx, ty, 'frost');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    sim.upgradeTower('p0', r.towerId);
    sim.upgradeTower('p0', r.towerId);
    const es = [enemyAtXY(sim, b, 'grunt', tx + 1.5, ty + 0.5, 100), enemyAtXY(sim, b, 'grunt', tx - 1, ty + 1, 100), enemyAtXY(sim, b, 'grunt', tx + 0.5, ty + 3, 100)];
    updateTowers(sim, b, 0.05);
    for (const e of es) {
      expect(e.hp).toBe(100 - TOWERS.frost.levels[2].damage);
      expect(e.slowAmt).toBeCloseTo(0.55);
    }
  });

  it('healers heal nearby non-healers by 2% max HP per second, and healing does not stack', () => {
    const sim = makeSim('coop', 1);
    const b = sim.boards[0];
    const h = enemyAtXY(sim, b, 'healer', 10, 10, 90);
    h.hp = 45;
    const other = enemyAtXY(sim, b, 'healer', 10.5, 10, 90);
    other.hp = 40;
    const near = enemyAtXY(sim, b, 'grunt', 11, 10, 100);
    near.hp = 50;
    const far = enemyAtXY(sim, b, 'grunt', 14, 10, 100);
    far.hp = 50;
    for (let i = 0; i < 20; i++) applyHealers(b, 0.05);
    expect(near.hp).toBeCloseTo(52, 5);
    expect(far.hp).toBe(50);
    expect(h.hp).toBe(45);
    expect(other.hp).toBe(40);
  });
});

describe('economy & scaling', () => {
  it('defenderScale and hp tax', () => {
    expect([1, 2, 3, 4].map(defenderScale)).toEqual([1, 1.6, 2.2, 2.8]);
    expect(defenderHpScale(1)).toBe(1);
    expect(defenderHpScale(4)).toBeCloseTo(1.15);
  });

  it('start cash and wave bonus split so team totals scale with defenderScale', () => {
    for (const k of [1, 2, 3, 4]) {
      const sim = makeSim('coop', k);
      const each = startCashPerPlayer(k, 'normal');
      for (const p of sim.players.values()) expect(p.money).toBe(each);
      expect(each * k).toBeCloseTo(ECONOMY.soloStartCash * defenderScale(k), -1);
      expect(waveBonusPerPlayer(5, k) * k).toBeCloseTo(waveBonusPerPlayer(5, 1) * defenderScale(k), 6);
    }
    expect(startCashPerPlayer(1, 'easy')).toBe(Math.round(ECONOMY.soloStartCash * DIFFICULTY.easy.startCashMult));
  });

  it('kill bounty is split evenly between the board defenders', () => {
    const sim = makeSim('coop', 2);
    sim.nextWaveIn = null;
    const b = sim.boards[0];
    const [p0, p1] = [sim.players.get('p0')!, sim.players.get('p1')!];
    const m0 = p0.money;
    const m1 = p1.money;
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE, (x, y) => x === 5 && y === 4);
    sim.placeTower('p0', 0, tx, ty, 'archer');
    const e = enemyAtXY(sim, b, 'knight', tx + 1.5, ty + 0.5, 1);
    e.speed = 0;
    updateTowers(sim, b, 0.05);
    expect(e.alive).toBe(false);
    expect(p0.money - (m0 - 100)).toBeCloseTo(ENEMIES.knight.bounty / 2);
    expect(p1.money - m1).toBeCloseTo(ENEMIES.knight.bounty / 2);
    expect(p0.stats.kills).toBe(1);
    expect(p1.stats.kills).toBe(0);
  });

  it('AI waves scale count by defenderScale(k), with HP compensation for rounding', () => {
    const solo = generateWave(10);
    for (const k of [1, 2, 3, 4]) {
      const scaled = scaleWaveForBoard(solo, k);
      solo.forEach((g, i) => {
        expect(scaled[i].count).toBe(Math.max(1, Math.round(g.count * defenderScale(k))));
        // total "unit-equivalents" exactly ds × solo
        expect(scaled[i].count * scaled[i].hpComp).toBeCloseTo(g.count * defenderScale(k), 6);
        expect(scaled[i].spacing).toBeCloseTo(g.spacing / defenderScale(k), 6);
      });
    }
    // enemies actually queued on a 4-player board
    const sim = makeSim('coop', 4);
    sim.nextWaveIn = 0.01;
    sim.step();
    const queued = sim.boards[0].queue.length + sim.boards[0].enemies.length;
    const expected = scaleWaveForBoard(generateWave(1), 4).reduce((a, g) => a + g.count, 0);
    expect(queued).toBe(expected);
    expect(sim.boards[0].enemies[0].maxHp).toBe(Math.round(enemyHp('grunt', 1, 'normal', 4) * scaleWaveForBoard(generateWave(1), 4)[0].hpComp));
  });

  it('board lives scale with defenderScale', () => {
    expect(boardLives(25, 1)).toBe(25);
    expect(boardLives(25, 2)).toBe(40);
    expect(makeSim('coop', 4).boards[0].maxLives).toBe(70);
    expect(makeSim('ffa', 3).boards.every((b) => b.maxLives === 25)).toBe(true);
  });

  it('sends into a 2-player board are 1.6× bigger', () => {
    expect(scaledSendCount(6, 1)).toBe(6);
    expect(scaledSendCount(6, 2)).toBe(10); // 9.6 → 10 (HP compensated 0.96×)
    expect(scaledSendCount(5, 2)).toBe(8);
    expect(scaledSendCount(1, 4)).toBe(3);
  });

  it('sell refunds 70% of everything invested', () => {
    const sim = makeSim('coop', 1);
    const p = sim.players.get('p0')!;
    p.money = 1000;
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE);
    const r = sim.placeTower('p0', 0, tx, ty, 'archer');
    if (!r.ok) throw new Error(r.error);
    expect(sim.upgradeTower('p0', r.towerId).ok).toBe(true);
    expect(p.money).toBe(1000 - 100 - 90);
    const s = sim.sellTower('p0', r.towerId);
    expect(s.ok && s.refund).toBe(Math.floor(190 * 0.7));
    expect(p.money).toBe(1000 - 190 + 133);
    expect(sim.boards[0].towers.length).toBe(0);
  });

  it('gold mines pay their owner at each wave start', () => {
    const sim = makeSim('coop', 2);
    const p = sim.players.get('p1')!;
    p.money = 1000;
    const { tx, ty } = firstTile(greenfield, TILE_BUILDABLE);
    expect(sim.placeTower('p1', 0, tx, ty, 'mine').ok).toBe(true);
    const before = p.money;
    const other = sim.players.get('p0')!.money;
    sim.nextWaveIn = 0.01;
    sim.step();
    expect(p.money - before).toBe(TOWERS.mine.levels[0].income);
    expect(sim.players.get('p0')!.money).toBe(other);
  });
});

describe('tower placement validation', () => {
  it('rejects path, decorations, occupied, out of bounds, unaffordable, foreign boards and >3 mines', () => {
    const sim = makeSim('coop', 1);
    const map = MAPS.greenfield;
    const path = firstTile(map, TILE_PATH);
    const deco = firstTile(map, TILE_BLOCKED);
    const ok = firstTile(map, TILE_BUILDABLE);
    expect(sim.placeTower('p0', 0, path.tx, path.ty, 'archer')).toMatchObject({ ok: false });
    expect(sim.placeTower('p0', 0, deco.tx, deco.ty, 'archer')).toMatchObject({ ok: false });
    expect(sim.placeTower('p0', 0, -1, 3, 'archer')).toMatchObject({ ok: false, error: 'Out of bounds' });
    expect(sim.placeTower('p0', 0, 24, 3, 'archer')).toMatchObject({ ok: false, error: 'Out of bounds' });
    expect(sim.placeTower('p0', 0, 1.5, 3, 'archer')).toMatchObject({ ok: false });
    expect(sim.placeTower('p0', 0, ok.tx, ok.ty, 'archer').ok).toBe(true);
    expect(sim.placeTower('p0', 0, ok.tx, ok.ty, 'archer')).toMatchObject({ ok: false, error: 'Tile occupied' });
    sim.players.get('p0')!.money = 50;
    const ok2 = firstTile(map, TILE_BUILDABLE, (x, y) => x !== ok.tx || y !== ok.ty);
    expect(sim.placeTower('p0', 0, ok2.tx, ok2.ty, 'archer')).toMatchObject({ ok: false, error: 'Not enough money' });
    // mines capped at 3 per player
    sim.players.get('p0')!.money = 10_000;
    let placed = 0;
    const errors: string[] = [];
    for (let y = 0; y < map.height && placed < 5; y++)
      for (let x = 0; x < map.width && placed < 5; x++) {
        if (map.tiles[y * map.width + x] !== TILE_BUILDABLE || sim.boards[0].tileTower.has(y * map.width + x)) continue;
        const r = sim.placeTower('p0', 0, x, y, 'mine');
        placed++;
        if (!r.ok) errors.push(r.error);
      }
    expect(errors).toEqual(['Max 3 gold mines', 'Max 3 gold mines']);
  });

  it('only owners can upgrade/sell/retarget; versus players build only on their own board', () => {
    const sim = makeSim('coop', 2);
    const ok = firstTile(MAPS.greenfield, TILE_BUILDABLE);
    const r = sim.placeTower('p0', 0, ok.tx, ok.ty, 'archer');
    if (!r.ok) throw new Error(r.error);
    expect(sim.upgradeTower('p1', r.towerId)).toMatchObject({ ok: false, error: 'Only the owner can do that' });
    expect(sim.sellTower('p1', r.towerId).ok).toBe(false);
    expect(sim.setTargeting('p1', r.towerId, 'last').ok).toBe(false);
    expect(sim.setTargeting('p0', r.towerId, 'last').ok).toBe(true);
    const vs = makeSim('ffa', 2);
    expect(vs.placeTower('p0', 1, ok.tx, ok.ty, 'archer')).toMatchObject({ ok: false });
    expect(vs.placeTower('p0', 0, ok.tx, ok.ty, 'archer').ok).toBe(true);
    // loadout hook
    const lim = makeSim('coop', 1);
    lim.players.get('p0')!.loadout = ['archer'];
    expect(lim.placeTower('p0', 0, ok.tx, ok.ty, 'cannon')).toMatchObject({ ok: false });
  });

  it('lets the owner move a tower once for free, then frees the old square', () => {
    const sim = makeSim('coop', 2);
    const map = MAPS.greenfield;
    const a = firstTile(map, TILE_BUILDABLE);
    const b = firstTile(map, TILE_BUILDABLE, (x, y) => x !== a.tx || y !== a.ty);
    const placed = sim.placeTower('p0', 0, a.tx, a.ty, 'archer');
    if (!placed.ok) throw new Error(placed.error);
    const money = sim.players.get('p0')!.money;
    expect(sim.moveTower('p1', placed.towerId, b.tx, b.ty)).toMatchObject({ ok: false, error: 'Only the owner can do that' });
    expect(sim.moveTower('p0', placed.towerId, a.tx, a.ty)).toMatchObject({ ok: false, error: 'Already there' });
    expect(sim.moveTower('p0', placed.towerId, b.tx, b.ty).ok).toBe(true);
    const t = sim.getTower(placed.towerId)!;
    expect(t.tx).toBe(b.tx);
    expect(t.ty).toBe(b.ty);
    expect(t.x).toBeCloseTo(b.tx + 0.5);
    expect(t.y).toBeCloseTo(b.ty + 0.5);
    expect(t.freeMove).toBe(false);
    expect(sim.players.get('p0')!.money).toBe(money);
    expect(sim.boards[0].tileTower.has(a.ty * map.width + a.tx)).toBe(false);
    expect(sim.boards[0].tileTower.get(b.ty * map.width + b.tx)?.id).toBe(t.id);
    const c = firstTile(map, TILE_BUILDABLE, (x, y) => (x !== a.tx || y !== a.ty) && (x !== b.tx || y !== b.ty));
    expect(sim.moveTower('p0', placed.towerId, c.tx, c.ty)).toMatchObject({ ok: false, error: 'This tower was already moved' });
    expect(sim.placeTower('p0', 0, a.tx, a.ty, 'archer').ok).toBe(true);
    expect(sim.snapshot(null, false).boards[0].towers?.find((tw) => tw.id === t.id)?.freeMove).toBe(false);
  });
});

describe('sending troops', () => {
  it('validates mode, unlock wave, money and cooldown; raises income and spawns after the warning', () => {
    const coop = makeSim('coop', 2);
    expect(coop.sendTroops('p0', 'grunts')).toMatchObject({ ok: false });

    const sim = makeSim('ffa', 2);
    const p0 = sim.players.get('p0')!;
    expect(sim.sendTroops('p0', 'grunts')).toMatchObject({ ok: false, error: 'Unlocks at wave 1' });
    sim.nextWaveIn = 0.01;
    sim.step(); // wave 1
    expect(sim.wave).toBe(1);
    expect(sim.sendTroops('p0', 'runners')).toMatchObject({ ok: false, error: 'Unlocks at wave 3' });
    const money = p0.money;
    const target = sim.boards[1];
    const queued = target.queue.length;
    const r = sim.sendTroops('p0', 'grunts', 'p1');
    expect(r).toMatchObject({ ok: true, count: 6, targetBoard: 1 });
    expect(p0.money).toBe(money - SEND_PACKS.grunts.cost);
    expect(p0.income).toBe(SEND_PACKS.grunts.income);
    expect(target.queue.length).toBe(queued + 6);
    expect(target.fx.some((f) => f.k === 'inc' && f.count === 6 && f.from === 'p0')).toBe(true);
    const sent = target.queue.filter((q) => q.sent);
    expect(Math.min(...sent.map((q) => q.at))).toBeCloseTo(sim.time + TIMING.sendWarning, 5);
    expect(sent[0].bountyMult).toBe(ECONOMY.sentBountyFactor);
    expect(sim.sendTroops('p0', 'grunts')).toMatchObject({ ok: false, error: 'On cooldown' });
    stepFor(sim, SEND_PACKS.grunts.cooldown + 0.1);
    p0.money = 10;
    expect(sim.sendTroops('p0', 'grunts')).toMatchObject({ ok: false, error: 'Not enough money' });
    expect(sim.sendTroops('p0', 'grunts', 'p0')).toMatchObject({ ok: false });
    // income is paid at the next wave start (on top of the wave bonus)
    p0.money = 0;
    sim.nextWaveIn = 0.01;
    sim.step();
    expect(p0.money).toBeCloseTo(SEND_PACKS.grunts.income + waveBonusPerPlayer(1, 1), 6);
  });

  it('team mode: sends into a 2-player board are multiplied by 1.6 and keep current-wave HP', () => {
    const sim = makeSim('teams', 3, { team: (i) => (i === 0 ? 0 : 1) });
    expect(sim.boards[1].defenders.length).toBe(2);
    sim.nextWaveIn = 0.01;
    sim.step();
    sim.players.get('p0')!.money = 1000;
    const r = sim.sendTroops('p0', 'grunts');
    expect(r).toMatchObject({ ok: true, count: 10, targetBoard: 1 });
    const sent = sim.boards[1].queue.filter((q) => q.sent);
    expect(sent.length).toBe(10);
    expect(sent[0].hp).toBe(Math.round(enemyHp('grunt', 1, 'normal', 2) * 0.96));
    // and the reverse direction is not scaled (1 defender)
    sim.players.get('p1')!.money = 1000;
    expect(sim.sendTroops('p1', 'grunts')).toMatchObject({ ok: true, count: 6, targetBoard: 0 });
  });

  it('FFA default target is the next alive player clockwise', () => {
    const sim = makeSim('ffa', 3);
    expect(sim.defaultTarget('p0')).toBe('p1');
    expect(sim.defaultTarget('p2')).toBe('p0');
    sim.boards[1].lives = 0;
    sim.step();
    expect(sim.boards[1].alive).toBe(false);
    expect(sim.defaultTarget('p0')).toBe('p2');
  });
});

describe('waves & match flow', () => {
  it('wave generator is deterministic and introduces types gradually', () => {
    for (let w = 1; w <= 40; w++) expect(generateWave(w)).toEqual(generateWave(w));
    const differs = [8, 9, 11, 13, 14, 16].some((w) => JSON.stringify(generateWave(w, 1)) !== JSON.stringify(generateWave(w, 2)));
    expect(differs).toBe(true);
    const typesAt = (w: number) => new Set(generateWave(w).map((g) => g.type));
    for (let w = 1; w <= 2; w++) expect([...typesAt(w)]).toEqual(['grunt']);
    expect(typesAt(3).has('runner')).toBe(true);
    expect(typesAt(5).has('swarm')).toBe(true);
    expect(typesAt(7).has('brute')).toBe(true);
    expect(typesAt(10).has('warlord')).toBe(true);
    expect(typesAt(12).has('knight')).toBe(true);
    expect(typesAt(15).has('healer')).toBe(true);
    for (let w = 1; w <= 40; w++) {
      const healers = generateWave(w).filter((g) => g.type === 'healer').reduce((n, g) => n + g.count, 0);
      expect(healers).toBeLessThanOrEqual(4);
    }
    for (let w = 1; w < 12; w++) expect(typesAt(w).has('knight')).toBe(false);
    for (let w = 1; w < 10; w++) expect(typesAt(w).has('warlord')).toBe(false);
    expect(bossCount(20)).toBe(2);
    expect(waveUnitCount(generateWave(20))).toBeGreaterThan(waveUnitCount(generateWave(2)));
  });

  it('co-op: all players ready starts the next wave early with a 10% bonus', () => {
    const sim = makeSim('coop', 2);
    const p0 = sim.players.get('p0')!;
    const m = p0.money;
    sim.setReady('p0', true);
    sim.step();
    expect(sim.wave).toBe(0);
    sim.setReady('p1', true);
    sim.step();
    expect(sim.wave).toBe(1);
    expect(p0.money - m).toBeCloseTo(waveBonusPerPlayer(1, 2) * ECONOMY.earlyCallBonusFactor, 6);
    expect(p0.ready).toBe(false);
    // disconnected players don't block readiness
    sim.setConnected('p1', false);
    expect(sim.speed).toBe(1);
    sim.setSpeedVote('p0', true);
    expect(sim.speed).toBe(2);
  });

  it('co-op: clearing the final wave is a victory; zero lives is a defeat', () => {
    const sim = makeSim('coop', 1, { rules: { finalWave: 1, firstWaveDelay: 0.05 } });
    sim.players.get('p0')!.money = 100_000;
    // ring the path with archers
    let n = 0;
    for (let y = 0; y < 14 && n < 30; y++)
      for (let x = 0; x < 24 && n < 30; x++) if (sim.placeTower('p0', 0, x, y, 'archer').ok) n++;
    stepFor(sim, 120);
    expect(sim.result?.outcome).toBe('victory');
    expect(sim.result?.wavesSurvived).toBe(1);

    const lose = makeSim('coop', 1, { rules: { firstWaveDelay: 0.05 } });
    stepFor(lose, 400);
    expect(lose.result?.outcome).toBe('defeat');
    expect(lose.result!.wavesSurvived).toBeLessThanOrEqual(4);
  });

  it('versus: AI waves arrive on every board at the same time; last board standing wins', () => {
    const sim = makeSim('ffa', 3, { rules: { firstWaveDelay: 0.05, waveInterval: 5 } });
    stepFor(sim, 1);
    expect(sim.boards.map((b) => b.queue.length + b.enemies.length)).toEqual([0, 1, 2].map(() => sim.boards[0].queue.length + sim.boards[0].enemies.length));
    sim.boards[0].lives = 0;
    sim.step();
    expect(sim.players.get('p0')!.alive).toBe(false);
    expect(sim.placeTower('p0', 0, 5, 4, 'archer')).toMatchObject({ ok: false, error: 'You have been eliminated' });
    expect(sim.phase).not.toBe('over');
    sim.markLeft('p2'); // forfeit: board eliminated
    expect(sim.result?.winners).toEqual(['p1']);
  });
});
