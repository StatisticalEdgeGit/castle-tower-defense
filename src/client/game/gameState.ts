// Client-side match state (outside React: snapshots arrive at 20 Hz). React components
// read from here through the small subscribe helpers / polling hook.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { MAPS, type GameMap } from '../../shared/maps';
import type { Fx, MatchPlayerInfo, MatchStartInfo, PlayerSnap, Snapshot, TowerSnap } from '../../shared/protocol';
import type { TowerType } from '../../shared/types';
import { SnapshotBuffer } from './interpolation';

export interface FxEvent {
  n: number;
  seq: number;
  boardId: number;
  fx: Fx;
}

export interface UiState {
  buildType: TowerType | null;
  selectedTower: number | null;
  sendTarget: string | null;
  viewBoard: number;
  hover: { tx: number; ty: number } | null;
}

class GameClient {
  info: MatchStartInfo | null = null;
  map: GameMap | null = null;
  myId = '';
  buffer = new SnapshotBuffer();
  latest: Snapshot | null = null;
  towers = new Map<number, TowerSnap[]>();
  aims = new Map<number, number>();
  fxEvents: FxEvent[] = [];
  private fxCounter = 0;
  ui: UiState = { buildType: null, selectedTower: null, sendTarget: null, viewBoard: 0, hover: null };
  private uiListeners = new Set<() => void>();
  private snapListeners = new Set<() => void>();
  snapVersion = 0;

  reset(info: MatchStartInfo, myId: string): void {
    const same = this.info?.matchId === info.matchId;
    this.info = info;
    this.map = MAPS[info.mapId];
    this.myId = myId;
    if (!same) {
      this.buffer.clear();
      this.latest = null;
      this.towers.clear();
      this.aims.clear();
      this.fxEvents = [];
      const me = info.players.find((p) => p.id === myId);
      this.ui = { buildType: null, selectedTower: null, sendTarget: null, viewBoard: me?.boardId ?? 0, hover: null };
      this.emitUi();
    }
  }

  clear(): void {
    this.info = null;
    this.latest = null;
    this.buffer.clear();
    this.towers.clear();
    this.fxEvents = [];
  }

  onSnapshot(s: Snapshot): void {
    const now = performance.now();
    this.buffer.push(s, now);
    this.latest = s;
    for (const b of s.boards) {
      if (b.towers) {
        this.towers.set(b.id, b.towers);
        if (this.ui.selectedTower !== null && !b.towers.some((t) => t.id === this.ui.selectedTower)) {
          // our selection may have been sold
          if (!this.findTower(this.ui.selectedTower)) this.setUi({ selectedTower: null });
        }
      }
      for (let i = 0; i < b.aim.length; i += 2) this.aims.set(b.aim[i], b.aim[i + 1] / 100);
      for (const fx of b.fx) this.fxEvents.push({ n: ++this.fxCounter, seq: s.seq, boardId: b.id, fx });
    }
    // keep ~3 s of fx history for late renderers
    if (this.fxEvents.length > 600) this.fxEvents.splice(0, this.fxEvents.length - 600);
    this.snapVersion++;
    for (const l of this.snapListeners) l();
  }

  findTower(id: number): (TowerSnap & { boardId: number }) | null {
    for (const [boardId, list] of this.towers) {
      const t = list.find((x) => x.id === id);
      if (t) return { ...t, boardId };
    }
    return null;
  }

  towerAt(boardId: number, tx: number, ty: number): TowerSnap | null {
    return this.towers.get(boardId)?.find((t) => t.tx === tx && t.ty === ty) ?? null;
  }

  me(): PlayerSnap | undefined {
    return this.latest?.players.find((p) => p.id === this.myId);
  }

  myInfo(): MatchPlayerInfo | undefined {
    return this.info?.players.find((p) => p.id === this.myId);
  }

  playerInfo(id: string): MatchPlayerInfo | undefined {
    return this.info?.players.find((p) => p.id === id);
  }

  get versus(): boolean {
    return !!this.info && this.info.mode !== 'coop';
  }

  setUi(patch: Partial<UiState>): void {
    this.ui = { ...this.ui, ...patch };
    this.emitUi();
  }

  private emitUi(): void {
    for (const l of this.uiListeners) l();
  }

  subscribeUi = (fn: () => void) => {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  };

  subscribeSnap = (fn: () => void) => {
    this.snapListeners.add(fn);
    return () => this.snapListeners.delete(fn);
  };
}

export const game = new GameClient();

export function useGameUi(): UiState {
  return useSyncExternalStore(game.subscribeUi, () => game.ui);
}

/** Re-render at most `hz` times per second while snapshots arrive. */
export function useSnapshot(hz = 10): Snapshot | null {
  const [, setN] = useState(0);
  useEffect(() => {
    let last = 0;
    let pending: number | null = null;
    const unsub = game.subscribeSnap(() => {
      const now = performance.now();
      const wait = 1000 / hz - (now - last);
      if (wait <= 0) {
        last = now;
        setN((n) => n + 1);
      } else if (pending === null) {
        pending = window.setTimeout(() => {
          pending = null;
          last = performance.now();
          setN((n) => n + 1);
        }, wait);
      }
    });
    return () => {
      unsub();
      if (pending !== null) clearTimeout(pending);
    };
  }, [hz]);
  return game.latest;
}
