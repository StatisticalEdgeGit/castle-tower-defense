// Collection: loadout editor (6 tower + 5 troop slots, click or drag to swap), tower cards
// with rarity frames / levels / copies, troop cards, profile icons and emotes.
import { useEffect, useState, type CSSProperties } from 'react';
import { SEND_PACKS, TOWERS } from '../../../shared/config';
import type { ProfileView } from '../../../shared/progProtocol';
import {
  ARENAS,
  COINS_PER_LEVEL,
  EMOTES,
  ICONS,
  levelStatMult,
  MAX_ARMY,
  MAX_CARD_LEVEL,
  MAX_LOADOUT_TOWERS,
  RARITY_COLOR,
  RARITY_LABEL,
  TOTEM_LEVEL_BONUS,
  TOWER_RARITY,
  towerArena,
} from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import { PACK_IDS, TOWER_TYPES, type PackId, type TowerType } from '../../../shared/types';
import { toast, useStore } from '../../store';
import { Modal, TowerIcon } from '../components';
import { celebrateLevelUps, progAct } from './actions';
import { Burst, emoteDef, ProfileIcon, TowerCard, TroopCard, TroopIcon } from './bits';

function place<T>(list: T[], item: T, slot: number, max: number): T[] {
  const out = list.slice();
  const from = out.indexOf(item);
  if (slot >= out.length) {
    if (from >= 0) return out; // already in deck
    if (out.length >= max) return out;
    out.push(item);
    return out;
  }
  const displaced = out[slot];
  out[slot] = item;
  if (from >= 0 && from !== slot) out[from] = displaced;
  return out;
}

function CardDetail({ type, p, onClose, onDeck }: { type: TowerType; p: ProfileView; onClose: () => void; onDeck: () => void }) {
  const card = p.cards[type];
  const def = TOWERS[type];
  const [k, setK] = useState(0);
  const rarity = TOWER_RARITY[type];
  const level = card?.level ?? 1;
  const next = Math.min(MAX_CARD_LEVEL, level + 1);
  const lv1 = def.levels[0];
  const support = def.support;
  const row = (label: string, cur: string | number, nxt: string | number) => (
    <tr>
      <td>{label}</td>
      <td>{cur}</td>
      <td className="up">{card && card.need !== null && nxt !== cur ? `→ ${nxt}` : ''}</td>
    </tr>
  );
  const dmg = (L: number) => Math.round(lv1.damage * levelStatMult(L) * 10) / 10;
  const upgrade = async () => {
    const r = await progAct<{ level: number; levelUps: never[] }>(EV.progUpgradeCard, { tower: type });
    if (r.ok) {
      setK((x) => x + 1);
      toast('success', `${def.name} is now level ${r.level}!`);
      celebrateLevelUps(r.levelUps);
    }
  };
  return (
    <Modal onClose={onClose}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative' }}>
          <div className="tcard" style={{ '--rc': RARITY_COLOR[rarity], width: 130, cursor: 'default' } as CSSProperties}>
            {card && <span className="lv">Lv {card.level}</span>}
            <div className="rar">{RARITY_LABEL[rarity]}</div>
            <TowerIcon type={type} size={84} />
          </div>
          <Burst k={k} n={k ? 24 : 0} color={RARITY_COLOR[rarity]} />
        </div>
        <div className="grow">
          <h3>{def.name}</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            {def.blurb}
          </p>
          {!card && <div className="callout">🔒 Unlocks at {ARENAS[towerArena(type)].name} (Trophy Road, drops and chests).</div>}
        </div>
      </div>
      <table className="stat-table" style={{ marginTop: 10 }}>
        <tbody>
          {row('Structure HP', def.structureHp, def.structureHp)}
          {support ? (
            <>
              {row('Damage buff', `+${Math.round(((lv1.buffDmg ?? 0) + TOTEM_LEVEL_BONUS * (level - 1)) * 100)}%`, `+${Math.round(((lv1.buffDmg ?? 0) + TOTEM_LEVEL_BONUS * (next - 1)) * 100)}%`)}
              {row('Fire-rate buff', `+${Math.round(((lv1.buffRate ?? 0) + TOTEM_LEVEL_BONUS * (level - 1)) * 100)}%`, `+${Math.round(((lv1.buffRate ?? 0) + TOTEM_LEVEL_BONUS * (next - 1)) * 100)}%`)}
              {row('Radius', lv1.buffRadius ?? 0, lv1.buffRadius ?? 0)}
            </>
          ) : type === 'mine' ? (
            row('Income / wave', `$${Math.round((lv1.income ?? 0) * levelStatMult(level))}`, `$${Math.round((lv1.income ?? 0) * levelStatMult(next))}`)
          ) : def.builder ? (
            <>
              {row('Repair rate', `${Math.round((lv1.repairRate ?? 0) * levelStatMult(level))} HP/s`, `${Math.round((lv1.repairRate ?? 0) * levelStatMult(next))} HP/s`)}
              {row('Worker speed', lv1.builderSpeed ?? 0, lv1.builderSpeed ?? 0)}
            </>
          ) : (
            <>
              {row('Damage', dmg(level), dmg(next))}
              {row('Targets', def.targetsAir ? 'Ground + air' : 'Ground only', def.targetsAir ? 'Ground + air' : 'Ground only')}
              {def.targetsAir && row('Air damage', `${Math.round((def.airDamageMult ?? 1) * 100)}%`, `${Math.round((def.airDamageMult ?? 1) * 100)}%`)}
              {row('DPS', Math.round(dmg(level) * lv1.rate), Math.round(dmg(next) * lv1.rate))}
              {row('Range', lv1.range, lv1.range)}
            </>
          )}
          {row('Build cost', `$${lv1.cost}`, `$${lv1.cost}`)}
          {row('Card bonus', `+${Math.round((levelStatMult(level) - 1) * 100)}%`, `+${Math.round((levelStatMult(next) - 1) * 100)}%`)}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 4 }}>
        Stats for a freshly built tower (in-match level 1). Each card level adds +5%{support ? ' (War Totem: +1% to both buffs)' : ''}.
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        {card && (
          <button className="btn" onClick={onDeck}>
            {p.loadout.includes(type) ? 'In your deck ✓' : 'Add to deck'}
          </button>
        )}
        {card && card.need !== null && (
          <button className={`btn ${card.canUpgrade ? 'btn-green' : ''}`} disabled={!card.canUpgrade} onClick={() => void upgrade()}>
            Upgrade · {card.copies}/{card.need} cards · 🪙 {COINS_PER_LEVEL[card.level - 1]}
          </button>
        )}
        {card && card.need === null && <span className="badge gold">MAX LEVEL</span>}
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function CollectionTab() {
  const p = useStore((s) => s.profile)!;
  const [towers, setTowers] = useState<TowerType[]>(p.loadout);
  const [troops, setTroops] = useState<PackId[]>(p.army);
  const [armed, setArmed] = useState<{ kind: 'tower' | 'troop'; slot: number } | null>(null);
  const [picked, setPicked] = useState<{ kind: 'tower'; id: TowerType } | { kind: 'troop'; id: PackId } | null>(null);
  const [detail, setDetail] = useState<TowerType | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => setTowers(p.loadout), [p.loadout]);
  useEffect(() => setTroops(p.army), [p.army]);

  const save = async (t: TowerType[], tr: PackId[]) => {
    setTowers(t);
    setTroops(tr);
    const r = await progAct(EV.progSetLoadout, { towers: t, troops: tr });
    if (!r.ok) {
      setTowers(p.loadout);
      setTroops(p.army);
    }
  };
  const putTower = (id: TowerType, slot: number) => {
    if (!p.cards[id]) return;
    void save(place(towers, id, slot, MAX_LOADOUT_TOWERS), troops);
  };
  const putTroop = (id: PackId, slot: number) => {
    if (!p.troops.includes(id)) return;
    void save(towers, place(troops, id, slot, MAX_ARMY));
  };
  const clickTowerCard = (t: TowerType) => {
    if (armed?.kind === 'tower' && p.cards[t]) {
      putTower(t, armed.slot);
      setArmed(null);
      return;
    }
    if (picked?.kind === 'tower' && picked.id === t) {
      setPicked(null);
      setDetail(t);
      return;
    }
    if (p.cards[t]) setPicked({ kind: 'tower', id: t });
    else setDetail(t);
  };
  const clickTroopCard = (t: PackId) => {
    if (armed?.kind === 'troop' && p.troops.includes(t)) {
      putTroop(t, armed.slot);
      setArmed(null);
      return;
    }
    if (p.troops.includes(t)) setPicked(picked?.kind === 'troop' && picked.id === t ? null : { kind: 'troop', id: t });
  };
  const clickSlot = (kind: 'tower' | 'troop', slot: number) => {
    if (picked && picked.kind === kind) {
      if (kind === 'tower') putTower(picked.id as TowerType, slot);
      else putTroop(picked.id as PackId, slot);
      setPicked(null);
      return;
    }
    setArmed(armed && armed.kind === kind && armed.slot === slot ? null : { kind, slot });
  };
  const slotDrop = (kind: 'tower' | 'troop', slot: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setHover(null);
    const t = e.dataTransfer.getData('text/tower');
    const tr = e.dataTransfer.getData('text/troop');
    if (kind === 'tower' && t) putTower(t as TowerType, slot);
    if (kind === 'troop' && tr) putTroop(tr as PackId, slot);
  };

  const owned = TOWER_TYPES.filter((t) => p.cards[t]).length;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel">
        <div className="panel-title">
          🛡️ Battle deck <span className="count">brought into every match</span>
          <span className="spacer" />
          <span className="hint">{picked ? 'Now click a slot to put it there' : armed ? 'Now click a card for this slot' : 'Click a card then a slot (or drag & drop)'}</span>
        </div>
        <div className="section-label" style={{ marginTop: 0 }}>
          Towers ({towers.length}/{MAX_LOADOUT_TOWERS}) — hotkeys 1–6 in this order
        </div>
        <div className="deck">
          {Array.from({ length: MAX_LOADOUT_TOWERS }, (_, i) => {
            const t = towers[i];
            const key = `t${i}`;
            return (
              <div
                key={key}
                className={`deck-slot ${t ? 'filled' : ''} ${hover === key || (armed?.kind === 'tower' && armed.slot === i) ? 'armed' : ''}`}
                style={t ? ({ '--rc': RARITY_COLOR[TOWER_RARITY[t]] } as CSSProperties) : undefined}
                onClick={() => clickSlot('tower', i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHover(key);
                }}
                onDragLeave={() => setHover(null)}
                onDrop={slotDrop('tower', i)}
                draggable={!!t}
                onDragStart={(e) => t && e.dataTransfer.setData('text/tower', t)}
              >
                <span className="key">{i + 1}</span>
                {t ? (
                  <div className="col" style={{ alignItems: 'center', gap: 2 }}>
                    <TowerIcon type={t} size={48} />
                    <b style={{ fontSize: 12 }}>{TOWERS[t].name}</b>
                    <span className="lock-note">Lv {p.cards[t]?.level}</span>
                    {towers.length > 1 && (
                      <span
                        className="x"
                        onClick={(e) => {
                          e.stopPropagation();
                          void save(
                            towers.filter((x) => x !== t),
                            troops,
                          );
                        }}
                      >
                        ✕
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="dim">empty</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="section-label">Army — troop packs you can send ({troops.length}/{MAX_ARMY})</div>
        <div className="deck">
          {Array.from({ length: MAX_ARMY }, (_, i) => {
            const t = troops[i];
            const key = `a${i}`;
            return (
              <div
                key={key}
                className={`deck-slot ${t ? 'filled' : ''} ${hover === key || (armed?.kind === 'troop' && armed.slot === i) ? 'armed' : ''}`}
                style={t ? ({ '--rc': '#ff7a3c' } as CSSProperties) : undefined}
                onClick={() => clickSlot('troop', i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHover(key);
                }}
                onDragLeave={() => setHover(null)}
                onDrop={slotDrop('troop', i)}
              >
                {t ? (
                  <div className="col" style={{ alignItems: 'center', gap: 4 }}>
                    <TroopIcon pack={t} size={20} />
                    <b style={{ fontSize: 11 }}>{SEND_PACKS[t].name}</b>
                    <span
                      className="x"
                      onClick={(e) => {
                        e.stopPropagation();
                        void save(
                          towers,
                          troops.filter((x) => x !== t),
                        );
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ) : (
                  <span className="dim">empty</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          🃏 Tower cards <span className="count">{owned}/{TOWER_TYPES.length} found</span>
        </div>
        <div className="card-grid" style={{ paddingTop: 10 }}>
          {TOWER_TYPES.map((t) => (
            <TowerCard key={t} type={t} card={p.cards[t]} inDeck={towers.includes(t)} selected={picked?.kind === 'tower' && picked.id === t} onClick={() => clickTowerCard(t)} draggable />
          ))}
        </div>
        <div className="hint" style={{ marginTop: 14 }}>
          Click a card twice (or once if locked) for details and upgrades. Card levels apply in ranked; friendly lobbies can switch on “Equal levels”.
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          🪖 Troop cards <span className="count">no levels — they only unlock</span>
        </div>
        <div className="card-grid" style={{ paddingTop: 10 }}>
          {PACK_IDS.map((t) => (
            <TroopCard key={t} pack={t} owned={p.troops.includes(t)} inDeck={troops.includes(t)} selected={picked?.kind === 'troop' && picked.id === t} onClick={() => clickTroopCard(t)} />
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="panel grow" style={{ minWidth: 320 }}>
          <div className="panel-title">🖼️ Profile icon</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {ICONS.map((i) => {
              const have = p.icons.includes(i.id);
              return (
                <div
                  key={i.id}
                  style={{ cursor: have ? 'pointer' : 'default', opacity: have ? 1 : 0.3, outline: p.icon === i.id ? '3px solid var(--gold)' : 'none', borderRadius: 12 }}
                  title={have ? i.name : `${i.name} (locked)`}
                  onClick={() => have && p.icon !== i.id && void progAct(EV.progSetIcon, { icon: i.id })}
                >
                  <ProfileIcon icon={i.id} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel grow" style={{ minWidth: 320 }}>
          <div className="panel-title">
            😀 Emotes <span className="count">press E in a match</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {EMOTES.map((e) => {
              const have = p.emotes.includes(e.id);
              return (
                <span key={e.id} className="reward-pill" style={{ opacity: have ? 1 : 0.3 }} title={have ? 'Owned' : 'Locked — find it in drops, the shop or the pass'}>
                  <span style={{ fontSize: 18 }}>{emoteDef(e.id).emoji}</span> {e.text}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {detail && (
        <CardDetail
          type={detail}
          p={p}
          onClose={() => setDetail(null)}
          onDeck={() => {
            if (!towers.includes(detail)) putTower(detail, towers.length < MAX_LOADOUT_TOWERS ? towers.length : MAX_LOADOUT_TOWERS - 1);
          }}
        />
      )}
    </div>
  );
}
