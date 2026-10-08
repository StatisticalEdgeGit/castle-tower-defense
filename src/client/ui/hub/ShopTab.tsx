// Shop: free daily gift, 6 daily offers (refresh at local midnight), gem → coin bundles.
// Gems are earned in-game only — no real-money purchases exist anywhere.
import type { CSSProperties } from 'react';
import { TOWERS } from '../../../shared/config';
import { CHESTS, RARITY_COLOR, SHOP, TOWER_RARITY } from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import { useStore } from '../../store';
import { TowerIcon, useNow } from '../components';
import { claimWithReveal } from './actions';
import { ChestArt, emoteDef, fmtDuration, iconDef, untilMidnight } from './bits';

export function ShopTab() {
  const p = useStore((s) => s.profile)!;
  const now = useNow(15_000);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <h2>🛒 Shop</h2>
        <span className="spacer" />
        <span className="badge">🔄 Refreshes in {fmtDuration(untilMidnight(now))}</span>
      </div>
      <div className="gift-card">
        <div style={{ fontSize: 48 }}>🎁</div>
        <div className="grow">
          <h3>Free daily gift</h3>
          <div className="muted">🪙 {SHOP.freeGift.coins} coins, every day.</div>
        </div>
        <button className="btn btn-green btn-lg" disabled={p.shop.giftClaimed} onClick={() => void claimWithReveal(EV.progClaimGift, undefined, 'Daily gift')}>
          {p.shop.giftClaimed ? 'Claimed — back tomorrow' : 'Claim!'}
        </button>
      </div>
      <div className="panel">
        <div className="panel-title">⭐ Daily offers</div>
        <div className="shop-grid2">
          {p.shop.offers.map((o) => {
            const wallet = o.currency === 'coins' ? p.coins : p.gems;
            const rc = o.tower ? RARITY_COLOR[TOWER_RARITY[o.tower]] : o.tier ? CHESTS[o.tier].color : '#3fd27f';
            return (
              <div key={o.id} className={`offer ${o.bought ? 'sold' : ''}`} style={{ '--rc': rc } as CSSProperties}>
                {o.kind === 'card' && o.tower && (
                  <>
                    <TowerIcon type={o.tower} size={64} />
                    <b>{TOWERS[o.tower].name}</b>
                    <span className="qty">×{o.copies}</span>
                    {!p.cards[o.tower] && <span className="badge gold">NEW card!</span>}
                  </>
                )}
                {o.kind === 'chest' && o.tier && (
                  <>
                    <ChestArt tier={o.tier} />
                    <b>{CHESTS[o.tier].name}</b>
                  </>
                )}
                {o.kind === 'cosmetic' && o.cosmetic && (
                  <>
                    <div style={{ fontSize: 50 }}>{o.cosmetic.type === 'icon' ? iconDef(o.cosmetic.id).emoji : emoteDef(o.cosmetic.id).emoji}</div>
                    <b>{o.cosmetic.type === 'icon' ? `${iconDef(o.cosmetic.id).name} icon` : `"${emoteDef(o.cosmetic.id).text}" emote`}</b>
                  </>
                )}
                <button
                  className={`btn ${o.currency === 'gems' ? '' : 'btn-primary'}`}
                  style={o.currency === 'gems' ? { borderColor: 'var(--gem)', color: '#f3c2ff' } : undefined}
                  disabled={o.bought || wallet < o.price}
                  onClick={() => void claimWithReveal(EV.progShopBuy, { offerId: o.id }, 'Purchased!')}
                >
                  {o.bought ? 'SOLD' : `${o.currency === 'coins' ? '🪙' : '💎'} ${o.price.toLocaleString()}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">💎 → 🪙 Gem exchange</div>
        <div className="shop-grid2">
          {SHOP.bundles.map((b) => (
            <div key={b.id} className="offer" style={{ '--rc': '#ffc247' } as CSSProperties}>
              <div style={{ fontSize: 44 }}>🪙</div>
              <span className="qty">{b.coins.toLocaleString()} coins</span>
              <button className="btn" style={{ borderColor: 'var(--gem)', color: '#f3c2ff' }} disabled={p.gems < b.gems} onClick={() => void claimWithReveal(EV.progBuyBundle, { bundleId: b.id }, 'Exchanged!')}>
                💎 {b.gems}
              </button>
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Gems come from Trophy Road, drops, chests, level-ups, first clears and season rewards. There is no way to buy them with real money.
        </div>
      </div>
    </div>
  );
}
