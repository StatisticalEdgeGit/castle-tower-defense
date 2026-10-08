// Granting rewards, card upgrades, loadouts, reward drops, chests, trophy road, season pass,
// shop and co-op campaign. All functions mutate a Profile and return a result for the UI;
// randomness comes from seeded per-profile streams (profileRng).
import { TOWERS } from '../../shared/config';
import {
  ARENAS,
  CAMPAIGN_ORDER,
  CHEST_RARITY_DIVISOR,
  CHESTS,
  COINS_PER_LEVEL,
  COPIES_PER_LEVEL,
  DROP_RARITIES,
  DROP_TABLE,
  DROP_UPGRADE_CHANCE,
  EMOTES,
  ICONS,
  MAX_ARMY,
  MAX_CARD_LEVEL,
  MAX_LOADOUT_TOWERS,
  passFreeReward,
  passPremiumReward,
  RARITIES,
  SEASON,
  SHOP,
  STARS_TO_UNLOCK_NEXT,
  TOWER_RARITY,
  towerPool,
  TROPHY_ROAD,
  troopPool,
  UPGRADE_XP,
  xpToNext,
  type ChestTier,
  type DropRarity,
  type Rarity,
  type RewardSpec,
} from '../../shared/progression';
import { PACK_IDS, TOWER_TYPES, type MapId, type PackId, type TowerType } from '../../shared/types';
import {
  currentArena,
  levelInfo,
  newId,
  pickWeighted,
  profileRng,
  randInt,
  roadProgress,
  type Profile,
  type ShopOffer,
} from './profile';

export type Res<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

// granted items (for reveal animations) — shared with the client
import type { Granted, LevelUp } from '../../shared/progProtocol';
export type { Granted, LevelUp };

// ── basic grants ───────────────────────────────────────────────────────────
export function copiesNeeded(type: TowerType, level: number): number | null {
  if (level >= MAX_CARD_LEVEL) return null;
  return COPIES_PER_LEVEL[TOWER_RARITY[type]][level - 1];
}

export function grantCards(p: Profile, tower: TowerType, copies: number): Granted {
  const card = p.cards[tower];
  if (!card) {
    // the first copy unlocks the card, the rest count towards level 2
    p.cards[tower] = { level: 1, copies: Math.max(0, copies - 1) };
    return { kind: 'card', tower, copies, isNew: true, level: 1, copiesAfter: p.cards[tower]!.copies, copiesNeeded: copiesNeeded(tower, 1) };
  }
  card.copies += copies;
  return { kind: 'card', tower, copies, isNew: false, level: card.level, copiesAfter: card.copies, copiesNeeded: copiesNeeded(tower, card.level) };
}

export function grantTroop(p: Profile, troop: PackId): Granted {
  const isNew = !p.troops.includes(troop);
  if (isNew) {
    p.troops.push(troop);
    if (p.army.length < MAX_ARMY) p.army.push(troop);
  }
  return { kind: 'troop', troop, isNew };
}

/** Add XP; returns level-ups (each grants a chest + gems). */
export function grantXp(p: Profile, amount: number): LevelUp[] {
  const before = levelInfo(p.xp).level;
  p.xp += Math.max(0, Math.round(amount));
  const after = levelInfo(p.xp).level;
  const ups: LevelUp[] = [];
  for (let L = before + 1; L <= after; L++) {
    const chest: ChestTier = L % 10 === 0 ? 'magic' : L % 5 === 0 ? 'gold' : 'silver';
    const gems = 10 + Math.floor(L / 5) * 5;
    p.gems += gems;
    p.chests.push({ id: newId(p, 'c'), tier: chest, source: `Level ${L}`, at: Date.now() });
    ups.push({ level: L, chest, gems });
  }
  return ups;
}

export function grantReward(p: Profile, r: RewardSpec, source: string): Granted[] {
  switch (r.type) {
    case 'coins':
      p.coins += r.amount;
      return [{ kind: 'coins', amount: r.amount }];
    case 'gems':
      p.gems += r.amount;
      return [{ kind: 'gems', amount: r.amount }];
    case 'tokens':
      p.pass.tokens += r.amount;
      return [{ kind: 'tokens', amount: r.amount }];
    case 'chest': {
      const id = newId(p, 'c');
      p.chests.push({ id, tier: r.tier, source, at: Date.now() });
      return [{ kind: 'chest', tier: r.tier, chestId: id }];
    }
    case 'tower':
      return [grantCards(p, r.tower, p.cards[r.tower] ? 5 : 1)];
    case 'cards':
      return [grantCards(p, r.tower, r.copies)];
    case 'troop':
      return [grantTroop(p, r.troop)];
    case 'icon': {
      const isNew = !p.icons.includes(r.icon);
      if (isNew) p.icons.push(r.icon);
      return [{ kind: 'icon', id: r.icon, isNew }];
    }
    case 'emote': {
      const isNew = !p.emotes.includes(r.emote);
      if (isNew) p.emotes.push(r.emote);
      return [{ kind: 'emote', id: r.emote, isNew }];
    }
    case 'arena':
      p.arenaReached = Math.max(p.arenaReached, r.arena);
      return [{ kind: 'arena', arena: r.arena }];
  }
}

// ── cards & loadout ────────────────────────────────────────────────────────
export function upgradeCost(type: TowerType, level: number): { copies: number; coins: number; xp: number } | null {
  if (level >= MAX_CARD_LEVEL) return null;
  return { copies: COPIES_PER_LEVEL[TOWER_RARITY[type]][level - 1], coins: COINS_PER_LEVEL[level - 1], xp: UPGRADE_XP[level - 1] };
}

export function upgradeCard(p: Profile, type: unknown): Res<{ level: number; xp: number; levelUps: LevelUp[] }> {
  if (typeof type !== 'string' || !(TOWER_TYPES as readonly string[]).includes(type)) return fail('Unknown card');
  const t = type as TowerType;
  const card = p.cards[t];
  if (!card) return fail('Card not unlocked');
  const cost = upgradeCost(t, card.level);
  if (!cost) return fail('Already max level');
  if (card.copies < cost.copies) return fail(`Need ${cost.copies} copies`);
  if (p.coins < cost.coins) return fail(`Need ${cost.coins} coins`);
  card.copies -= cost.copies;
  p.coins -= cost.coins;
  card.level++;
  const levelUps = grantXp(p, cost.xp);
  return { ok: true, level: card.level, xp: cost.xp, levelUps };
}

export function canUpgrade(p: Profile, t: TowerType): boolean {
  const card = p.cards[t];
  if (!card) return false;
  const cost = upgradeCost(t, card.level);
  return !!cost && card.copies >= cost.copies && p.coins >= cost.coins;
}

export function loadoutError(p: Profile, towers: unknown, troops: unknown): string | null {
  if (!Array.isArray(towers) || !Array.isArray(troops)) return 'Bad loadout';
  if (towers.length < 1 || towers.length > MAX_LOADOUT_TOWERS) return `Pick 1–${MAX_LOADOUT_TOWERS} towers`;
  if (troops.length > MAX_ARMY) return `Pick at most ${MAX_ARMY} troops`;
  if (new Set(towers).size !== towers.length || new Set(troops).size !== troops.length) return 'Duplicate cards in loadout';
  for (const t of towers) {
    if (!(TOWER_TYPES as readonly string[]).includes(t)) return 'Unknown tower';
    if (!p.cards[t as TowerType]) return `${TOWERS[t as TowerType].name} is not unlocked`;
  }
  for (const t of troops) {
    if (!(PACK_IDS as readonly string[]).includes(t)) return 'Unknown troop';
    if (!p.troops.includes(t as PackId)) return 'That troop is not unlocked';
  }
  return null;
}

export function setLoadout(p: Profile, towers: unknown, troops: unknown): Res {
  const err = loadoutError(p, towers, troops);
  if (err) return fail(err);
  p.loadout = (towers as TowerType[]).slice();
  p.army = (troops as PackId[]).slice();
  return { ok: true };
}

/** Card levels for a match seat (equalLevels → everything at `equalLevel`). */
export function seatCardLevels(p: Profile, equalLevel: number | null): Partial<Record<TowerType, number>> {
  const out: Partial<Record<TowerType, number>> = {};
  for (const t of TOWER_TYPES) {
    const c = p.cards[t];
    if (c) out[t] = equalLevel ?? c.level;
  }
  return out;
}

// ── reward drops ───────────────────────────────────────────────────────────
export interface DropResult {
  steps: DropRarity[];
  rarity: DropRarity;
  granted: Granted[];
}

/** Roll the rarity climb (common → rare → epic → mythic → legendary). */
export function rollDropRarity(rng: () => number): DropRarity[] {
  const steps: DropRarity[] = ['common'];
  for (let i = 0; i < DROP_UPGRADE_CHANCE.length; i++) {
    if (rng() < DROP_UPGRADE_CHANCE[i]) steps.push(DROP_RARITIES[i + 1]);
    else break;
  }
  return steps;
}

function randomTowerOfRarity(p: Profile, rng: () => number, rarity: Rarity): TowerType | null {
  const pool = towerPool(currentArena(p)).filter((t) => TOWER_RARITY[t] === rarity);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

function lockedUnlockables(p: Profile): RewardSpec[] {
  const arena = currentArena(p);
  const towers = towerPool(arena).filter((t) => !p.cards[t]);
  const troops = troopPool(arena).filter((t) => !p.troops.includes(t));
  return [...towers.map((tower) => ({ type: 'tower' as const, tower })), ...troops.map((troop) => ({ type: 'troop' as const, troop }))];
}

function randomCosmetic(p: Profile, rng: () => number): RewardSpec | null {
  const icons = ICONS.filter((i) => !p.icons.includes(i.id)).map((i) => ({ type: 'icon' as const, icon: i.id }));
  const emotes = EMOTES.filter((e) => !p.emotes.includes(e.id)).map((e) => ({ type: 'emote' as const, emote: e.id }));
  const all: RewardSpec[] = [...icons, ...emotes];
  return all.length ? all[Math.floor(rng() * all.length)] : null;
}

export function rollDropReward(p: Profile, rng: () => number, rarity: DropRarity): Granted[] {
  const spec = pickWeighted(rng, DROP_TABLE[rarity]);
  const fallbackCoins = (mult: number): Granted[] => grantReward(p, { type: 'coins', amount: Math.round(100 * mult) }, 'drop');
  const mult = DROP_RARITIES.indexOf(rarity) + 1;
  switch (spec.kind) {
    case 'coins':
      return grantReward(p, { type: 'coins', amount: randInt(rng, spec.min, spec.max) }, 'drop');
    case 'gems':
      return grantReward(p, { type: 'gems', amount: randInt(rng, spec.min, spec.max) }, 'drop');
    case 'cards': {
      const t = randomTowerOfRarity(p, rng, spec.rarity) ?? randomTowerOfRarity(p, rng, 'common');
      if (!t) return fallbackCoins(mult);
      return [grantCards(p, t, randInt(rng, spec.min, spec.max))];
    }
    case 'unlock': {
      const opts = lockedUnlockables(p);
      if (!opts.length) {
        const t = randomTowerOfRarity(p, rng, rarity === 'legendary' ? 'epic' : 'rare');
        return t ? [grantCards(p, t, rarity === 'legendary' ? 6 : 3)] : fallbackCoins(mult * 3);
      }
      return grantReward(p, opts[Math.floor(rng() * opts.length)], 'drop');
    }
    case 'cosmetic': {
      const c = randomCosmetic(p, rng);
      return c ? grantReward(p, c, 'drop') : fallbackCoins(mult * 2);
    }
  }
}

export function openDrop(p: Profile, userId: string, dropId: unknown): Res<DropResult> {
  const idx = p.drops.pending.findIndex((d) => d.id === dropId);
  if (idx < 0) return fail('Drop not found');
  p.drops.pending.splice(idx, 1);
  const rng = profileRng(userId, p, 'drop');
  const steps = rollDropRarity(rng);
  const rarity = steps[steps.length - 1];
  const granted = rollDropReward(p, rng, rarity);
  return { ok: true, steps, rarity, granted };
}

// ── chests ─────────────────────────────────────────────────────────────────
export interface ChestResult {
  tier: ChestTier;
  granted: Granted[];
}

export function rollChest(p: Profile, rng: () => number, tier: ChestTier): Granted[] {
  const def = CHESTS[tier];
  const out: Granted[] = [];
  const pool = towerPool(currentArena(p));
  const byRarity = (r: Rarity) => pool.filter((t) => TOWER_RARITY[t] === r);
  const used = new Set<TowerType>();
  const pickFrom = (r: Rarity): TowerType | null => {
    const opts = byRarity(r).filter((t) => !used.has(t));
    if (!opts.length) return null;
    const t = opts[Math.floor(rng() * opts.length)];
    used.add(t);
    return t;
  };
  const stacks: { t: TowerType; r: Rarity }[] = [];
  // guaranteed stack: the best rarity available up to the chest's guarantee
  for (let gi = RARITIES.indexOf(def.guarantee); gi >= 0 && stacks.length === 0; gi--) {
    const t = pickFrom(RARITIES[gi]);
    if (t) stacks.push({ t, r: RARITIES[gi] });
  }
  for (let i = stacks.length; i < def.stacks; i++) {
    const roll = rng();
    const want: Rarity = roll < 0.6 ? 'common' : roll < 0.88 ? 'rare' : roll < 0.98 ? 'epic' : 'legendary';
    let picked: TowerType | null = null;
    for (let ri = RARITIES.indexOf(want); ri >= 0 && !picked; ri--) {
      picked = pickFrom(RARITIES[ri]);
      if (picked) stacks.push({ t: picked, r: RARITIES[ri] });
    }
    if (!picked) break;
  }
  const per = def.copies / def.stacks;
  for (const s of stacks) {
    const copies = Math.max(1, Math.round((per / CHEST_RARITY_DIVISOR[s.r]) * (0.7 + rng() * 0.6)));
    out.push(grantCards(p, s.t, copies));
  }
  const coins = randInt(rng, def.coins[0], def.coins[1]);
  p.coins += coins;
  out.unshift({ kind: 'coins', amount: coins });
  const gems = def.gems[1] > 0 ? randInt(rng, def.gems[0], def.gems[1]) : 0;
  if (gems > 0) {
    p.gems += gems;
    out.push({ kind: 'gems', amount: gems });
  }
  return out;
}

export function openChest(p: Profile, userId: string, chestId: unknown): Res<ChestResult> {
  const idx = p.chests.findIndex((c) => c.id === chestId);
  if (idx < 0) return fail('Chest not found');
  const [chest] = p.chests.splice(idx, 1);
  const rng = profileRng(userId, p, 'chest');
  return { ok: true, tier: chest.tier, granted: rollChest(p, rng, chest.tier) };
}

// ── trophy road ────────────────────────────────────────────────────────────
export function claimableRoad(p: Profile): number[] {
  const prog = roadProgress(p);
  return TROPHY_ROAD.filter((n) => n.trophies <= prog && !p.roadClaimed.includes(n.id)).map((n) => n.id);
}

export function claimRoad(p: Profile, nodeId: unknown): Res<{ granted: Granted[] }> {
  const node = TROPHY_ROAD.find((n) => n.id === nodeId);
  if (!node) return fail('Unknown reward');
  if (p.roadClaimed.includes(node.id)) return fail('Already claimed');
  if (roadProgress(p) < node.trophies) return fail(`Reach ${node.trophies} trophies first`);
  p.roadClaimed.push(node.id);
  const granted = node.rewards.flatMap((r) => grantReward(p, r, 'Trophy Road'));
  return { ok: true, granted };
}

// ── season pass ────────────────────────────────────────────────────────────
export function passTier(tokens: number): number {
  return Math.min(SEASON.passTiers, Math.floor(tokens / SEASON.tokensPerTier));
}

export function claimablePass(p: Profile): { free: number[]; premium: number[] } {
  const tier = passTier(p.pass.tokens);
  const free: number[] = [];
  const premium: number[] = [];
  for (let t = 1; t <= tier; t++) {
    if (!p.pass.claimedFree.includes(t)) free.push(t);
    if (p.pass.premium && !p.pass.claimedPremium.includes(t)) premium.push(t);
  }
  return { free, premium };
}

export function claimPass(p: Profile, tier: unknown, track: unknown): Res<{ granted: Granted[] }> {
  if (typeof tier !== 'number' || tier < 1 || tier > SEASON.passTiers || !Number.isInteger(tier)) return fail('Unknown tier');
  if (track !== 'free' && track !== 'premium') return fail('Unknown track');
  if (passTier(p.pass.tokens) < tier) return fail('Tier not reached yet');
  if (track === 'premium' && !p.pass.premium) return fail('Unlock the premium track first');
  const list = track === 'free' ? p.pass.claimedFree : p.pass.claimedPremium;
  if (list.includes(tier)) return fail('Already claimed');
  list.push(tier);
  const reward = track === 'free' ? passFreeReward(tier) : passPremiumReward(tier);
  return { ok: true, granted: grantReward(p, reward, 'Tower Pass') };
}

export function buyPremiumPass(p: Profile): Res {
  if (p.pass.premium) return fail('Already unlocked');
  if (p.gems < SEASON.premiumGemCost) return fail(`Need ${SEASON.premiumGemCost} gems`);
  p.gems -= SEASON.premiumGemCost;
  p.pass.premium = true;
  return { ok: true };
}

// ── shop ───────────────────────────────────────────────────────────────────
export function generateOffers(p: Profile, rng: () => number): ShopOffer[] {
  const offers: ShopOffer[] = [];
  const pool = towerPool(currentArena(p));
  const shuffled = pool.slice().sort(() => rng() - 0.5);
  for (const t of shuffled.slice(0, SHOP.dailyOffers - 2)) {
    const r = TOWER_RARITY[t];
    const copies = SHOP.copiesPerOffer[r];
    offers.push({ id: `o${offers.length}`, kind: 'card', tower: t, copies, price: copies * SHOP.copyPrice[r], currency: 'coins', bought: false });
  }
  const chest = SHOP.chestOffers[Math.floor(rng() * SHOP.chestOffers.length)];
  offers.push({ id: `o${offers.length}`, kind: 'chest', tier: chest.tier, price: chest.gems, currency: 'gems', bought: false });
  const cos = randomCosmetic(p, rng);
  if (cos && (cos.type === 'icon' || cos.type === 'emote')) {
    offers.push({
      id: `o${offers.length}`,
      kind: 'cosmetic',
      cosmetic: cos.type === 'icon' ? { type: 'icon', id: cos.icon } : { type: 'emote', id: cos.emote },
      price: SHOP.cosmeticGemPrice,
      currency: 'gems',
      bought: false,
    });
  }
  while (offers.length < SHOP.dailyOffers) {
    const c2 = SHOP.chestOffers[Math.floor(rng() * SHOP.chestOffers.length)];
    offers.push({ id: `o${offers.length}`, kind: 'chest', tier: c2.tier, price: c2.gems, currency: 'gems', bought: false });
  }
  return offers;
}

export function buyOffer(p: Profile, offerId: unknown): Res<{ granted: Granted[] }> {
  const o = p.shop.offers.find((x) => x.id === offerId);
  if (!o) return fail('Offer not found');
  if (o.bought) return fail('Already bought today');
  const wallet = o.currency === 'coins' ? p.coins : p.gems;
  if (wallet < o.price) return fail(`Not enough ${o.currency}`);
  if (o.currency === 'coins') p.coins -= o.price;
  else p.gems -= o.price;
  o.bought = true;
  let granted: Granted[] = [];
  if (o.kind === 'card' && o.tower) granted = [grantCards(p, o.tower, o.copies ?? 1)];
  else if (o.kind === 'chest' && o.tier) granted = grantReward(p, { type: 'chest', tier: o.tier }, 'Shop');
  else if (o.kind === 'cosmetic' && o.cosmetic)
    granted = grantReward(p, o.cosmetic.type === 'icon' ? { type: 'icon', icon: o.cosmetic.id } : { type: 'emote', emote: o.cosmetic.id }, 'Shop');
  return { ok: true, granted };
}

export function claimGift(p: Profile): Res<{ granted: Granted[] }> {
  if (p.shop.giftClaimed) return fail('Come back tomorrow!');
  p.shop.giftClaimed = true;
  return { ok: true, granted: grantReward(p, { type: 'coins', amount: SHOP.freeGift.coins }, 'Daily gift') };
}

export function buyBundle(p: Profile, bundleId: unknown): Res<{ granted: Granted[] }> {
  const b = SHOP.bundles.find((x) => x.id === bundleId);
  if (!b) return fail('Unknown bundle');
  if (p.gems < b.gems) return fail('Not enough gems');
  p.gems -= b.gems;
  return { ok: true, granted: grantReward(p, { type: 'coins', amount: b.coins }, 'Bundle') };
}

// ── campaign ───────────────────────────────────────────────────────────────
export function mapUnlocked(p: Profile, mapId: MapId): boolean {
  const i = CAMPAIGN_ORDER.indexOf(mapId);
  if (i <= 0) return true;
  return (p.campaign[CAMPAIGN_ORDER[i - 1]] ?? 0) >= STARS_TO_UNLOCK_NEXT;
}

export function endlessUnlocked(p: Profile): boolean {
  return Object.values(p.campaign).some((s) => (s ?? 0) >= 2);
}

export function totalStars(p: Profile): number {
  return Object.values(p.campaign).reduce<number>((a, b) => a + (b ?? 0), 0);
}

export function arenaUnlockedTowers(arena: number): TowerType[] {
  return ARENAS.filter((a) => a.index <= arena).flatMap((a) => a.towers);
}

export function xpBar(p: Profile): { level: number; into: number; need: number } {
  const li = levelInfo(p.xp);
  return { ...li, need: li.need || xpToNext(li.level) };
}
