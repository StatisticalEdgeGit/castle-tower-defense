// Vector art for towers, enemies and map tiles. All functions draw centred at (x, y)
// with `s` = tile size in pixels. Shared by the board renderer and UI icons.
import type { GameMap } from '../../shared/maps';
import { TILE_PATH } from '../../shared/maps';
import { mulberry32 } from '../../shared/rng';
import type { EnemyType, TowerType } from '../../shared/types';
import { ENEMY_TYPES } from '../../shared/types';

export const TOWER_COLORS: Record<TowerType, { base: string; dark: string; accent: string }> = {
  archer: { base: '#a8763e', dark: '#6b4a26', accent: '#f1d18a' },
  cannon: { base: '#5d6573', dark: '#2f343d', accent: '#ffb547' },
  frost: { base: '#7fd4ff', dark: '#2f7fb3', accent: '#e6f8ff' },
  sniper: { base: '#5f8a4e', dark: '#33502a', accent: '#d7ff9e' },
  tesla: { base: '#8a63ff', dark: '#47309b', accent: '#9ef0ff' },
  mine: { base: '#c99a2e', dark: '#7a5a14', accent: '#ffe27a' },
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
  // stone base
  const b = s * 0.36;
  ctx.fillStyle = '#3b4252';
  roundRect(ctx, -b, -b, b * 2, b * 2, s * 0.1);
  ctx.fill();
  ctx.fillStyle = c.dark;
  roundRect(ctx, -b * 0.86, -b * 0.86, b * 1.72, b * 1.72, s * 0.08);
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

// ── Enemies ────────────────────────────────────────────────────────────────
export function enemyRadius(type: EnemyType, s: number): number {
  const r: Record<EnemyType, number> = { grunt: 0.24, runner: 0.21, swarm: 0.14, knight: 0.27, brute: 0.34, healer: 0.24, warlord: 0.46, splitter: 0.28, splitling: 0.13, shield: 0.28 };
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
  const r = enemyRadius(type, s);
  const col = ENEMY_COLORS[type];
  const bob = Math.sin(time * 10 + x * 0.1) * s * 0.015;
  ctx.save();
  ctx.translate(x, y + bob);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.75, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.restore();
  if (showHp && hpFrac < 0.999) {
    const w = Math.max(r * 2, s * 0.5);
    const h = Math.max(2, s * 0.07);
    const by = y - r - s * 0.16;
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
  const th = map.theme;
  const rng = mulberry32(map.width * 131 + map.name.length * 7);
  // grass
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? th.grassA : th.grassB;
      ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      if (detail) {
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
          const gx = x * s + rng() * s;
          const gy = y * s + rng() * s;
          ctx.fillRect(gx, gy, Math.max(1, s * 0.06), Math.max(1, s * 0.12));
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
    ctx.fillStyle = 'rgba(230,220,170,0.35)';
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
    const g = ctx.createRadialGradient(e.x * s, e.y * s, 0, e.x * s, e.y * s, s * 0.7);
    g.addColorStop(0, 'rgba(20,0,30,0.85)');
    g.addColorStop(1, 'rgba(60,0,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x * s, e.y * s, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of map.exits) drawCastle(ctx, e.x * s, e.y * s, s);
}

export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(s * 0.05, s * 0.36, s * 0.5, s * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8b2a6';
  ctx.fillRect(-s * 0.42, -s * 0.2, s * 0.84, s * 0.55);
  for (let i = 0; i < 4; i++) ctx.fillRect(-s * 0.42 + i * s * 0.24, -s * 0.32, s * 0.12, s * 0.14);
  ctx.fillStyle = '#8c8578';
  ctx.fillRect(-s * 0.42, s * 0.25, s * 0.84, s * 0.1);
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.moveTo(-s * 0.13, s * 0.35);
  ctx.lineTo(-s * 0.13, s * 0.05);
  ctx.arc(0, s * 0.05, s * 0.13, Math.PI, 0);
  ctx.lineTo(s * 0.13, s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e04848';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.32);
  ctx.lineTo(0, -s * 0.62);
  ctx.lineTo(s * 0.22, -s * 0.54);
  ctx.lineTo(0, -s * 0.46);
  ctx.fill();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.32);
  ctx.lineTo(0, -s * 0.62);
  ctx.stroke();
  ctx.restore();
}
