// Client actions for the progression hub. The server validates everything; these just
// send requests and drive the reveal / celebration UI.
import type { Granted, LevelUp } from '../../../shared/progProtocol';
import type { ChestTier } from '../../../shared/progression';
import { EV, type Ack, type ClientToServerEvents } from '../../../shared/protocol';
import { request } from '../../net';
import { store, toast } from '../../store';

export async function progAct<T extends object = object>(ev: keyof ClientToServerEvents, payload?: unknown): Promise<Ack<T>> {
  const r = await request<T>(ev, payload);
  if (!r.ok) toast('error', r.error);
  return r;
}

export function celebrateLevelUps(levelUps: LevelUp[] | undefined): void {
  if (levelUps && levelUps.length) store.set((s) => ({ celebrations: [...s.celebrations, { kind: 'levelup', levelUps }] }));
}

export function showGranted(title: string, granted: Granted[]): void {
  if (!granted.length) return;
  store.set({ reveal: { kind: 'granted', title, granted } });
}

export async function openDropFlow(dropId: string): Promise<void> {
  store.set({ reveal: { kind: 'drop', dropId, result: null } });
  const r = await request<{ steps: never; rarity: never; granted: Granted[] }>(EV.progOpenDrop, { dropId });
  if (!r.ok) {
    store.set({ reveal: null });
    toast('error', r.error);
    return;
  }
  store.set({ reveal: { kind: 'drop', dropId, result: { steps: r.steps, rarity: r.rarity, granted: r.granted } } });
}

export async function openChestFlow(chestId: string, tier: ChestTier): Promise<void> {
  store.set({ reveal: { kind: 'chest', chestId, tier, granted: null } });
  const r = await request<{ tier: ChestTier; granted: Granted[] }>(EV.progOpenChest, { chestId });
  if (!r.ok) {
    store.set({ reveal: null });
    toast('error', r.error);
    return;
  }
  store.set({ reveal: { kind: 'chest', chestId, tier: r.tier, granted: r.granted } });
}

/** Claim something that grants items, then show them. */
export async function claimWithReveal(ev: keyof ClientToServerEvents, payload: unknown, title: string): Promise<boolean> {
  const r = await progAct<{ granted: Granted[]; levelUps?: LevelUp[] }>(ev, payload);
  if (!r.ok) return false;
  showGranted(title, r.granted ?? []);
  celebrateLevelUps(r.levelUps);
  return true;
}
