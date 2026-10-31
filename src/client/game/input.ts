// Pointer + keyboard input for the main board. Placement is edited on the map, then confirmed.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ECONOMY, TOWERS } from '../../shared/config';
import { EV } from '../../shared/protocol';
import type { TowerType } from '../../shared/types';
import { request } from '../net';
import { confirmDialog, toast } from '../store';
import { game } from './gameState';
import { nextId, nextTargetMode } from './hotkeys';
import { placementCheck, placementPreview } from './placement';
import type { BoardRenderer } from './renderer';

export const EXPENSIVE_SELL = 300;
/** Finger jitter below this is a tap, not a drag. */
const TAP_SLOP = 18;

let boardRenderer: BoardRenderer | null = null;
let confirming = false;
let shopPointerAt = 0;

function rememberPlacement(): void {
  try {
    localStorage.setItem('ctd.placeOnce', '1');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('ctd-placed'));
}

function trackPointer(pointerId: number, onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) onMove(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export async function placeAt(tx: number, ty: number, keepBuilding: boolean): Promise<boolean> {
  const ui = game.ui;
  const me = game.myInfo();
  if (!ui.buildType || !me) return false;
  if (ui.viewBoard !== me.boardId) {
    toast('warn', 'You can only build on your own board');
    return false;
  }
  const type = ui.buildType;
  const chk = placementCheck(me.boardId, tx, ty, type);
  if (!chk.ok) {
    if (chk.reason) toast('error', chk.reason);
    return false;
  }
  const r = await request<{ towerId?: number }>(EV.placeTower, { boardId: me.boardId, tx, ty, type });
  if (!r.ok) {
    toast('error', r.error);
    return false;
  }
  rememberPlacement();
  game.setUi(
    keepBuilding
      ? { staged: null }
      : { buildType: null, staged: null, moveTowerId: null, selectedTower: r.towerId ?? null },
  );
  return true;
}

export async function moveAt(towerId: number, tx: number, ty: number): Promise<boolean> {
  const t = game.findTower(towerId);
  if (!t) return false;
  if (t.owner !== game.myId) {
    toast('warn', 'Only the owner can move this tower');
    return false;
  }
  if (t.freeMove === false) {
    toast('info', 'This tower was already moved');
    return false;
  }
  if (t.tx === tx && t.ty === ty) {
    toast('info', 'Pick a different square');
    return false;
  }
  const chk = placementCheck(t.boardId, tx, ty, t.type, { ignoreTowerId: towerId, moving: true });
  if (!chk.ok) {
    if (chk.reason) toast('error', chk.reason);
    return false;
  }
  const r = await request(EV.moveTower, { towerId, tx, ty });
  if (!r.ok) {
    toast('error', r.error);
    return false;
  }
  game.setUi({ moveTowerId: null, staged: null, selectedTower: towerId });
  return true;
}

/**
 * A tap or drag-release while a turret is armed. A legal square that reaches the
 * road is placed immediately. A square the circle only grazes stays staged so
 * the player can confirm it. An illegal square is rejected.
 */
function finishBuildTap(tile: { tx: number; ty: number }, keepBuilding: boolean): void {
  const ui = game.ui;
  if (!ui.buildType) return;
  const preview = placementPreview(ui.viewBoard, { ...ui, hover: tile, staged: tile });
  if (!preview?.ok) {
    if (preview?.reason) toast('error', preview.reason);
    game.setUi({ staged: null });
    return;
  }
  game.setUi({ hover: tile, staged: tile });
  if (preview.reaches === false) return;
  void confirmPlacement(keepBuilding);
}

/** Place or commit the free move on the square under the pointer (or the last staged square). */
export async function confirmPlacement(keepBuilding = false): Promise<void> {
  if (confirming) return;
  const ui = game.ui;
  const tile = ui.hover ?? ui.staged;
  if (!ui.buildType && ui.moveTowerId === null) return;
  if (!tile) {
    toast('info', 'Choose a square on the map first');
    return;
  }
  confirming = true;
  try {
    if (ui.buildType) await placeAt(tile.tx, tile.ty, keepBuilding);
    else if (ui.moveTowerId !== null) await moveAt(ui.moveTowerId, tile.tx, tile.ty);
  } finally {
    confirming = false;
  }
}

/** Drop the in-progress place or move. If nothing is in progress, clear the selection. */
export function cancelPlacementEdit(): void {
  const ui = game.ui;
  if (ui.buildType || ui.moveTowerId !== null || ui.groundTargetTowerId !== null || ui.staged) {
    game.setUi({ buildType: null, moveTowerId: null, groundTargetTowerId: null, staged: null });
    return;
  }
  game.setUi({ selectedTower: null });
}

/** Start the one free reposition for a tower you own. */
export function beginMove(towerId: number): void {
  const t = game.findTower(towerId);
  if (!t || t.owner !== game.myId) return;
  if (t.freeMove === false) {
    toast('info', 'This tower was already moved');
    return;
  }
  game.setUi({
    moveTowerId: towerId,
    buildType: null,
    selectedTower: towerId,
    staged: { tx: t.tx, ty: t.ty },
    viewBoard: t.boardId,
    groundTargetTowerId: null,
  });
}

/** Arm a manually aimed tower so the next map click becomes its impact point. */
export function beginGroundTarget(towerId: number): void {
  const t = game.findTower(towerId);
  if (!t || t.owner !== game.myId || !TOWERS[t.type].groundTarget) return;
  game.setUi({
    groundTargetTowerId: towerId,
    selectedTower: towerId,
    buildType: null,
    moveTowerId: null,
    staged: null,
    viewBoard: t.boardId,
  });
}

/** Gold mines this player already owns on their board. */
export function ownedMineCount(): number {
  const my = game.myInfo();
  if (!my) return 0;
  return (game.towers.get(my.boardId) ?? []).filter((t) => t.owner === game.myId && t.type === 'mine').length;
}

/** Why a gold mine cannot be armed, or null when another mine is allowed. */
export function mineCapReason(): string | null {
  if (ownedMineCount() >= ECONOMY.maxMinesPerPlayer) return `Max ${ECONOMY.maxMinesPerPlayer} gold mines`;
  return null;
}

/** Arm a turret for placement, or put it away if it is already armed. */
export function toggleBuild(type: TowerType): void {
  const my = game.myInfo();
  const me = game.me();
  if (!my || !me?.alive) return;
  if (game.ui.buildType === type && game.ui.moveTowerId === null) {
    game.setUi({ buildType: null, staged: null });
    return;
  }
  if (type === 'mine') {
    const reason = mineCapReason();
    if (reason) {
      toast('info', reason);
      return;
    }
  }
  game.setUi({
    buildType: type,
    moveTowerId: null,
    selectedTower: null,
    staged: null,
    viewBoard: my.boardId,
    groundTargetTowerId: null,
  });
}

/** Step the selected turret to its next targeting mode. */
export function cycleTargeting(): void {
  const id = game.ui.selectedTower;
  if (id === null) return;
  const t = game.findTower(id);
  if (!t || t.owner !== game.myId || !TOWERS[t.type].attacks || TOWERS[t.type].groundTarget) return;
  const mode = nextTargetMode(t.targeting);
  void request(EV.setTargeting, { towerId: id, mode }).then((r) => {
    if (!r.ok) toast('error', r.error);
  });
}

/** Point the next send at the next living opponent in a free-for-all. */
export function cycleSendTarget(): void {
  const info = game.info;
  const snap = game.latest;
  const me = game.myInfo();
  if (!info || !snap || !me || info.mode !== 'ffa') return;
  const ids = info.players.filter((p) => p.boardId !== me.boardId && snap.boards[p.boardId]?.alive).map((p) => p.id);
  game.setUi({ sendTarget: nextId(ids, game.ui.sendTarget) });
}

/** Keyboard activation of a shop card. Pointer taps are handled in {@link onShopPointerDown}. */
export function onShopClick(type: TowerType): void {
  if (performance.now() - shopPointerAt < 120) return;
  toggleBuild(type);
}

/** Tap a shop card to arm it, or drag it onto a square. */
export function onShopPointerDown(type: TowerType, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const my = game.myInfo();
  const me = game.me();
  if (!my || !me?.alive) return;
  if (type === 'mine' && game.ui.buildType !== type) {
    const reason = mineCapReason();
    if (reason) {
      toast('info', reason);
      return;
    }
  }
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragged = false;
  const arm = (ev: PointerEvent) => {
    const tile = boardRenderer?.tileAt(ev.clientX, ev.clientY) ?? null;
    game.setUi({
      buildType: type,
      moveTowerId: null,
      selectedTower: null,
      viewBoard: my.boardId,
      hover: tile,
      staged: tile,
      groundTargetTowerId: null,
    });
  };
  trackPointer(
    e.pointerId,
    (ev) => {
      if (!dragged && Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP_SLOP) return;
      dragged = true;
      arm(ev);
    },
    (ev) => {
      shopPointerAt = performance.now();
      if (!dragged) {
        toggleBuild(type);
        return;
      }
      const tile = boardRenderer?.tileAt(ev.clientX, ev.clientY) ?? null;
      if (!tile) {
        game.setUi({ buildType: type, moveTowerId: null, selectedTower: null, viewBoard: my.boardId, hover: null, staged: null });
        return;
      }
      finishBuildTap(tile, ev.shiftKey);
    },
  );
}

export function upgradeSelected(): void {
  const id = game.ui.selectedTower;
  if (id === null) return;
  const t = game.findTower(id);
  if (!t) return;
  if (t.owner !== game.myId) return toast('warn', 'Only the owner can upgrade this tower');
  if (t.level >= 3) return toast('info', 'Already at max level');
  void request(EV.upgradeTower, { towerId: id }).then((r) => {
    if (!r.ok) toast('error', r.error);
  });
}

export function sellSelected(): void {
  const id = game.ui.selectedTower;
  if (id === null) return;
  const t = game.findTower(id);
  if (!t) return;
  if (t.owner !== game.myId) return toast('warn', 'Only the owner can sell this tower');
  const doSell = () =>
    void request<{ refund?: number }>(EV.sellTower, { towerId: id }).then((r) => {
      if (!r.ok) toast('error', r.error);
      else game.setUi({ selectedTower: null, moveTowerId: null, groundTargetTowerId: null, staged: null });
    });
  if (t.invested >= EXPENSIVE_SELL) {
    confirmDialog({
      title: `Sell ${TOWERS[t.type].name} (level ${t.level})?`,
      text: `You'll get back $${Math.floor(t.invested * ECONOMY.sellRefund)} of the $${t.invested} invested.`,
      confirmLabel: 'Sell',
      onConfirm: doSell,
    });
  } else doSell();
}

/** Attach pointer handlers to the main canvas. Returns a cleanup function. */
export function attachBoardInput(canvas: HTMLCanvasElement, renderer: BoardRenderer): () => void {
  boardRenderer = renderer;
  const touchPoints = new Map<number, { x: number; y: number }>();
  const gesturePointers = new Set<number>();
  let pinch: { distance: number; midX: number; midY: number } | null = null;

  const pinchState = () => {
    const points = [...touchPoints.values()];
    if (points.length < 2) return null;
    const a = points[0];
    const b = points[1];
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  };

  const onGestureMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !touchPoints.has(e.pointerId)) return;
    touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = pinchState();
    if (!next) return;
    e.preventDefault();
    if (pinch) {
      renderer.zoomBy(next.distance / pinch.distance, pinch.midX, pinch.midY);
      renderer.panBy(next.midX - pinch.midX, next.midY - pinch.midY);
    }
    pinch = next;
  };

  const onGestureEnd = (e: PointerEvent) => {
    if (!touchPoints.has(e.pointerId)) return;
    touchPoints.delete(e.pointerId);
    if (touchPoints.size < 2) pinch = null;
    // Placement's pointer-up listener runs on the same event. Keep the marker
    // until that listener has had a chance to suppress the accidental tap.
    window.setTimeout(() => gesturePointers.delete(e.pointerId), 0);
  };

  const startPan = (e: PointerEvent, onTap?: () => void) => {
    let x = e.clientX;
    let y = e.clientY;
    let moved = false;
    canvas.style.cursor = 'grabbing';
    trackPointer(
      e.pointerId,
      (ev) => {
        const dx = ev.clientX - x;
        const dy = ev.clientY - y;
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) >= TAP_SLOP) moved = true;
        if (moved) renderer.panBy(dx, dy);
        x = ev.clientX;
        y = ev.clientY;
      },
      () => {
        canvas.style.cursor = renderer.zoomLevel > 1 ? 'grab' : 'default';
        if (!moved) onTap?.();
      },
    );
  };

  const onMove = (e: PointerEvent) => {
    if (gesturePointers.has(e.pointerId)) return;
    const t = renderer.tileAt(e.clientX, e.clientY);
    const h = game.ui.hover;
    if ((t?.tx ?? -1) !== (h?.tx ?? -1) || (t?.ty ?? -1) !== (h?.ty ?? -1)) game.setUi({ hover: t });
    const tw = t ? game.towerAt(game.ui.viewBoard, t.tx, t.ty) : null;
    const canDrag = !!tw && tw.owner === game.myId && tw.freeMove !== false;
    canvas.style.cursor = game.ui.buildType || game.ui.moveTowerId !== null || game.ui.groundTargetTowerId !== null ? 'crosshair' : canDrag || renderer.zoomLevel > 1 ? 'grab' : tw ? 'pointer' : 'default';
  };
  const onLeave = () => game.setUi({ hover: null });
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      gesturePointers.delete(e.pointerId);
      touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPoints.size >= 2) {
        for (const id of touchPoints.keys()) gesturePointers.add(id);
        pinch = pinchState();
        e.preventDefault();
        return;
      }
    }
    if (e.button === 2) {
      e.preventDefault();
      cancelPlacementEdit();
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const t = renderer.tileAt(e.clientX, e.clientY);
    if (!t) {
      if (renderer.zoomLevel > 1) startPan(e);
      return;
    }
    if (game.ui.groundTargetTowerId !== null) {
      const towerId = game.ui.groundTargetTowerId;
      void request(EV.setGroundTarget, { towerId, tx: t.tx, ty: t.ty }).then((r) => {
        if (!r.ok) toast('error', r.error);
        else game.setUi({ groundTargetTowerId: null, selectedTower: towerId, hover: t });
      });
      return;
    }
    if (game.ui.buildType || game.ui.moveTowerId !== null) {
      const moving = game.ui.moveTowerId !== null;
      game.setUi({ staged: t, hover: t });
      const x0 = e.clientX;
      const y0 = e.clientY;
      let dragged = false;
      trackPointer(
        e.pointerId,
        (ev) => {
          if (gesturePointers.has(ev.pointerId)) return;
          if (!dragged && Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP_SLOP) return;
          dragged = true;
          const p = renderer.tileAt(ev.clientX, ev.clientY);
          if (p) game.setUi({ hover: p, staged: p });
        },
        (ev) => {
          if (gesturePointers.has(ev.pointerId)) return;
          const p = renderer.tileAt(ev.clientX, ev.clientY) ?? t;
          if (moving) {
            game.setUi({ hover: p, staged: p });
            return;
          }
          const tw = game.towerAt(game.ui.viewBoard, p.tx, p.ty);
          if (!dragged && tw) {
            game.setUi({ selectedTower: tw.id, buildType: null, moveTowerId: null, staged: null });
            return;
          }
          finishBuildTap(p, ev.shiftKey);
        },
      );
      return;
    }
    const tw = game.towerAt(game.ui.viewBoard, t.tx, t.ty);
    if (!tw && renderer.zoomLevel > 1) {
      startPan(e, () => game.setUi({ selectedTower: null, buildType: null, moveTowerId: null, staged: null }));
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragged = false;
    trackPointer(
      e.pointerId,
      (ev) => {
        if (gesturePointers.has(ev.pointerId)) return;
        if (dragged || Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP_SLOP) return;
        if (!tw || tw.owner !== game.myId || tw.freeMove === false) return;
        const my = game.myInfo();
        if (my && game.ui.viewBoard !== my.boardId) return;
        dragged = true;
        game.setUi({ moveTowerId: tw.id, buildType: null, selectedTower: tw.id, staged: { tx: tw.tx, ty: tw.ty }, hover: t });
      },
      (ev) => {
        if (gesturePointers.has(ev.pointerId)) return;
        if (!dragged) {
          game.setUi({ selectedTower: tw ? tw.id : null, buildType: null, moveTowerId: null, staged: null });
          return;
        }
        const p = renderer.tileAt(ev.clientX, ev.clientY);
        if (p) game.setUi({ hover: p, staged: p });
      },
    );
  };
  const onContext = (e: Event) => {
    e.preventDefault();
    cancelPlacementEdit();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.max(0.8, Math.min(1.25, Math.exp(-e.deltaY * 0.0015)));
    renderer.zoomBy(factor, e.clientX, e.clientY);
  };
  window.addEventListener('pointermove', onGestureMove, { passive: false });
  window.addEventListener('pointerup', onGestureEnd);
  window.addEventListener('pointercancel', onGestureEnd);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    if (boardRenderer === renderer) boardRenderer = null;
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', onGestureEnd);
    window.removeEventListener('pointercancel', onGestureEnd);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('contextmenu', onContext);
    canvas.removeEventListener('wheel', onWheel);
  };
}
