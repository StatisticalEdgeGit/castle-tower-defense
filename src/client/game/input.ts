// Mouse + keyboard input for the main board. Translates clicks/keys into intents.
import { TOWERS } from '../../shared/config';
import { EV } from '../../shared/protocol';
import { request } from '../net';
import { confirmDialog, toast } from '../store';
import { game } from './gameState';
import { placementCheck, type BoardRenderer } from './renderer';

export const EXPENSIVE_SELL = 300;

export async function placeAt(tx: number, ty: number, keepBuilding: boolean): Promise<void> {
  const ui = game.ui;
  const me = game.myInfo();
  if (!ui.buildType || !me) return;
  if (ui.viewBoard !== me.boardId) {
    toast('warn', 'You can only build on your own board');
    return;
  }
  const type = ui.buildType;
  const chk = placementCheck(me.boardId, tx, ty, type);
  if (!chk.ok) {
    if (chk.reason) toast('error', chk.reason);
    return;
  }
  if (!keepBuilding) game.setUi({ buildType: null });
  const r = await request<{ towerId?: number }>(EV.placeTower, { boardId: me.boardId, tx, ty, type });
  if (!r.ok) toast('error', r.error);
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
      else game.setUi({ selectedTower: null });
    });
  if (t.invested >= EXPENSIVE_SELL) {
    confirmDialog({
      title: `Sell ${TOWERS[t.type].name} (level ${t.level})?`,
      text: `You'll get back $${Math.floor(t.invested * 0.7)} of the $${t.invested} invested.`,
      confirmLabel: 'Sell',
      onConfirm: doSell,
    });
  } else doSell();
}

/** Attach pointer handlers to the main canvas. Returns a cleanup function. */
export function attachBoardInput(canvas: HTMLCanvasElement, renderer: BoardRenderer): () => void {
  const onMove = (e: MouseEvent) => {
    const t = renderer.tileAt(e.clientX, e.clientY);
    const h = game.ui.hover;
    if ((t?.tx ?? -1) !== (h?.tx ?? -1) || (t?.ty ?? -1) !== (h?.ty ?? -1)) game.setUi({ hover: t });
    const tw = t ? game.towerAt(game.ui.viewBoard, t.tx, t.ty) : null;
    canvas.style.cursor = game.ui.buildType ? 'crosshair' : tw ? 'pointer' : 'default';
  };
  const onLeave = () => game.setUi({ hover: null });
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const t = renderer.tileAt(e.clientX, e.clientY);
    if (!t) return;
    if (game.ui.buildType) {
      void placeAt(t.tx, t.ty, e.shiftKey);
      return;
    }
    const tw = game.towerAt(game.ui.viewBoard, t.tx, t.ty);
    game.setUi({ selectedTower: tw ? tw.id : null });
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    game.setUi({ buildType: null, selectedTower: null });
  };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('contextmenu', onContext);
  return () => {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('contextmenu', onContext);
  };
}
