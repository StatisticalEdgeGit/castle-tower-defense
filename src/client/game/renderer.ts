// Canvas 2D board renderer: cached static map layer + interpolated entities + fx.
import { PLAYER_COLORS, SEND_PACKS, TOWERS } from '../../shared/config';
import { MAPS, TILE_BUILDABLE, type GameMap } from '../../shared/maps';
import type { Fx } from '../../shared/protocol';
import { towerCenter } from '../../shared/reach';
import { drawEnemy, drawMapStatic, drawTower, enemyTypeFromIndex, ENEMY_COLORS } from './art';
import { themedEnemyColor } from './themeArt';
import { getViewTheme, type ViewTheme } from './viewTheme';
import { game } from './gameState';
import { interpolateEnemies, interpolateShells } from './interpolation';
import { placementPreview, type RangePreview } from './placement';

type Effect =
  | { kind: 'line'; t0: number; dur: number; x1: number; y1: number; x2: number; y2: number; style: 'arrow' | 'tracer' | 'frost' | 'venom' }
  | { kind: 'chain'; t0: number; dur: number; pts: number[]; seed: number }
  | { kind: 'ring'; t0: number; dur: number; x: number; y: number; r: number; color: string; fill?: string }
  | { kind: 'particles'; t0: number; dur: number; parts: { x: number; y: number; vx: number; vy: number; size: number; color: string }[] }
  | { kind: 'text'; t0: number; dur: number; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'flash'; t0: number; dur: number; color: string }
  | { kind: 'banner'; t0: number; dur: number; text: string; sub: string; color: string }
  | { kind: 'cone'; t0: number; dur: number; x: number; y: number; a: number; r: number; c: number };

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function fillTiles(ctx: CanvasRenderingContext2D, indices: number[], width: number, s: number, color: string): void {
  if (!indices.length) return;
  ctx.fillStyle = color;
  for (const i of indices) {
    const tx = i % width;
    const ty = (i / width) | 0;
    ctx.fillRect(tx * s, ty * s, s, s);
  }
}

/** Range circle from the square's centre, plus which road squares that circle really covers. */
function drawReachUnder(ctx: CanvasRenderingContext2D, map: GameMap, s: number, p: RangePreview, editing: boolean): void {
  ctx.save();
  const { x: cx, y: cy } = towerCenter(p.tx, p.ty);
  const reached = new Set(p.coverage?.reached ?? []);
  if (p.maxCoverage) fillTiles(ctx, p.maxCoverage.reached.filter((i) => !reached.has(i)), map.width, s, 'rgba(255, 210, 80, 0.2)');
  if (p.coverage) {
    fillTiles(ctx, p.coverage.grazed, map.width, s, 'rgba(255, 64, 64, 0.34)');
    fillTiles(ctx, p.coverage.reached, map.width, s, 'rgba(70, 220, 110, 0.4)');
  }
  const px = cx * s;
  const py = cy * s;
  if (p.range > 0) {
    const miss = p.reaches === false;
    ctx.beginPath();
    ctx.arc(px, py, p.range * s, 0, Math.PI * 2);
    ctx.fillStyle = !p.ok ? 'rgba(255,60,60,0.08)' : miss ? 'rgba(255,170,40,0.1)' : 'rgba(80,255,140,0.1)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = !p.ok ? 'rgba(255,90,90,0.95)' : miss ? 'rgba(255,186,60,0.95)' : 'rgba(120,255,160,0.95)';
    ctx.stroke();
  }
  if (p.minRange > 0) {
    ctx.beginPath();
    ctx.arc(px, py, p.minRange * s, 0, Math.PI * 2);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,90,90,0.95)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (p.maxRange > p.range + 0.05) {
    ctx.beginPath();
    ctx.arc(px, py, p.maxRange * s, 0, Math.PI * 2);
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 210, 80, 0.8)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (editing) {
    ctx.fillStyle = !p.ok ? 'rgba(255,60,60,0.38)' : p.reaches === false ? 'rgba(255,180,40,0.36)' : 'rgba(80,255,120,0.3)';
    ctx.fillRect(p.tx * s, p.ty * s, s, s);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.tx * s + 1, p.ty * s + 1, s - 2, s - 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, s * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawReachLine(ctx: CanvasRenderingContext2D, map: GameMap, s: number, p: RangePreview, editing: boolean): void {
  if (!p.coverage) return;
  ctx.save();
  ctx.lineCap = 'round';
  if (editing) {
    ctx.strokeStyle = 'rgba(255, 70, 70, 0.55)';
    ctx.lineWidth = Math.max(2, s * 0.18);
    ctx.beginPath();
    for (const path of map.paths) {
      const pts = path.points;
      if (pts.length < 2) continue;
      ctx.moveTo(pts[0].x * s, pts[0].y * s);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * s, pts[i].y * s);
    }
    ctx.stroke();
  }
  if (p.coverage.spans.length) {
    ctx.strokeStyle = 'rgba(90, 255, 150, 0.95)';
    ctx.lineWidth = Math.max(3, s * 0.26);
    ctx.beginPath();
    for (const sp of p.coverage.spans) {
      ctx.moveTo(sp.x1 * s, sp.y1 * s);
      ctx.lineTo(sp.x2 * s, sp.y2 * s);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export class BoardRenderer {
  readonly ctx: CanvasRenderingContext2D;
  map: GameMap | null = null;
  boardId = -1;
  tile = 32;
  ox = 0;
  oy = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private staticLayer: HTMLCanvasElement | null = null;
  private effects: Effect[] = [];
  private fxCursor = 0;
  private dirs = new Map<number, number>();
  private angles = new Map<number, number>();
  private recoil = new Map<number, number>();
  private lastNow = 0;
  private themeSeen: ViewTheme | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly mini = false,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
  }

  setBoard(boardId: number, map: GameMap): void {
    if (this.boardId === boardId && this.map === map) return;
    this.boardId = boardId;
    this.map = map;
    this.effects = [];
    this.fxCursor = game.fxEvents.length ? game.fxEvents[game.fxEvents.length - 1].n : 0;
    this.staticLayer = null;
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.staticLayer = null;
  }

  private layout(): void {
    const map = this.map!;
    this.tile = Math.min(this.cssW / map.width, this.cssH / map.height);
    this.ox = (this.cssW - this.tile * map.width) / 2;
    this.oy = (this.cssH - this.tile * map.height) / 2;
  }

  private buildStatic(): void {
    const map = this.map!;
    this.layout();
    const c = document.createElement('canvas');
    const s = this.tile * this.dpr;
    c.width = Math.ceil(map.width * s);
    c.height = Math.ceil(map.height * s);
    const cx = c.getContext('2d')!;
    drawMapStatic(cx, map, s, !this.mini);
    this.staticLayer = c;
  }

  /** Client pixel → tile (null if outside the board). */
  tileAt(clientX: number, clientY: number): { tx: number; ty: number } | null {
    if (!this.map) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = (clientX - r.left - this.ox) / this.tile;
    const y = (clientY - r.top - this.oy) / this.tile;
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
    return { tx: Math.floor(x), ty: Math.floor(y) };
  }

  // ── fx ────────────────────────────────────────────────────────────────────
  private addFx(fx: Fx, now: number): void {
    const t = now;
    const mini = this.mini;
    switch (fx.k) {
      case 'shot': {
        if (mini) return;
        const style = fx.t === 'sniper' ? 'tracer' : fx.t === 'frost' ? 'frost' : fx.t === 'venom' ? 'venom' : 'arrow';
        this.effects.push({ kind: 'line', t0: t, dur: style === 'tracer' ? 220 : 130, x1: fx.x1, y1: fx.y1, x2: fx.x2, y2: fx.y2, style });
        this.markRecoil(fx.x1, fx.y1, t);
        break;
      }
      case 'chain':
        if (mini) return;
        this.effects.push({ kind: 'chain', t0: t, dur: 200, pts: fx.pts, seed: Math.random() * 1000 });
        this.markRecoil(fx.pts[0], fx.pts[1], t);
        break;
      case 'boom':
        this.effects.push({ kind: 'ring', t0: t, dur: 320, x: fx.x, y: fx.y, r: fx.r, color: 'rgba(255,190,90,1)', fill: 'rgba(255,140,40,0.35)' });
        if (!mini) this.burst(fx.x, fx.y, 10, ['#ffb547', '#ff7a2f', '#5b5b5b'], 2.2, t, 450);
        break;
      case 'pulse':
        if (mini) return;
        this.effects.push({ kind: 'ring', t0: t, dur: 380, x: fx.x, y: fx.y, r: fx.r, color: 'rgba(170,230,255,1)', fill: 'rgba(140,215,255,0.18)' });
        break;
      case 'death': {
        if (mini) return;
        const type = enemyTypeFromIndex(fx.e);
        const skin = getViewTheme();
        const paint = skin === 'classic' ? ENEMY_COLORS[type] : themedEnemyColor(skin, type);
        this.burst(fx.x, fx.y, type === 'warlord' ? 26 : 7, [paint, '#ffffff', '#333'], type === 'warlord' ? 3 : 1.6, t, 420);
        const me = game.myInfo();
        if (fx.b > 0 && me && me.boardId === this.boardId) {
          const amount = fx.b >= 10 ? Math.round(fx.b) : Math.round(fx.b * 10) / 10;
          this.effects.push({ kind: 'text', t0: t, dur: 900, x: fx.x, y: fx.y - 0.2, text: `+$${amount}`, color: '#ffd23f', size: 0.36 });
        }
        break;
      }
      case 'leak':
        this.effects.push({ kind: 'flash', t0: t, dur: 450, color: 'rgba(255,40,40,0.28)' });
        if (!mini) this.effects.push({ kind: 'text', t0: t, dur: 1100, x: fx.x, y: fx.y - 0.4, text: `-${fx.n}♥`, color: '#ff5d5d', size: 0.5 });
        break;
      case 'inc': {
        const from = game.playerInfo(fx.from);
        const color = from ? PLAYER_COLORS[from.color] : '#ff5d5d';
        if (mini) {
          this.effects.push({ kind: 'flash', t0: t, dur: 600, color: 'rgba(255,120,40,0.25)' });
          return;
        }
        const pack = SEND_PACKS[fx.pack];
        const base = pack.units.reduce((a, u) => a + u.count, 0);
        this.effects.push({
          kind: 'banner',
          t0: t,
          dur: 2600,
          text: `INCOMING from ${from?.name ?? '???'}`,
          sub: fx.count === base ? pack.name : `${pack.name} — ${fx.count} units (team-size bonus)`,
          color,
        });
        break;
      }
      case 'build':
        if (mini) return;
        this.effects.push({ kind: 'ring', t0: t, dur: 350, x: fx.x, y: fx.y, r: 0.6, color: 'rgba(255,255,255,0.9)' });
        break;
      case 'sell':
        if (mini) return;
        this.burst(fx.x, fx.y, 8, ['#c9a36b', '#888'], 1.4, t, 400);
        this.effects.push({ kind: 'text', t0: t, dur: 900, x: fx.x, y: fx.y - 0.2, text: `+$${fx.v}`, color: '#9cff9c', size: 0.36 });
        break;
      case 'flame':
        if (mini) return;
        this.effects.push({ kind: 'cone', t0: t, dur: 160, x: fx.x, y: fx.y, a: fx.a, r: fx.r, c: fx.c });
        break;
      case 'shieldup':
        this.effects.push({ kind: 'ring', t0: t, dur: 600, x: fx.x, y: fx.y, r: fx.r, color: 'rgba(170,200,255,1)', fill: 'rgba(120,160,255,0.25)' });
        break;
      case 'wave':
        if (mini) return;
        this.effects.push({
          kind: 'banner',
          t0: t,
          dur: 1900,
          text: fx.boss ? `BOSS WAVE ${fx.wave}` : `WAVE ${fx.wave}`,
          sub: fx.boss ? 'The Warlord approaches!' : '',
          color: fx.boss ? '#ff4d6d' : '#ffffff',
        });
        break;
    }
  }

  private markRecoil(x: number, y: number, t: number): void {
    const tw = game.towerAt(this.boardId, Math.floor(x), Math.floor(y));
    if (tw) this.recoil.set(tw.id, t);
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, t: number, dur: number): void {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, size: 0.05 + Math.random() * 0.06, color: colors[i % colors.length] });
    }
    this.effects.push({ kind: 'particles', t0: t, dur, parts });
  }

  // ── main draw ─────────────────────────────────────────────────────────────
  render(now: number): void {
    const map = this.map;
    if (!map || this.cssW === 0) return;
    const skin = getViewTheme();
    if (this.themeSeen !== skin) {
      this.themeSeen = skin;
      this.staticLayer = null;
    }
    if (!this.staticLayer) this.buildStatic();
    this.layout();
    const ctx = this.ctx;
    const dpr = this.dpr;
    const s = this.tile;
    const time = now / 1000;
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticLayer!, Math.round(this.ox * dpr), Math.round(this.oy * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, this.ox * dpr, this.oy * dpr);

    const frame = game.buffer.frame(now);
    if (!frame) return;
    const bB = frame.b.boards[this.boardId];
    const bA = frame.a.boards[this.boardId];
    if (!bB) return;

    // fx whose snapshot has been reached by the render clock
    const evs = game.fxEvents;
    let i = 0;
    while (i < evs.length && evs[i].n <= this.fxCursor) i++;
    for (; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.seq > frame.renderSeq + 0.5) break;
      this.fxCursor = ev.n;
      if (ev.boardId === this.boardId) this.addFx(ev.fx, now);
    }

    const ui = game.ui;
    const isMain = !this.mini;
    const towers = game.towers.get(this.boardId) ?? [];
    const playerColor = (id: string) => {
      const p = game.playerInfo(id);
      return p ? PLAYER_COLORS[p.color] : '#888';
    };

    // build-mode grid
    if (isMain && ui.buildType && ui.viewBoard === this.boardId) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          if (map.tiles[y * map.width + x] !== TILE_BUILDABLE) continue;
          ctx.rect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
        }
      ctx.stroke();
    }

    const preview = isMain ? placementPreview(this.boardId, ui) : null;
    const editing = !!(ui.buildType || ui.moveTowerId !== null);
    if (preview && (editing || preview.kind !== 'none')) drawReachUnder(ctx, map, s, preview, editing);

    // towers
    const buffed = new Set(bB.buffed);
    for (const t of towers) {
      const target = game.aims.get(t.id);
      let a = this.angles.get(t.id) ?? -Math.PI / 2;
      if (target !== undefined) a = angleLerp(a, target, Math.min(1, dt * 14));
      this.angles.set(t.id, a);
      const rt = this.recoil.get(t.id);
      const recoil = rt ? Math.max(0, 1 - (now - rt) / 140) : 0;
      if (buffed.has(t.id)) {
        ctx.fillStyle = `rgba(255,90,90,${0.18 + 0.08 * Math.sin(time * 4)})`;
        ctx.beginPath();
        ctx.arc((t.tx + 0.5) * s, (t.ty + 0.5) * s, s * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const sliding = preview?.movingId === t.id && (preview.tx !== t.tx || preview.ty !== t.ty);
      drawTower(ctx, t.type, (t.tx + 0.5) * s, (t.ty + 0.5) * s, s, {
        level: t.level,
        angle: a,
        ownerColor: playerColor(t.owner),
        time,
        recoil,
        alpha: sliding ? 0.35 : 1,
      });
      if (!editing && ui.selectedTower === t.id) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(t.tx * s + 1, t.ty * s + 1, s - 2, s - 2);
        ctx.setLineDash([]);
      }
    }

    // enemies
    const enemies = interpolateEnemies(bA, bB, frame.alpha);
    enemies.sort((p, q) => p.y - q.y);
    const enemyPos = new Map<number, { x: number; y: number }>();
    const seen = new Set<number>();
    for (const e of enemies) {
      seen.add(e.id);
      let dir = this.dirs.get(e.id) ?? 0;
      if (Math.abs(e.dx) + Math.abs(e.dy) > 1e-4) {
        dir = Math.atan2(e.dy, e.dx);
        this.dirs.set(e.id, dir);
      }
      const type = enemyTypeFromIndex(e.typeIdx);
      drawEnemy(ctx, type, e.x * s, e.y * s, s, dir, e.hp, e.flags, time + e.id * 0.37, !this.mini || type === 'warlord');
      enemyPos.set(e.id, e);
    }
    if (this.dirs.size > enemies.length * 2 + 50) for (const id of [...this.dirs.keys()]) if (!seen.has(id)) this.dirs.delete(id);

    // prism beams
    for (let i = 0; i + 2 < bB.beams.length; i += 3) {
      const tw = towers.find((t) => t.id === bB.beams[i]);
      const en = enemyPos.get(bB.beams[i + 1]);
      if (!tw || !en) continue;
      const ramp = bB.beams[i + 2] / 100;
      const x1 = (tw.tx + 0.5) * s;
      const y1 = (tw.ty + 0.5) * s;
      const x2 = en.x * s;
      const y2 = en.y * s;
      const w = Math.max(1.5, s * (0.04 + 0.025 * ramp));
      const flick = 0.75 + 0.25 * Math.sin(now / 30 + i);
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, `rgba(255,140,220,${0.9 * flick})`);
      g.addColorStop(0.5, `rgba(150,220,255,${0.9 * flick})`);
      g.addColorStop(1, `rgba(255,255,200,${0.95 * flick})`);
      ctx.save();
      ctx.shadowColor = '#bfe8ff';
      ctx.shadowBlur = 6 + ramp * 3;
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(255,255,255,${0.6 * flick})`;
      ctx.beginPath();
      ctx.arc(x2, y2, w * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // cannon / mortar shells
    for (const sh of interpolateShells(bA, bB, frame.alpha)) {
      const big = sh.kind === 1 ? 1.5 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(sh.x * s + s * 0.05 * big, sh.y * s + s * 0.15 * big, s * 0.09 * big, s * 0.05 * big, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sh.kind === 1 ? '#3a3d32' : '#1d1d1d';
      ctx.beginPath();
      ctx.arc(sh.x * s, sh.y * s, s * 0.1 * big, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(sh.x * s - s * 0.03, sh.y * s - s * 0.03, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }

    if (editing && preview?.kind === 'attack') drawReachLine(ctx, map, s, preview, true);
    if (preview?.kind === 'buff') {
      const c = towerCenter(preview.tx, preview.ty);
      const rr = preview.range * preview.range;
      for (const t of towers) {
        if (!TOWERS[t.type].attacks) continue;
        const dx = t.tx + 0.5 - c.x;
        const dy = t.ty + 0.5 - c.y;
        if (dx * dx + dy * dy > rr + 1e-6) continue;
        ctx.strokeStyle = 'rgba(255, 210, 80, 0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.tx * s + 1, t.ty * s + 1, s - 2, s - 2);
      }
    }

    // placement ghost — centred on the same point the range circle uses
    if (editing && preview && (preview.movingId === null || preview.tx !== game.findTower(preview.movingId)?.tx || preview.ty !== game.findTower(preview.movingId)?.ty)) {
      const { x: gx, y: gy } = towerCenter(preview.tx, preview.ty);
      drawTower(ctx, preview.type, gx * s, gy * s, s, {
        level: preview.level,
        angle: -Math.PI / 2,
        ownerColor: playerColor(game.myId),
        alpha: preview.ok ? 0.8 : 0.4,
        time,
      });
    } else if (isMain && ui.hover && !ui.buildType && ui.moveTowerId === null) {
      const tw = game.towerAt(this.boardId, ui.hover.tx, ui.hover.ty);
      if (tw) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tw.tx * s + 1, tw.ty * s + 1, s - 2, s - 2);
      }
    }

    // effects
    this.drawEffects(now, s);

    // eliminated overlay
    if (!bB.alive) {
      ctx.fillStyle = 'rgba(10,10,16,0.62)';
      ctx.fillRect(0, 0, map.width * s, map.height * s);
      ctx.fillStyle = '#ff5d5d';
      ctx.font = `800 ${Math.max(12, s * (this.mini ? 2.2 : 1.4))}px Fredoka, Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ELIMINATED', (map.width * s) / 2, (map.height * s) / 2);
    }
  }

  private drawEffects(now: number, s: number): void {
    const ctx = this.ctx;
    const map = this.map!;
    const keep: Effect[] = [];
    for (const e of this.effects) {
      const p = (now - e.t0) / e.dur;
      if (p >= 1) continue;
      keep.push(e);
      switch (e.kind) {
        case 'line': {
          if (e.style === 'tracer') {
            ctx.strokeStyle = `rgba(230,255,170,${1 - p})`;
            ctx.lineWidth = Math.max(1, s * 0.06 * (1 - p));
            ctx.beginPath();
            ctx.moveTo(e.x1 * s, e.y1 * s);
            ctx.lineTo(e.x2 * s, e.y2 * s);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,255,220,${1 - p})`;
            ctx.beginPath();
            ctx.arc(e.x2 * s, e.y2 * s, s * 0.12 * (1 - p), 0, Math.PI * 2);
            ctx.fill();
          } else {
            const hx = e.x1 + (e.x2 - e.x1) * p;
            const hy = e.y1 + (e.y2 - e.y1) * p;
            const tl = Math.max(0, p - 0.35);
            const tx = e.x1 + (e.x2 - e.x1) * tl;
            const ty = e.y1 + (e.y2 - e.y1) * tl;
            ctx.strokeStyle = e.style === 'frost' ? 'rgba(180,235,255,0.95)' : e.style === 'venom' ? 'rgba(170,255,90,0.95)' : 'rgba(255,240,200,0.95)';
            ctx.lineWidth = Math.max(1, s * (e.style === 'frost' || e.style === 'venom' ? 0.07 : 0.045));
            ctx.beginPath();
            ctx.moveTo(tx * s, ty * s);
            ctx.lineTo(hx * s, hy * s);
            ctx.stroke();
          }
          break;
        }
        case 'chain': {
          ctx.lineWidth = Math.max(1, s * 0.05);
          ctx.strokeStyle = `rgba(160,240,255,${1 - p * 0.7})`;
          ctx.shadowColor = '#9ef0ff';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          let seed = e.seed + Math.floor(now / 40);
          const rnd = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280 - 0.5;
          };
          for (let i = 0; i + 3 < e.pts.length; i += 2) {
            const x1 = e.pts[i] * s;
            const y1 = e.pts[i + 1] * s;
            const x2 = e.pts[i + 2] * s;
            const y2 = e.pts[i + 3] * s;
            ctx.moveTo(x1, y1);
            const segs = 5;
            for (let k = 1; k <= segs; k++) {
              const f = k / segs;
              const j = k === segs ? 0 : s * 0.25;
              ctx.lineTo(x1 + (x2 - x1) * f + rnd() * j, y1 + (y2 - y1) * f + rnd() * j);
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
          break;
        }
        case 'ring': {
          const r = e.r * s * (0.3 + 0.7 * Math.sqrt(p));
          if (e.fill) {
            ctx.globalAlpha = 1 - p;
            ctx.fillStyle = e.fill;
            ctx.beginPath();
            ctx.arc(e.x * s, e.y * s, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, s * 0.06 * (1 - p));
          ctx.beginPath();
          ctx.arc(e.x * s, e.y * s, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'particles': {
          const tt = (now - e.t0) / 1000;
          ctx.globalAlpha = 1 - p;
          for (const q of e.parts) {
            ctx.fillStyle = q.color;
            const x = (q.x + q.vx * tt) * s;
            const y = (q.y + q.vy * tt + 2.2 * tt * tt) * s;
            ctx.fillRect(x - (q.size * s) / 2, y - (q.size * s) / 2, q.size * s, q.size * s);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'text': {
          ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          ctx.font = `700 ${Math.max(10, e.size * s)}px Fredoka, Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const y = (e.y - p * 0.8) * s;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.strokeText(e.text, e.x * s, y);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, e.x * s, y);
          ctx.globalAlpha = 1;
          break;
        }
        case 'cone': {
          const cone = (e.c * Math.PI) / 180;
          const g = ctx.createRadialGradient(e.x * s, e.y * s, 0, e.x * s, e.y * s, e.r * s);
          g.addColorStop(0, `rgba(255,240,150,${0.85 * (1 - p)})`);
          g.addColorStop(0.5, `rgba(255,140,40,${0.6 * (1 - p)})`);
          g.addColorStop(1, 'rgba(200,40,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(e.x * s, e.y * s);
          ctx.arc(e.x * s, e.y * s, e.r * s, e.a - cone, e.a + cone);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'flash': {
          const w = map.width * s;
          const h = map.height * s;
          const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, e.color);
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          break;
        }
        case 'banner': {
          const w = map.width * s;
          const appear = Math.min(1, p / 0.12);
          const fade = p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
          ctx.globalAlpha = fade;
          const y = s * 1.6;
          const bh = s * (e.sub ? 1.9 : 1.3);
          ctx.fillStyle = 'rgba(8,10,18,0.72)';
          ctx.fillRect(0, y - bh / 2, w, bh);
          ctx.fillStyle = e.color;
          ctx.fillRect(0, y - bh / 2, w, 2);
          ctx.fillRect(0, y + bh / 2 - 2, w, 2);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const scale = 0.8 + 0.2 * appear;
          ctx.font = `800 ${Math.max(14, s * 0.85 * scale)}px Fredoka, Inter, sans-serif`;
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          const ty = e.sub ? y - s * 0.3 : y;
          ctx.strokeText(e.text, w / 2, ty);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, w / 2, ty);
          if (e.sub) {
            ctx.font = `600 ${Math.max(11, s * 0.42)}px Inter, sans-serif`;
            ctx.fillStyle = '#e8edf7';
            ctx.fillText(e.sub, w / 2, y + s * 0.45);
          }
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
    this.effects = keep;
  }
}

/** Draw a static map preview (menu thumbnails). */
export function drawMapThumb(canvas: HTMLCanvasElement, mapId: keyof typeof MAPS, cssW: number): void {
  const map = MAPS[mapId];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = (cssW / map.width) * dpr;
  canvas.width = Math.round(map.width * s);
  canvas.height = Math.round(map.height * s);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d')!;
  drawMapStatic(ctx, map, s, cssW > 160);
}

