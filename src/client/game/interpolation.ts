// Snapshot buffering + interpolation. Each broadcast has a sequence number (one per
// server tick, 50 ms apart). We render slightly in the past (`delayTicks`) and lerp
// entity positions by id between the two snapshots that bracket the render time.
import { TICK_RATE } from '../../shared/config';
import type { BoardSnap, Snapshot } from '../../shared/protocol';

const TICK_MS = 1000 / TICK_RATE;

export interface Frame {
  a: Snapshot;
  b: Snapshot;
  alpha: number;
  renderSeq: number;
}

export class SnapshotBuffer {
  private buf: Snapshot[] = [];
  private offset: number | null = null;
  delayTicks = 1.7;

  clear(): void {
    this.buf = [];
    this.offset = null;
  }

  push(s: Snapshot, now: number): void {
    const last = this.buf[this.buf.length - 1];
    if (last && s.seq <= last.seq) {
      // full resync (same/older seq) replaces the buffer
      this.buf = [s];
      this.offset = now - s.seq * TICK_MS;
      return;
    }
    this.buf.push(s);
    if (this.buf.length > 12) this.buf.shift();
    const off = now - s.seq * TICK_MS;
    if (this.offset === null || off < this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.02; // drift slowly towards later arrivals
    // if we fell far behind (tab was hidden), snap the clock
    if (now - (this.offset + s.seq * TICK_MS) > 500) this.offset = off;
  }

  get latest(): Snapshot | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  frame(now: number): Frame | null {
    const n = this.buf.length;
    if (n === 0 || this.offset === null) return null;
    const renderSeq = (now - this.offset) / TICK_MS - this.delayTicks;
    if (n === 1) return { a: this.buf[0], b: this.buf[0], alpha: 1, renderSeq };
    if (renderSeq <= this.buf[0].seq) return { a: this.buf[0], b: this.buf[0], alpha: 1, renderSeq };
    for (let i = n - 1; i > 0; i--) {
      const a = this.buf[i - 1];
      const b = this.buf[i];
      if (renderSeq >= a.seq) {
        if (renderSeq >= b.seq) return { a: b, b, alpha: 1, renderSeq };
        return { a, b, alpha: (renderSeq - a.seq) / (b.seq - a.seq), renderSeq };
      }
    }
    return { a: this.buf[n - 1], b: this.buf[n - 1], alpha: 1, renderSeq };
  }
}

export interface InterpEnemy {
  id: number;
  typeIdx: number;
  x: number;
  y: number;
  hp: number;
  slowed: boolean;
  dx: number;
  dy: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Enemies of board B, positions interpolated from board A by id. */
export function interpolateEnemies(a: BoardSnap | undefined, b: BoardSnap, alpha: number): InterpEnemy[] {
  const prev = new Map<number, BoardSnap['enemies'][number]>();
  if (a && a !== b) for (const e of a.enemies) prev.set(e[0], e);
  const out: InterpEnemy[] = [];
  for (const e of b.enemies) {
    const p = prev.get(e[0]);
    if (p) {
      out.push({
        id: e[0],
        typeIdx: e[1],
        x: lerp(p[2], e[2], alpha),
        y: lerp(p[3], e[3], alpha),
        hp: lerp(p[4], e[4], alpha),
        slowed: e[5] === 1,
        dx: e[2] - p[2],
        dy: e[3] - p[3],
      });
    } else {
      out.push({ id: e[0], typeIdx: e[1], x: e[2], y: e[3], hp: e[4], slowed: e[5] === 1, dx: 0, dy: 0 });
    }
  }
  return out;
}

export function interpolateShells(a: BoardSnap | undefined, b: BoardSnap, alpha: number): { id: number; x: number; y: number }[] {
  const prev = new Map<number, [number, number, number]>();
  if (a && a !== b) for (const s of a.shells) prev.set(s[0], s);
  return b.shells.map((s) => {
    const p = prev.get(s[0]);
    return p ? { id: s[0], x: lerp(p[1], s[1], alpha), y: lerp(p[2], s[2], alpha) } : { id: s[0], x: s[1], y: s[2] };
  });
}
