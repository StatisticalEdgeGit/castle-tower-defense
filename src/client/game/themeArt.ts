// Robots and Mushrooms skins for the landscape and enemies. Towers stay classic.
// Drawn only on this client; the match itself is unchanged.
import type { EnemyType } from '../../shared/types';
import { ENEMIES } from '../../shared/config';
import type { SkinnedTheme } from './viewTheme';

export interface WorldColors {
  grassA: string;
  grassB: string;
  path: string;
  pathEdge: string;
  water: string;
  accent: string;
}

const ROBOT_ENEMY: Record<EnemyType, string> = {
  grunt: '#94a3b8',
  runner: '#fbbf24',
  swarm: '#a78bfa',
  knight: '#e2e8f0',
  brute: '#f87171',
  healer: '#e0f2fe',
  warlord: '#ef4444',
  splitter: '#c084fc',
  splitling: '#ddd6fe',
  shield: '#60a5fa',
  raider: '#fb7185',
  golem: '#64748b',
  shade: '#6366f1',
  bat: '#a855f7',
  harpy: '#2dd4bf',
  drake: '#22c55e',
  titan: '#f97316',
  stormRoc: '#38bdf8',
  colossus: '#475569',
  voidDragon: '#8b5cf6',
};

const SHROOM_ENEMY: Record<EnemyType, string> = {
  grunt: '#d97706',
  runner: '#facc15',
  swarm: '#c084fc',
  knight: '#78716c',
  brute: '#b91c1c',
  healer: '#fbcfe8',
  warlord: '#9f1239',
  splitter: '#7c3aed',
  splitling: '#ddd6fe',
  shield: '#2563eb',
  raider: '#ea580c',
  golem: '#57534e',
  shade: '#4c1d95',
  bat: '#7e22ce',
  harpy: '#0f766e',
  drake: '#15803d',
  titan: '#9a3412',
  stormRoc: '#0284c7',
  colossus: '#292524',
  voidDragon: '#581c87',
};

/** Ground, path and water colours for a skinned theme. */
export function worldColors(theme: SkinnedTheme): WorldColors {
  if (theme === 'robots') {
    return { grassA: '#243044', grassB: '#2c3a52', path: '#67e8f9', pathEdge: '#0f172a', water: '#0e7490', accent: '#22d3ee' };
  }
  return { grassA: '#4d7a45', grassB: '#3f6a3c', path: '#f3d2a2', pathEdge: '#a16207', water: '#6d28d9', accent: '#f472b6' };
}

/** Body colour used for hit sparks, so bursts match the skin. */
export function themedEnemyColor(theme: SkinnedTheme, type: EnemyType): string {
  return theme === 'robots' ? ROBOT_ENEMY[type] : SHROOM_ENEMY[type];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Extra marks on a ground tile: panel lines, or moss and tiny caps. */
export function paintThemedGround(ctx: CanvasRenderingContext2D, theme: SkinnedTheme, x: number, y: number, s: number, rng: () => number): void {
  if (theme === 'robots') {
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
    if (rng() < 0.22) {
      ctx.fillStyle = rng() < 0.5 ? '#67e8f9' : '#fbbf24';
      ctx.fillRect(x * s + s * 0.4, y * s + s * 0.4, Math.max(1.5, s * 0.08), Math.max(1.5, s * 0.08));
    }
    return;
  }
  ctx.fillStyle = 'rgba(60, 30, 10, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x * s + rng() * s, y * s + rng() * s, s * 0.12, s * 0.07, rng() * 2, 0, Math.PI * 2);
  ctx.fill();
  if (rng() < 0.2) {
    const mx = x * s + (0.2 + rng() * 0.6) * s;
    const my = y * s + (0.35 + rng() * 0.4) * s;
    ctx.fillStyle = '#f6ead2';
    ctx.fillRect(mx - s * 0.015, my, s * 0.03, s * 0.08);
    ctx.fillStyle = rng() < 0.5 ? '#e11d48' : '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(mx, my, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A tree or rock redrawn as a dish, crate, or mushroom. */
export function drawThemeProp(ctx: CanvasRenderingContext2D, theme: SkinnedTheme, kind: 'tree' | 'rock', cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (theme === 'robots') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.22, s * 0.28, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'tree') {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, s * 0.2);
      ctx.lineTo(0, -s * 0.22);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.22, s * 0.22, s * 0.1, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(s * 0.08, -s * 0.24, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#475569';
      roundRect(ctx, -s * 0.22, -s * 0.16, s * 0.44, s * 0.32, s * 0.04);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.strokeRect(-s * 0.12, -s * 0.06, s * 0.24, s * 0.14);
    }
  } else {
    const cap = kind === 'tree' ? '#dc2626' : '#f59e0b';
    const scale = kind === 'tree' ? 1 : 0.62;
    ctx.fillStyle = '#f6ead2';
    ctx.fillRect(-s * 0.04 * scale, -s * 0.02, s * 0.08 * scale, s * 0.28 * scale);
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.05, s * 0.28 * scale, s * 0.16 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(-s * 0.08 * scale, -s * 0.08, s * 0.05 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The base at the end of the path: a bunker, or a giant mushroom. */
export function drawThemeBase(ctx: CanvasRenderingContext2D, theme: SkinnedTheme, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.34, s * 0.5, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  if (theme === 'robots') {
    ctx.fillStyle = '#1e293b';
    roundRect(ctx, -s * 0.4, -s * 0.22, s * 0.8, s * 0.52, s * 0.06);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.fillRect(-s * 0.4, -s * 0.34, s * 0.18, s * 0.16);
    ctx.fillRect(s * 0.22, -s * 0.34, s * 0.18, s * 0.16);
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(-s * 0.22, -s * 0.02, s * 0.16, s * 0.1);
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(s * 0.22, -s * 0.02, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.22);
    ctx.lineTo(0, -s * 0.55);
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.55, s * 0.16, s * 0.07, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#f6ead2';
    ctx.fillRect(-s * 0.1, -s * 0.05, s * 0.2, s * 0.4);
    ctx.fillStyle = '#be123c';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.08, s * 0.46, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fecdd3';
    ctx.beginPath();
    ctx.arc(-s * 0.18, -s * 0.14, s * 0.08, 0, Math.PI * 2);
    ctx.arc(s * 0.16, -s * 0.02, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f2a1a';
    ctx.beginPath();
    ctx.moveTo(-s * 0.07, s * 0.35);
    ctx.lineTo(-s * 0.07, s * 0.12);
    ctx.arc(0, s * 0.12, s * 0.07, Math.PI, 0);
    ctx.lineTo(s * 0.07, s * 0.35);
    ctx.fill();
  }
  ctx.restore();
}


/** Enemy body already translated to the enemy's position. Status effects are drawn by the caller. */
export function drawThemedEnemyBody(ctx: CanvasRenderingContext2D, theme: SkinnedTheme, type: EnemyType, r: number, dir: number): void {
  const col = theme === 'robots' ? ROBOT_ENEMY[type] : SHROOM_ENEMY[type];
  const def = ENEMIES[type];
  if (def.movement === 'air') {
    ctx.fillStyle = theme === 'robots' ? '#bae6fd' : '#f5d0fe';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, 0);
    ctx.lineTo(-r * 1.45, -r * 0.72);
    ctx.lineTo(-r * 1.05, r * 0.5);
    ctx.lineTo(-r * 0.2, r * 0.3);
    ctx.moveTo(r * 0.2, 0);
    ctx.lineTo(r * 1.45, -r * 0.72);
    ctx.lineTo(r * 1.05, r * 0.5);
    ctx.lineTo(r * 0.2, r * 0.3);
    ctx.fill();
  }
  if (theme === 'robots') {
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, -r * 1.05, -r * 0.75, r * 2.1, r * 1.55, r * 0.28);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(ctx, -r * 0.82, -r * 0.55, r * 1.64, r * 1.1, r * 0.2);
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.fillRect(-r * 0.9, r * 0.28, r * 1.8, r * 0.22);
    if (def.boss) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.75);
      ctx.lineTo(0, -r * 1.45);
      ctx.stroke();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(0, -r * 1.5, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (type === 'knight' || type === 'shield' || type === 'golem' || type === 'titan' || type === 'colossus') {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.strokeRect(-r * 0.95, -r * 0.7, r * 1.9, r * 1.35);
    }
  } else {
    ctx.fillStyle = '#f6ead2';
    ctx.fillRect(-r * 0.22, -r * 0.05, r * 0.44, r * 0.9);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.08, r * 0.98, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.18, r * 0.16, 0, Math.PI * 2);
    ctx.arc(r * 0.28, -r * 0.02, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    if (def.boss) {
      ctx.fillStyle = '#fecdd3';
      ctx.beginPath();
      ctx.ellipse(-r * 0.55, -r * 0.35, r * 0.28, r * 0.16, -0.4, 0, Math.PI * 2);
      ctx.ellipse(r * 0.55, -r * 0.35, r * 0.28, r * 0.16, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const ex = Math.cos(dir) * r * 0.28;
  const ey = Math.sin(dir) * r * 0.22 - r * 0.12;
  ctx.fillStyle = theme === 'robots' ? '#67e8f9' : '#1c1917';
  ctx.beginPath();
  ctx.arc(ex - r * 0.16, ey, r * 0.12, 0, Math.PI * 2);
  ctx.arc(ex + r * 0.16, ey, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'healer') {
    ctx.fillStyle = theme === 'robots' ? '#fff' : '#fff7ed';
    ctx.fillRect(-r * 0.08, -r * 0.42, r * 0.16, r * 0.42);
    ctx.fillRect(-r * 0.22, -r * 0.28, r * 0.44, r * 0.14);
  }
}
