// Vector art for towers, enemies and map tiles. All functions draw centred at (x, y)
// with `s` = tile size in pixels. Shared by the board renderer and UI icons.
import type { GameMap } from '../../shared/maps';
import { TILE_PATH } from '../../shared/maps';
import { ENEMIES } from '../../shared/config';
import { mulberry32 } from '../../shared/rng';
import type { EnemyType, TowerType } from '../../shared/types';
import { ENEMY_TYPES } from '../../shared/types';
import { drawThemeBase, drawThemeProp, drawThemedEnemyBody, paintThemedGround, worldColors } from './themeArt';
import { getViewTheme } from './viewTheme';

export const TOWER_COLORS: Record<TowerType, { base: string; dark: string; accent: string }> = {
  archer: { base: '#a8763e', dark: '#6b4a26', accent: '#f1d18a' },
  crossbow: { base: '#257a78', dark: '#123f46', accent: '#9ff7ea' },
  cannon: { base: '#5d6573', dark: '#2f343d', accent: '#ffb547' },
  frost: { base: '#7fd4ff', dark: '#2f7fb3', accent: '#e6f8ff' },
  sniper: { base: '#5f8a4e', dark: '#33502a', accent: '#d7ff9e' },
  tesla: { base: '#8a63ff', dark: '#47309b', accent: '#9ef0ff' },
  mine: { base: '#c99a2e', dark: '#7a5a14', accent: '#ffe27a' },
  builder: { base: '#d97732', dark: '#713d1f', accent: '#ffe2a8' },
  flame: { base: '#e8590c', dark: '#6e2a07', accent: '#ffd166' },
  mortar: { base: '#6b705c', dark: '#34372c', accent: '#ffb547' },
  venom: { base: '#58b958', dark: '#24502a', accent: '#c6ff6b' },
  prism: { base: '#9ad7ff', dark: '#283e6b', accent: '#ffffff' },
  totem: { base: '#a0522d', dark: '#4f2512', accent: '#ff6b6b' },
};

export const ENEMY_COLORS: Record<EnemyType, string> = {
  grunt: '#7fb24a',
  runner: '#ffb02e',
  swarm: '#c86bff',
  knight: '#b9c4d6',
  brute: '#b5523b',
  healer: '#f1f5ff',
  warlord: '#c0263a',
  splitter: '#9b6bff',
  splitling: '#d0b8ff',
  shield: '#5c7cfa',
  raider: '#e76f51',
  golem: '#7f8c8d',
  shade: '#4b3f72',
  bat: '#6d3b8c',
  harpy: '#27a9a1',
  drake: '#2f7d55',
  titan: '#8b5a3c',
  stormRoc: '#38bdf8',
  colossus: '#4b5563',
  voidDragon: '#7c3aed',
};

export function enemyTypeFromIndex(i: number): EnemyType {
  return ENEMY_TYPES[i] ?? 'grunt';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Towers ─────────────────────────────────────────────────────────────────
export interface TowerDrawOpts {
  level: number;
  angle: number;
  ownerColor?: string | null;
  alpha?: number;
  time?: number;
  /** recoil 0..1 right after a shot */
  recoil?: number;
}

export function drawTower(ctx: CanvasRenderingContext2D, type: TowerType, x: number, y: number, s: number, o: TowerDrawOpts) {
  const c = TOWER_COLORS[type];
  const t = o.time ?? 0;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(s * 0.04, s * 0.08, s * 0.42, s * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  // owner ring
  if (o.ownerColor) {
    ctx.strokeStyle = o.ownerColor;
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.43, 0, Math.PI * 2);
    ctx.stroke();
  }
  // stone base, lit from the upper left so every tower reads as a solid piece
  const b = s * 0.36;
  const stone = ctx.createLinearGradient(-b, -b, b, b);
  stone.addColorStop(0, '#727b8e');
  stone.addColorStop(0.5, '#3b4252');
  stone.addColorStop(1, '#1e2430');
  ctx.fillStyle = stone;
  roundRect(ctx, -b, -b, b * 2, b * 2, s * 0.1);
  ctx.fill();
  const pad = ctx.createLinearGradient(-b, -b, b * 0.4, b);
  pad.addColorStop(0, c.accent);
  pad.addColorStop(0.38, c.base);
  pad.addColorStop(1, c.dark);
  ctx.fillStyle = pad;
  roundRect(ctx, -b * 0.86, -b * 0.86, b * 1.72, b * 1.72, s * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(-b * 0.22, -b * 0.4, b * 0.34, b * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();

  const rec = (o.recoil ?? 0) * s * 0.06;
  switch (type) {
    case 'archer': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec, 0);
      // bow
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.beginPath();
      ctx.arc(-s * 0.02, 0, s * 0.24, -Math.PI / 2.3, Math.PI / 2.3);
      ctx.stroke();
      // string
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(s * 0.07, -s * 0.18);
      ctx.lineTo(-s * 0.08, 0);
      ctx.lineTo(s * 0.07, s * 0.18);
      ctx.stroke();
      // arrow
      ctx.strokeStyle = '#3a2a14';
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(-s * 0.08, 0);
      ctx.lineTo(s * 0.3, 0);
      ctx.stroke();
      ctx.fillStyle = '#ddd';
      ctx.beginPath();
      ctx.moveTo(s * 0.34, 0);
      ctx.lineTo(s * 0.26, -s * 0.05);
      ctx.lineTo(s * 0.26, s * 0.05);
      ctx.fill();
      break;
    }
    case 'crossbow': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec * 1.4, 0);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(-s * 0.02, -s * 0.25);
      ctx.quadraticCurveTo(s * 0.22, 0, -s * 0.02, s * 0.25);
      ctx.stroke();
      ctx.strokeStyle = '#e9fffb';
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(-s * 0.02, -s * 0.25);
      ctx.lineTo(s * 0.08, 0);
      ctx.lineTo(-s * 0.02, s * 0.25);
      ctx.stroke();
      ctx.fillStyle = c.dark;
      roundRect(ctx, -s * 0.13, -s * 0.055, s * 0.5, s * 0.11, s * 0.025);
      ctx.fill();
      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.moveTo(s * 0.42, 0);
      ctx.lineTo(s * 0.31, -s * 0.055);
      ctx.lineTo(s * 0.31, s * 0.055);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cannon': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec * 1.5, 0);
      ctx.fillStyle = '#23272e';
      roundRect(ctx, -s * 0.05, -s * 0.11, s * 0.42, s * 0.22, s * 0.05);
      ctx.fill();
      ctx.fillStyle = '#4a515d';
      roundRect(ctx, s * 0.3, -s * 0.13, s * 0.08, s * 0.26, s * 0.03);
      ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(-s * 0.06, 0, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'frost': {
      ctx.fillStyle = 'rgba(160,225,255,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(t * 0.8);
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.fillStyle = i === 0 ? c.accent : c.base;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.3);
        ctx.lineTo(s * 0.08, 0);
        ctx.lineTo(0, s * 0.06);
        ctx.lineTo(-s * 0.08, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'sniper': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        ctx.lineTo(Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26);
      }
      ctx.closePath();
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec * 2, 0);
      ctx.fillStyle = '#1d2418';
      roundRect(ctx, -s * 0.12, -s * 0.05, s * 0.58, s * 0.1, s * 0.03);
      ctx.fill();
      ctx.fillStyle = c.accent;
      roundRect(ctx, -s * 0.02, -s * 0.12, s * 0.16, s * 0.07, s * 0.02);
      ctx.fill();
      ctx.fillStyle = '#0d120b';
      ctx.fillRect(s * 0.42, -s * 0.06, s * 0.06, s * 0.12);
      break;
    }
    case 'tesla': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d9c46a';
      ctx.lineWidth = Math.max(1, s * 0.04);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, s * (0.1 - i * 0.08), s * 0.15, s * 0.05, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const glow = 0.6 + 0.4 * Math.sin(t * 6);
      const g = ctx.createRadialGradient(0, -s * 0.16, 0, 0, -s * 0.16, s * 0.2);
      g.addColorStop(0, `rgba(220,255,255,${glow})`);
      g.addColorStop(0.5, `rgba(120,220,255,${0.6 * glow})`);
      g.addColorStop(1, 'rgba(120,220,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -s * 0.16, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(0, -s * 0.16, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mine': {
      // mine entrance + gold cart
      ctx.fillStyle = '#2a1d0c';
      ctx.beginPath();
      ctx.arc(0, -s * 0.02, s * 0.22, Math.PI, 0);
      ctx.lineTo(s * 0.22, s * 0.12);
      ctx.lineTo(-s * 0.22, s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c.base;
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath();
      ctx.arc(0, -s * 0.02, s * 0.22, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#6b4a26';
      ctx.fillRect(-s * 0.18, s * 0.06, s * 0.36, s * 0.12);
      const shine = 0.7 + 0.3 * Math.sin(t * 3 + x);
      ctx.fillStyle = c.accent;
      ctx.globalAlpha *= shine;
      for (const [gx, gy] of [
        [-0.1, 0.05],
        [0.0, 0.02],
        [0.1, 0.05],
      ]) {
        ctx.beginPath();
        ctx.arc(gx * s, gy * s, s * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'builder': {
      // Timber hut with a bright workshop door.
      ctx.fillStyle = c.dark;
      roundRect(ctx, -s * 0.25, -s * 0.12, s * 0.5, s * 0.38, s * 0.04);
      ctx.fill();
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, -s * 0.1);
      ctx.lineTo(0, -s * 0.34);
      ctx.lineTo(s * 0.32, -s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#321c12';
      roundRect(ctx, -s * 0.09, s * 0.01, s * 0.18, s * 0.25, s * 0.03);
      ctx.fill();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = Math.max(1.5, s * 0.045);
      ctx.beginPath();
      ctx.moveTo(s * 0.12, -s * 0.02);
      ctx.lineTo(s * 0.27, s * 0.16);
      ctx.moveTo(s * 0.27, -s * 0.02);
      ctx.lineTo(s * 0.12, s * 0.16);
      ctx.stroke();
      break;
    }
    case 'flame': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a1f06';
      ctx.beginPath();
      ctx.arc(-s * 0.06, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec, 0);
      ctx.fillStyle = '#3a3a3a';
      roundRect(ctx, 0, -s * 0.07, s * 0.34, s * 0.14, s * 0.04);
      ctx.fill();
      const fl = 0.75 + 0.25 * Math.sin(t * 25 + x);
      ctx.fillStyle = `rgba(255,${Math.round(150 + 80 * fl)},60,${0.85 * fl})`;
      ctx.beginPath();
      ctx.moveTo(s * 0.34, -s * 0.06);
      ctx.quadraticCurveTo(s * (0.44 + 0.04 * fl), 0, s * 0.34, s * 0.06);
      ctx.fill();
      break;
    }
    case 'mortar': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec, 0);
      ctx.fillStyle = '#25271f';
      roundRect(ctx, -s * 0.12, -s * 0.15, s * 0.32, s * 0.3, s * 0.08);
      ctx.fill();
      ctx.fillStyle = '#0f100c';
      ctx.beginPath();
      ctx.ellipse(s * 0.2, 0, s * 0.05, s * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.fillRect(-s * 0.08, -s * 0.16, s * 0.05, s * 0.32);
      break;
    }
    case 'venom': {
      ctx.fillStyle = c.base;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(o.angle);
      ctx.translate(-rec, 0);
      ctx.fillStyle = '#1d3a1f';
      roundRect(ctx, 0, -s * 0.05, s * 0.3, s * 0.1, s * 0.03);
      ctx.fill();
      ctx.rotate(-o.angle);
      const bub = 0.85 + 0.15 * Math.sin(t * 5 + y);
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.13 * bub, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(-s * 0.04, -s * 0.04, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'prism': {
      ctx.rotate(t * 0.6);
      const g = ctx.createLinearGradient(-s * 0.25, -s * 0.25, s * 0.25, s * 0.25);
      g.addColorStop(0, '#ff8ad8');
      g.addColorStop(0.35, '#9ad7ff');
      g.addColorStop(0.7, '#b6ff9a');
      g.addColorStop(1, '#fff3a0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.3);
      ctx.lineTo(s * 0.24, 0);
      ctx.lineTo(0, s * 0.3);
      ctx.lineTo(-s * 0.24, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.3);
      ctx.lineTo(0, s * 0.3);
      ctx.moveTo(-s * 0.24, 0);
      ctx.lineTo(s * 0.24, 0);
      ctx.stroke();
      break;
    }
    case 'totem': {
      const glow = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.3);
      ctx.fillStyle = `rgba(255,90,90,${0.15 + 0.15 * glow})`;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.base;
      roundRect(ctx, -s * 0.12, -s * 0.3, s * 0.24, s * 0.56, s * 0.05);
      ctx.fill();
      ctx.fillStyle = c.dark;
      ctx.fillRect(-s * 0.12, -s * 0.06, s * 0.24, s * 0.04);
      ctx.fillRect(-s * 0.12, s * 0.1, s * 0.24, s * 0.04);
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(-s * 0.05, -s * 0.17, s * 0.03, 0, Math.PI * 2);
      ctx.arc(s * 0.05, -s * 0.17, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8d5b0';
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, -s * 0.26);
      ctx.lineTo(-s * 0.24, -s * 0.36);
      ctx.lineTo(-s * 0.12, -s * 0.2);
      ctx.moveTo(s * 0.12, -s * 0.26);
      ctx.lineTo(s * 0.24, -s * 0.36);
      ctx.lineTo(s * 0.12, -s * 0.2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
  // level pips
  if (o.level > 1) {
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    for (let i = 0; i < o.level; i++) {
      const px = x + (i - (o.level - 1) / 2) * s * 0.16;
      const py = y + s * 0.36;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(px, py, s * 0.065, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(px, py, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Little worker dispatched by a Builder Hut. */
export function drawBuilder(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number, repairing: boolean): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 10) * s * 0.025);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.16, s * 0.17, s * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef9f3c';
  ctx.beginPath();
  ctx.arc(0, -s * 0.05, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe0b2';
  ctx.beginPath();
  ctx.arc(0, -s * 0.12, s * 0.095, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(0, -s * 0.16, s * 0.11, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#5b3a22';
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  const swing = repairing ? Math.sin(time * 14) * 0.8 : -0.35;
  ctx.rotate(swing);
  ctx.beginPath();
  ctx.moveTo(s * 0.08, 0);
  ctx.lineTo(s * 0.29, -s * 0.18);
  ctx.stroke();
  ctx.fillStyle = '#aeb8c4';
  roundRect(ctx, s * 0.22, -s * 0.25, s * 0.16, s * 0.1, s * 0.025);
  ctx.fill();
  ctx.restore();
}

// ── Enemies ────────────────────────────────────────────────────────────────
export function enemyRadius(type: EnemyType, s: number): number {
  const r: Record<EnemyType, number> = {
    grunt: 0.24, runner: 0.21, swarm: 0.14, knight: 0.27, brute: 0.34,
    healer: 0.24, splitter: 0.28, splitling: 0.13, shield: 0.28,
    raider: 0.25, golem: 0.38, shade: 0.24, bat: 0.19, harpy: 0.28, drake: 0.34,
    warlord: 0.46, titan: 0.52, stormRoc: 0.55, colossus: 0.58, voidDragon: 0.63,
  };
  return r[type] * s;
}

export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  type: EnemyType,
  x: number,
  y: number,
  s: number,
  dir: number,
  hpFrac: number,
  flags: number,
  time: number,
  showHp = true,
) {
  const slowed = (flags & 1) !== 0;
  const shielded = (flags & 2) !== 0;
  const burning = (flags & 4) !== 0;
  const poisoned = (flags & 8) !== 0;
  const attackingTower = (flags & 16) !== 0;
  const r = enemyRadius(type, s);
  const col = ENEMY_COLORS[type];
  const def = ENEMIES[type];
  const flying = def.movement === 'air';
  const lift = flying ? s * (def.boss ? 0.34 : 0.22) : 0;
  const bob = Math.sin(time * (flying ? 6 : 10) + x * 0.1) * s * (flying ? 0.045 : 0.015);
  ctx.save();
  ctx.translate(x, y + bob - lift);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75 + lift - bob, r * (flying ? 0.72 : 0.9), r * (flying ? 0.24 : 0.35), 0, 0, Math.PI * 2);
  ctx.fill();
  const theme = getViewTheme();
  if (theme !== 'classic') {
    drawThemedEnemyBody(ctx, theme, type, r, dir);
  } else {
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  switch (type) {
    case 'grunt':
    case 'swarm': {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes(ctx, dir, r);
      break;
    }
    case 'runner': {
      ctx.rotate(dir);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(-r * 0.9, -r * 0.9);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(-r * 0.9, r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'knight': {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.8);
      ctx.lineTo(r, -r * 0.8);
      ctx.lineTo(r * 0.85, r * 0.3);
      ctx.lineTo(0, r * 1.05);
      ctx.lineTo(-r * 0.85, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4f8cff';
      ctx.fillRect(-r * 0.15, -r * 0.8, r * 0.3, r * 1.6);
      ctx.fillStyle = '#d23b3b';
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.0, r * 0.25, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'brute': {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e8d5b0';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.2);
      ctx.lineTo(-r * 0.75, -r * 0.75);
      ctx.lineTo(-r * 0.25, -r * 0.4);
      ctx.moveTo(r * 0.5, -r * 0.2);
      ctx.lineTo(r * 0.75, -r * 0.75);
      ctx.lineTo(r * 0.25, -r * 0.4);
      ctx.fill();
      eyes(ctx, dir, r * 0.9);
      break;
    }
    case 'healer': {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.strokeStyle = `rgba(90,255,160,${0.25 + 0.25 * pulse})`;
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.6 + pulse * 0.3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2fc56b';
      ctx.fillRect(-r * 0.2, -r * 0.6, r * 0.4, r * 1.2);
      ctx.fillRect(-r * 0.6, -r * 0.2, r * 1.2, r * 0.4);
      break;
    }
    case 'splitter': {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + time * 1.2;
        ctx.moveTo(Math.cos(a) * r * 0.45 + r * 0.55, Math.sin(a) * r * 0.45);
        ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.55, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      eyes(ctx, dir, r * 0.8);
      break;
    }
    case 'splitling': {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'shield': {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(dir);
      ctx.fillStyle = '#dbe4ff';
      ctx.beginPath();
      ctx.moveTo(r * 0.35, -r * 0.75);
      ctx.lineTo(r * 1.0, -r * 0.55);
      ctx.lineTo(r * 1.0, r * 0.25);
      ctx.lineTo(r * 0.65, r * 0.8);
      ctx.lineTo(r * 0.35, r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'raider': {
      ctx.rotate(dir);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(0, -r);
      ctx.lineTo(-r, -r * 0.35);
      ctx.lineTo(-r * 0.8, r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2b1b18';
      ctx.fillRect(-r * 0.25, -r * 0.75, r * 0.5, r * 1.5);
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(r * 0.45, -r * 0.18, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'golem': {
      ctx.fillStyle = col;
      roundRect(ctx, -r * 0.82, -r * 0.8, r * 1.64, r * 1.65, r * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#aeb6b7';
      roundRect(ctx, -r * 1.18, -r * 0.55, r * 0.38, r * 0.95, r * 0.12);
      ctx.fill();
      roundRect(ctx, r * 0.8, -r * 0.55, r * 0.38, r * 0.95, r * 0.12);
      ctx.fill();
      ctx.strokeStyle = '#465052';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.2);
      ctx.lineTo(-r * 0.1, r * 0.08);
      ctx.lineTo(r * 0.25, -r * 0.25);
      ctx.lineTo(r * 0.55, r * 0.22);
      ctx.stroke();
      eyes(ctx, dir, r * 0.8, '#7dff5b');
      break;
    }
    case 'shade': {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.2);
      ctx.quadraticCurveTo(r * 1.15, -r * 0.45, r * 0.72, r * 0.95);
      ctx.lineTo(r * 0.15, r * 0.62);
      ctx.lineTo(-r * 0.25, r * 1.0);
      ctx.lineTo(-r * 0.55, r * 0.48);
      ctx.quadraticCurveTo(-r * 1.0, -r * 0.45, 0, -r * 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b9a7ff';
      ctx.beginPath();
      ctx.arc(-r * 0.24, -r * 0.25, r * 0.12, 0, Math.PI * 2);
      ctx.arc(r * 0.24, -r * 0.25, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bat': {
      const flap = 0.55 + Math.abs(Math.sin(time * 9)) * 0.55;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, 0);
      ctx.lineTo(-r * 1.45, -r * flap);
      ctx.lineTo(-r * 1.1, r * 0.2);
      ctx.lineTo(-r * 1.45, r * 0.65);
      ctx.lineTo(-r * 0.2, r * 0.45);
      ctx.lineTo(r * 0.2, r * 0.45);
      ctx.lineTo(r * 1.45, r * 0.65);
      ctx.lineTo(r * 1.1, r * 0.2);
      ctx.lineTo(r * 1.45, -r * flap);
      ctx.lineTo(r * 0.25, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#31163d';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.42, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      eyes(ctx, dir, r * 0.45, '#ff4d8a');
      break;
    }
    case 'harpy': {
      const flap = Math.sin(time * 7) * r * 0.28;
      ctx.fillStyle = '#b9fff6';
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, 0);
      ctx.lineTo(-r * 1.5, -r * 0.55 - flap);
      ctx.lineTo(-r * 1.05, r * 0.45);
      ctx.lineTo(-r * 0.2, r * 0.3);
      ctx.moveTo(r * 0.2, 0);
      ctx.lineTo(r * 1.5, -r * 0.55 - flap);
      ctx.lineTo(r * 1.05, r * 0.45);
      ctx.lineTo(r * 0.2, r * 0.3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.55, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(0, r * 0.15);
      ctx.lineTo(r * 0.48, r * 0.35);
      ctx.lineTo(0, r * 0.42);
      ctx.fill();
      eyes(ctx, dir, r * 0.5, '#12343b');
      break;
    }
    case 'drake': {
      ctx.rotate(dir);
      const flap = Math.sin(time * 6) * r * 0.25;
      ctx.fillStyle = '#81c784';
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.15);
      ctx.lineTo(-r * 0.8, -r * 1.2 - flap);
      ctx.lineTo(r * 0.25, -r * 0.48);
      ctx.lineTo(-r * 0.8, r * 1.2 + flap);
      ctx.lineTo(-r * 0.2, r * 0.15);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(r * 0.5, -r * 0.6);
      ctx.lineTo(-r * 1.05, -r * 0.28);
      ctx.lineTo(-r * 1.35, 0);
      ctx.lineTo(-r * 1.05, r * 0.28);
      ctx.lineTo(r * 0.5, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d9ed92';
      ctx.beginPath();
      ctx.arc(r * 0.7, -r * 0.18, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'titan': {
      ctx.fillStyle = col;
      roundRect(ctx, -r * 0.75, -r * 0.85, r * 1.5, r * 1.7, r * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#4a2f23';
      roundRect(ctx, -r * 1.25, -r * 0.65, r * 0.55, r * 1.1, r * 0.12);
      ctx.fill();
      roundRect(ctx, r * 0.7, -r * 0.65, r * 0.55, r * 1.1, r * 0.12);
      ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(-r * 0.48, -r * 0.08, r * 0.96, r * 0.16);
      eyes(ctx, dir, r * 0.72, '#ffe066');
      break;
    }
    case 'stormRoc': {
      const flap = Math.sin(time * 5) * r * 0.35;
      ctx.fillStyle = '#b9ecff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, 0);
      ctx.lineTo(-r * 1.75, -r * 0.85 - flap);
      ctx.lineTo(-r * 1.25, r * 0.55);
      ctx.lineTo(-r * 0.15, r * 0.35);
      ctx.moveTo(r * 0.15, 0);
      ctx.lineTo(r * 1.75, -r * 0.85 - flap);
      ctx.lineTo(r * 1.25, r * 0.55);
      ctx.lineTo(r * 0.15, r * 0.35);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.62, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffe66d';
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, -r * 0.1);
      ctx.lineTo(r * 0.15, r * 0.05);
      ctx.lineTo(-r * 0.05, r * 0.2);
      ctx.stroke();
      eyes(ctx, dir, r * 0.55, '#ffffff');
      break;
    }
    case 'colossus': {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 ? r * 0.88 : r * 1.1;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.55);
      ctx.lineTo(-r * 0.2, -r * 0.05);
      ctx.lineTo(r * 0.35, -r * 0.45);
      ctx.lineTo(r * 0.7, r * 0.35);
      ctx.stroke();
      eyes(ctx, dir, r * 0.55, '#ff4d6d');
      break;
    }
    case 'voidDragon': {
      ctx.rotate(dir);
      const flap = Math.sin(time * 4) * r * 0.3;
      ctx.fillStyle = '#bca7ff';
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, -r * 0.1);
      ctx.lineTo(-r * 0.9, -r * 1.45 - flap);
      ctx.lineTo(r * 0.15, -r * 0.55);
      ctx.lineTo(-r * 0.9, r * 1.45 + flap);
      ctx.lineTo(-r * 0.15, r * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(r * 1.35, 0);
      ctx.lineTo(r * 0.62, -r * 0.62);
      ctx.lineTo(-r * 1.2, -r * 0.32);
      ctx.lineTo(-r * 1.55, 0);
      ctx.lineTo(-r * 1.2, r * 0.32);
      ctx.lineTo(r * 0.62, r * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4e8ff';
      ctx.beginPath();
      ctx.moveTo(r * 0.65, -r * 0.5);
      ctx.lineTo(r * 0.42, -r * 1.05);
      ctx.lineTo(r * 0.88, -r * 0.6);
      ctx.moveTo(r * 0.65, r * 0.5);
      ctx.lineTo(r * 0.42, r * 1.05);
      ctx.lineTo(r * 0.88, r * 0.6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(r * 0.75, -r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'warlord': {
      ctx.fillStyle = '#5a0c18';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time * 0.5;
        const rr = i % 2 === 0 ? r * 1.12 : r * 0.92;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes(ctx, dir, r * 0.8, '#ffe066');
      // crown
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#8a6b00';
      ctx.beginPath();
      const cw = r * 0.9;
      const cy = -r * 0.85;
      ctx.moveTo(-cw / 2, cy);
      ctx.lineTo(-cw / 2, cy - r * 0.35);
      ctx.lineTo(-cw / 4, cy - r * 0.15);
      ctx.lineTo(0, cy - r * 0.45);
      ctx.lineTo(cw / 4, cy - r * 0.15);
      ctx.lineTo(cw / 2, cy - r * 0.35);
      ctx.lineTo(cw / 2, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  }
  if (poisoned) {
    ctx.fillStyle = 'rgba(120,230,80,0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,255,120,0.9)';
    for (let i = 0; i < 3; i++) {
      const ph = (time * 1.5 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(Math.sin(i * 2.1) * r * 0.6, -r * (0.2 + ph * 1.1), Math.max(0.8, r * 0.13 * (1 - ph)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (burning) {
    for (let i = 0; i < 4; i++) {
      const ph = (time * 3 + i / 4) % 1;
      ctx.fillStyle = `rgba(255,${Math.round(120 + 100 * (1 - ph))},40,${0.85 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(Math.cos(i * 1.7) * r * 0.55, -r * (0.1 + ph * 1.2), Math.max(1, r * 0.22 * (1 - ph)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (shielded) {
    ctx.strokeStyle = 'rgba(170,200,255,0.95)';
    ctx.fillStyle = 'rgba(120,160,255,0.18)';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (slowed) {
    ctx.fillStyle = 'rgba(140,215,255,0.38)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,245,255,0.9)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
      ctx.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
      ctx.stroke();
    }
  }
  if (attackingTower) {
    ctx.strokeStyle = '#ffcf4a';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(r * 0.65, -r * 1.0);
    ctx.lineTo(r * 1.25, -r * 0.35);
    ctx.moveTo(r * 1.15, -r * 1.0);
    ctx.lineTo(r * 0.65, -r * 0.45);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, -r * 0.34, r * 0.32, r * 0.16, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (showHp && hpFrac < 0.999) {
    const w = Math.max(r * 2, s * 0.5);
    const h = Math.max(2, s * 0.07);
    const by = y - lift - r - s * 0.16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w / 2 - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = hpFrac > 0.6 ? '#4ade80' : hpFrac > 0.3 ? '#facc15' : '#ef4444';
    ctx.fillRect(x - w / 2, by, w * Math.max(0, hpFrac), h);
  }
}

function eyes(ctx: CanvasRenderingContext2D, dir: number, r: number, color = '#fff') {
  const ex = Math.cos(dir) * r * 0.35;
  const ey = Math.sin(dir) * r * 0.35;
  const px = -Math.sin(dir) * r * 0.32;
  const py = Math.cos(dir) * r * 0.32;
  ctx.fillStyle = color;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(ex + px * sgn, ey + py * sgn, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(ex * 1.25 + px * sgn, ey * 1.25 + py * sgn, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Map static layer ──────────────────────────────────────────────────────
export function drawMapStatic(ctx: CanvasRenderingContext2D, map: GameMap, s: number, detail = true) {
  const W = map.width;
  const H = map.height;
  const view = getViewTheme();
  const th = view === 'classic' ? map.theme : worldColors(view);
  const rng = mulberry32(map.width * 131 + map.name.length * 7);
  // grass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? th.grassA : th.grassB;
      ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      if (detail) {
        const shade = ctx.createLinearGradient(x * s, y * s, x * s, (y + 1) * s);
        shade.addColorStop(0, 'rgba(255,255,255,0.08)');
        shade.addColorStop(0.5, 'rgba(255,255,255,0)');
        shade.addColorStop(1, 'rgba(0,0,0,0.14)');
        ctx.fillStyle = shade;
        ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
        if (view === 'classic') {
        ctx.strokeStyle = 'rgba(210,255,170,0.28)';
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const gx = x * s + (0.16 + rng() * 0.68) * s;
          const gy = y * s + (0.28 + rng() * 0.58) * s;
          const hgt = s * (0.1 + rng() * 0.16);
          const lean = (rng() - 0.5) * s * 0.18;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.quadraticCurveTo(gx + lean * 0.4, gy - hgt * 0.55, gx + lean, gy - hgt);
          ctx.stroke();
        }
        if (rng() < 0.16) {
          ctx.fillStyle = rng() < 0.5 ? 'rgba(255,220,90,0.75)' : 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(x * s + rng() * s, y * s + rng() * s, Math.max(0.8, s * 0.04), 0, Math.PI * 2);
          ctx.fill();
        }
        } else {
          paintThemedGround(ctx, view, x, y, s, rng);
        }
      }
    }
  }
  // water
  const water = new Set(map.decorations.filter((d) => d.kind === 'water').map((d) => d.y * W + d.x));
  for (const d of map.decorations) {
    if (d.kind !== 'water') continue;
    ctx.fillStyle = th.water;
    ctx.fillRect(d.x * s, d.y * s, s + 0.5, s + 0.5);
    const waterShade = ctx.createLinearGradient(d.x * s, d.y * s, d.x * s, (d.y + 1) * s);
    waterShade.addColorStop(0, 'rgba(190,230,255,0.22)');
    waterShade.addColorStop(1, 'rgba(0,20,40,0.28)');
    ctx.fillStyle = waterShade;
    ctx.fillRect(d.x * s, d.y * s, s + 0.5, s + 0.5);
    if (detail) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      const wy = d.y * s + s * (0.35 + 0.3 * ((d.x * 7 + d.y * 3) % 3) / 3);
      ctx.moveTo(d.x * s + s * 0.2, wy);
      ctx.quadraticCurveTo(d.x * s + s * 0.5, wy - s * 0.1, d.x * s + s * 0.8, wy);
      ctx.stroke();
    }
    // shoreline on edges that touch land
    ctx.fillStyle = view === 'robots' ? 'rgba(103,232,249,0.35)' : view === 'mushrooms' ? 'rgba(255,214,170,0.45)' : 'rgba(230,220,170,0.35)';
    const e = Math.max(1, s * 0.07);
    if (d.y > 0 && !water.has((d.y - 1) * W + d.x)) ctx.fillRect(d.x * s, d.y * s, s, e);
    if (d.y < H - 1 && !water.has((d.y + 1) * W + d.x)) ctx.fillRect(d.x * s, (d.y + 1) * s - e, s, e);
    if (d.x > 0 && !water.has(d.y * W + d.x - 1)) ctx.fillRect(d.x * s, d.y * s, e, s);
    if (d.x < W - 1 && !water.has(d.y * W + d.x + 1)) ctx.fillRect((d.x + 1) * s - e, d.y * s, e, s);
  }
  // path: thick rounded polyline (edge, then fill, then texture)
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const strokePath = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const p of map.paths) {
      ctx.beginPath();
      p.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x * s, pt.y * s) : ctx.lineTo(pt.x * s, pt.y * s)));
      ctx.stroke();
    }
  };
  strokePath(s * 0.98, th.pathEdge);
  strokePath(s * 0.8, th.path);
  strokePath(s * 0.22, 'rgba(255,255,255,0.16)');
  if (detail) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (map.tiles[y * W + x] !== TILE_PATH) continue;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
          ctx.beginPath();
          ctx.arc(x * s + s * (0.2 + rng() * 0.6), y * s + s * (0.2 + rng() * 0.6), Math.max(0.8, s * 0.04), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  // decorations
  for (const d of map.decorations) {
    const cx = d.x * s + s / 2;
    const cy = d.y * s + s / 2;
    if (view !== 'classic' && (d.kind === 'tree' || d.kind === 'rock')) {
      drawThemeProp(ctx, view, d.kind, cx, cy, s);
      continue;
    }
    if (d.kind === 'tree') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.06, cy + s * 0.22, s * 0.32, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5b3a1e';
      ctx.fillRect(cx - s * 0.05, cy + s * 0.05, s * 0.1, s * 0.2);
      const greens = ['#1f5a2c', '#2a7038', '#358446'];
      const blobs = [
        [0, -0.05, 0.3],
        [-0.14, 0.04, 0.2],
        [0.14, 0.04, 0.2],
        [0, -0.18, 0.18],
      ];
      blobs.forEach(([bx, by, br], i) => {
        ctx.fillStyle = greens[i % 3];
        ctx.beginPath();
        ctx.arc(cx + bx * s, cy + by * s, br * s, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(cx - s * 0.08, cy - s * 0.16, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.kind === 'rock') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.05, cy + s * 0.2, s * 0.34, s * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7b7f88';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.32, cy + s * 0.18);
      ctx.lineTo(cx - s * 0.22, cy - s * 0.14);
      ctx.lineTo(cx + s * 0.02, cy - s * 0.28);
      ctx.lineTo(cx + s * 0.28, cy - s * 0.08);
      ctx.lineTo(cx + s * 0.32, cy + s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9aa0aa';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy - s * 0.1);
      ctx.lineTo(cx + s * 0.02, cy - s * 0.24);
      ctx.lineTo(cx + s * 0.06, cy + s * 0.02);
      ctx.closePath();
      ctx.fill();
    }
  }
  // entries (dark portals) and exits (castle gate)
  for (const e of map.entries) {
    const inner = view === 'robots' ? 'rgba(0,40,60,0.9)' : view === 'mushrooms' ? 'rgba(50,0,40,0.9)' : 'rgba(20,0,30,0.85)';
    const outer = view === 'robots' ? 'rgba(34,211,238,0)' : view === 'mushrooms' ? 'rgba(244,114,182,0)' : 'rgba(60,0,90,0)';
    const g = ctx.createRadialGradient(e.x * s, e.y * s, 0, e.x * s, e.y * s, s * 0.7);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x * s, e.y * s, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of map.exits) {
    if (view === 'classic') drawCastle(ctx, e.x * s, e.y * s, s);
    else drawThemeBase(ctx, view, e.x * s, e.y * s, s);
  }
  const vg = ctx.createRadialGradient((W * s) / 2, (H * s) / 2, Math.min(W, H) * s * 0.25, (W * s) / 2, (H * s) / 2, Math.max(W, H) * s * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W * s, H * s);
}

export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(s * 0.04, s * 0.4, s * 0.55, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  const wall = ctx.createLinearGradient(-s * 0.42, -s * 0.32, s * 0.42, s * 0.36);
  wall.addColorStop(0, '#efe8da');
  wall.addColorStop(0.45, '#c4bbaa');
  wall.addColorStop(1, '#8d8476');
  ctx.fillStyle = wall;
  ctx.fillRect(-s * 0.42, -s * 0.18, s * 0.84, s * 0.54);
  ctx.fillStyle = '#9c9486';
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#b7ae9e';
    ctx.fillRect(-s * 0.42 + i * s * 0.24, -s * 0.36, s * 0.14, s * 0.2);
    ctx.fillStyle = '#6f685c';
    ctx.fillRect(-s * 0.4 + i * s * 0.24, -s * 0.34, s * 0.04, s * 0.16);
  }
  ctx.fillStyle = '#6d675c';
  ctx.fillRect(-s * 0.42, s * 0.26, s * 0.84, s * 0.1);
  ctx.fillStyle = 'rgba(80,120,180,0.55)';
  ctx.fillRect(-s * 0.28, -s * 0.02, s * 0.1, s * 0.12);
  ctx.fillRect(s * 0.16, -s * 0.02, s * 0.1, s * 0.12);
  ctx.fillStyle = '#2a1c12';
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, s * 0.36);
  ctx.lineTo(-s * 0.12, s * 0.06);
  ctx.arc(0, s * 0.06, s * 0.12, Math.PI, 0);
  ctx.lineTo(s * 0.12, s * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e23b3b';
  ctx.beginPath();
  ctx.moveTo(s * 0.02, -s * 0.36);
  ctx.lineTo(s * 0.02, -s * 0.68);
  ctx.lineTo(s * 0.28, -s * 0.56);
  ctx.lineTo(s * 0.02, -s * 0.5);
  ctx.fill();
  ctx.strokeStyle = '#4a4036';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(s * 0.02, -s * 0.36);
  ctx.lineTo(s * 0.02, -s * 0.68);
  ctx.stroke();
  ctx.restore();
}
