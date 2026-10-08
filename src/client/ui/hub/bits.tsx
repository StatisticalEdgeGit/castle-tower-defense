// Small shared pieces for the progression hub: icons, currency chips, cards, count-ups,
// confetti and particle bursts.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SEND_PACKS, TOWERS } from '../../../shared/config';
import type { CardView, Granted } from '../../../shared/progProtocol';
import {
  ARENAS,
  CHESTS,
  EMOTES,
  ICONS,
  RARITY_COLOR,
  RARITY_LABEL,
  TOWER_RARITY,
  towerArena,
  troopArena,
  type ChestTier,
  type RewardSpec,
} from '../../../shared/progression';
import type { PackId, TowerType } from '../../../shared/types';
import { EnemyIcon, TowerIcon } from '../components';

export function iconDef(id: string) {
  return ICONS.find((i) => i.id === id) ?? ICONS[0];
}
export function emoteDef(id: string) {
  return EMOTES.find((e) => e.id === id) ?? EMOTES[0];
}

export function ProfileIcon({ icon, level, size = 'md' }: { icon: string; level?: number; size?: 'sm' | 'md' | 'lg' }) {
  const d = iconDef(icon);
  return (
    <div className={`picon ${size === 'md' ? '' : size}`} style={{ background: `radial-gradient(circle at 30% 25%, ${d.bg}, #0b1120 140%)` }} title={d.name}>
      {d.emoji}
      {level !== undefined && size !== 'sm' && <span className="lvl-badge">{level}</span>}
    </div>
  );
}

export function LevelInline({ level }: { level: number }) {
  return <span className="lvl-inline">{level}</span>;
}

export function ArenaBadge({ arena }: { arena: number }) {
  const a = ARENAS[Math.max(0, Math.min(ARENAS.length - 1, arena))];
  return (
    <span className="arena-badge" style={{ background: `linear-gradient(90deg, ${a.colors[0]}, ${a.colors[1]})` }} title={a.name}>
      {a.emoji} {a.name}
    </span>
  );
}

export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < n ? '' : 'off'}>
          ★
        </span>
      ))}
    </span>
  );
}

export function Coin() {
  return <span className="ic">🪙</span>;
}

/** Animated number that counts from its previous value to `value`. */
export function useCountUp(value: number, ms = 700, from?: number): number {
  const [shown, setShown] = useState(from ?? value);
  const prev = useRef(from ?? value);
  useEffect(() => {
    const start = prev.current;
    const delta = value - start;
    if (delta === 0) return;
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else prev.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      prev.current = value;
    };
  }, [value, ms]);
  return shown;
}

export function CountUp({ value, from, ms = 900, prefix = '' }: { value: number; from?: number; ms?: number; prefix?: string }) {
  const v = useCountUp(value, ms, from);
  return (
    <>
      {prefix}
      {v.toLocaleString()}
    </>
  );
}

export function CurrencyChip({ kind, value, sub }: { kind: 'coins' | 'gems' | 'trophy'; value: number; sub?: string }) {
  const v = useCountUp(value, 600);
  const [bump, setBump] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      setBump(true);
      const t = window.setTimeout(() => setBump(false), 450);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);
  const icon = kind === 'coins' ? '🪙' : kind === 'gems' ? '💎' : '🏆';
  return (
    <span className={`cur ${kind} ${bump ? 'bump' : ''}`} title={kind === 'trophy' ? `${sub} trophies` : kind}>
      <span className="ic">{icon}</span>
      {v.toLocaleString()}
      {sub && <span className="sub">{sub}</span>}
    </span>
  );
}

export function ProgressBar({ value, max, label, color }: { value: number; max: number; label?: string; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 100;
  return (
    <div className="tbar">
      <div style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
      {label && <span className="lbl">{label}</span>}
    </div>
  );
}

export function NavBadge({ n }: { n: number }) {
  if (!n) return null;
  return <span className="nav-badge">{n > 99 ? '99+' : n}</span>;
}

// ── confetti & bursts ──────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#ffd166', '#ff9f1c', '#4f8cff', '#3fd27f', '#ff5d5d', '#c25cff', '#45e0ff'];

export function Confetti({ n = 80 }: { n?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        d: 1.8 + Math.random() * 1.6,
        delay: Math.random() * 0.5,
        dx: (Math.random() - 0.5) * 200,
        rot: 360 + Math.random() * 720,
      })),
    [n],
  );
  return (
    <div className="confetti">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              '--d': `${p.d}s`,
              '--delay': `${p.delay}s`,
              '--dx': `${p.dx}px`,
              '--rot': `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Burst({ color = '#ffd166', n = 18, k }: { color?: string; n?: number; k: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2;
        const r = 70 + Math.random() * 90;
        return { bx: Math.cos(a) * r, by: Math.sin(a) * r };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, k],
  );
  return (
    <div className="burst" key={k}>
      {parts.map((p, i) => (
        <i key={i} style={{ '--bx': `${p.bx}px`, '--by': `${p.by}px`, '--bc': color } as CSSProperties} />
      ))}
    </div>
  );
}

export function ChestArt({ tier, open = false, lg = false }: { tier: ChestTier; open?: boolean; lg?: boolean }) {
  return (
    <div className={`chest-art ${open ? 'open' : ''} ${lg ? 'lg' : ''}`} style={{ '--cc': CHESTS[tier].color } as CSSProperties}>
      <div className="box" />
      <div className="lid" />
      <div className="lock" />
    </div>
  );
}

export function TroopIcon({ pack, size = 22 }: { pack: PackId; size?: number }) {
  const def = SEND_PACKS[pack];
  return (
    <span className="emo row" style={{ gap: 2 }}>
      {def.units.map((u) => (
        <EnemyIcon key={u.type} type={u.type} size={size} />
      ))}
    </span>
  );
}

// ── tower card ─────────────────────────────────────────────────────────────
export function TowerCard({
  type,
  card,
  selected,
  inDeck,
  onClick,
  draggable,
}: {
  type: TowerType;
  card: CardView | undefined;
  selected?: boolean;
  inDeck?: boolean;
  onClick?: () => void;
  draggable?: boolean;
}) {
  const rarity = TOWER_RARITY[type];
  const rc = RARITY_COLOR[rarity];
  const locked = !card;
  const style = { '--rc': rc } as CSSProperties;
  return (
    <div
      className={`tcard ${locked ? 'locked' : ''} ${card?.canUpgrade ? 'can-up' : ''} ${selected ? 'selected' : ''} ${inDeck ? 'in-deck' : ''}`}
      style={style}
      onClick={onClick}
      draggable={draggable && !locked}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/tower', type);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={locked ? `Unlocks at ${ARENAS[towerArena(type)].name}` : TOWERS[type].blurb}
    >
      {!locked && <span className="lv">Lv {card.level}</span>}
      <div className="rar">{RARITY_LABEL[rarity]}</div>
      <div style={{ display: 'grid', placeItems: 'center', margin: '4px 0' }}>
        <TowerIcon type={type} size={56} level={1} />
      </div>
      <div className="nm">{TOWERS[type].name}</div>
      {locked ? (
        <div className="lock-note">🔒 {ARENAS[towerArena(type)].name}</div>
      ) : card.need === null ? (
        <div className="cbar">
          <div style={{ width: '100%' }} />
          <span>MAX</span>
        </div>
      ) : (
        <div className="cbar">
          <div style={{ width: `${Math.min(100, (card.copies / card.need) * 100)}%` }} />
          <span>
            {card.copies}/{card.need}
          </span>
        </div>
      )}
      {card?.canUpgrade && <span className="upgrade-tag">Upgrade!</span>}
    </div>
  );
}

export function TroopCard({ pack, owned, selected, inDeck, onClick }: { pack: PackId; owned: boolean; selected?: boolean; inDeck?: boolean; onClick?: () => void }) {
  const def = SEND_PACKS[pack];
  return (
    <div
      className={`tcard troop-card ${owned ? '' : 'locked'} ${selected ? 'selected' : ''} ${inDeck ? 'in-deck' : ''}`}
      style={{ '--rc': owned ? '#ff7a3c' : '#2a3550' } as CSSProperties}
      onClick={onClick}
      draggable={owned}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/troop', pack);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={owned ? `${def.name}: $${def.cost}, +$${def.income} income` : `Unlocks at ${ARENAS[troopArena(pack)].name}`}
    >
      <div className="rar" style={{ color: '#ff9a6b' }}>
        Troop
      </div>
      <TroopIcon pack={pack} size={24} />
      <div className="nm" style={{ fontSize: 12 }}>
        {def.name}
      </div>
      {owned ? (
        <div className="lock-note" style={{ color: 'var(--gold)' }}>
          ${def.cost} · +{def.income}/wave
        </div>
      ) : (
        <div className="lock-note">🔒 {ARENAS[troopArena(pack)].name}</div>
      )}
    </div>
  );
}

// ── rewards ───────────────────────────────────────────────────────────────
export function grantedVisual(g: Granted): { big: React.ReactNode; label: string; color?: string; isNew?: boolean } {
  switch (g.kind) {
    case 'coins':
      return { big: '🪙', label: `+${g.amount.toLocaleString()}`, color: '#ffc247' };
    case 'gems':
      return { big: '💎', label: `+${g.amount}`, color: '#e86bff' };
    case 'xp':
      return { big: '⭐', label: `+${g.amount} XP`, color: '#8fb6ff' };
    case 'tokens':
      return { big: '🎟️', label: `+${g.amount} tokens`, color: '#ffd166' };
    case 'card':
      return { big: <TowerIcon type={g.tower} size={44} />, label: `${TOWERS[g.tower].name} ×${g.copies}`, color: RARITY_COLOR[TOWER_RARITY[g.tower]], isNew: g.isNew };
    case 'troop':
      return { big: <TroopIcon pack={g.troop} size={22} />, label: SEND_PACKS[g.troop].name, color: '#ff7a3c', isNew: g.isNew };
    case 'icon':
      return { big: iconDef(g.id).emoji, label: `Icon: ${iconDef(g.id).name}`, color: '#4f8cff', isNew: g.isNew };
    case 'emote':
      return { big: emoteDef(g.id).emoji, label: `Emote "${emoteDef(g.id).text}"`, color: '#3fd27f', isNew: g.isNew };
    case 'chest':
      return { big: <ChestArt tier={g.tier} />, label: CHESTS[g.tier].name, color: CHESTS[g.tier].color };
    case 'arena':
      return { big: ARENAS[g.arena].emoji, label: ARENAS[g.arena].name, color: ARENAS[g.arena].colors[2] };
  }
}

export function GrantedTile({ g, delay = 0 }: { g: Granted; delay?: number }) {
  const v = grantedVisual(g);
  return (
    <div className="granted" style={{ '--rc': v.color, animationDelay: `${delay}s` } as CSSProperties}>
      {v.isNew && <span className="new-burst">NEW!</span>}
      <div className="big" style={{ display: 'grid', placeItems: 'center', minHeight: 50 }}>
        {v.big}
      </div>
      <b>{v.label}</b>
    </div>
  );
}

export function rewardSpecVisual(r: RewardSpec): { icon: React.ReactNode; label: string } {
  switch (r.type) {
    case 'coins':
      return { icon: '🪙', label: r.amount.toLocaleString() };
    case 'gems':
      return { icon: '💎', label: String(r.amount) };
    case 'tokens':
      return { icon: '🎟️', label: String(r.amount) };
    case 'chest':
      return { icon: '🧰', label: CHESTS[r.tier].name };
    case 'tower':
      return { icon: <TowerIcon type={r.tower} size={26} />, label: `${TOWERS[r.tower].name}` };
    case 'cards':
      return { icon: <TowerIcon type={r.tower} size={26} />, label: `${TOWERS[r.tower].name} ×${r.copies}` };
    case 'troop':
      return { icon: <TroopIcon pack={r.troop} size={16} />, label: SEND_PACKS[r.troop].name };
    case 'icon':
      return { icon: iconDef(r.icon).emoji, label: `${iconDef(r.icon).name} icon` };
    case 'emote':
      return { icon: emoteDef(r.emote).emoji, label: `"${emoteDef(r.emote).text}" emote` };
    case 'arena':
      return { icon: ARENAS[r.arena].emoji, label: ARENAS[r.arena].name };
  }
}

export function RewardPill({ r }: { r: RewardSpec }) {
  const v = rewardSpecVisual(r);
  return (
    <span className="reward-pill">
      {v.icon} {v.label}
    </span>
  );
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ms until the next local midnight (daily quests / shop refresh). */
export function untilMidnight(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - now;
}
