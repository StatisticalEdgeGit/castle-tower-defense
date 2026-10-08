// Reveal / celebration modals: reward drops (tap-to-upgrade), chests (card-by-card flip),
// generic "you got" reveals, level-ups, arena unlocks, season end, party invites.
import { useEffect, useState, type CSSProperties } from 'react';
import { TOWERS } from '../../../shared/config';
import type { Granted } from '../../../shared/progProtocol';
import { ARENAS, CHESTS, RARITY_COLOR, RARITY_LABEL, TOWER_RARITY, towerPool, troopPool, type DropRarity } from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import { SEND_PACKS } from '../../../shared/config';
import { store, useStore } from '../../store';
import { TowerIcon } from '../components';
import { openChestFlow, progAct } from './actions';
import { ArenaBadge, Burst, ChestArt, Confetti, CountUp, GrantedTile, TroopIcon } from './bits';

const DROP_EMOJI: Record<DropRarity, string> = { common: '🎁', rare: '🎁', epic: '💜', mythic: '❤️‍🔥', legendary: '🌟' };

function close() {
  store.set({ reveal: null });
}

// ── reward drop ────────────────────────────────────────────────────────────
function DropReveal({ result }: { result: { steps: DropRarity[]; rarity: DropRarity; granted: Granted[] } | null }) {
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [k, setK] = useState(0);
  const [shake, setShake] = useState(false);
  const steps = result?.steps ?? ['common'];
  const cur = steps[Math.min(step, steps.length - 1)];
  const color = RARITY_COLOR[cur];
  const tap = () => {
    if (!result || revealed) return;
    setShake(false);
    window.setTimeout(() => setShake(true), 0);
    setK((x) => x + 1);
    if (step < steps.length - 1) setStep(step + 1);
    else setRevealed(true);
  };
  const big = revealed && (result?.rarity === 'epic' || result?.rarity === 'mythic' || result?.rarity === 'legendary');
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && revealed && close()}>
      {big && <Confetti n={110} />}
      <div className="reveal">
        <div className="section-label" style={{ margin: 0 }}>
          Reward drop
        </div>
        <div className="rar-title" key={`t${step}`} style={{ '--rc': color } as CSSProperties}>
          {RARITY_LABEL[cur]}!
        </div>
        {!revealed ? (
          <>
            <div style={{ position: 'relative' }}>
              <div className={`drop-orb ${shake ? 'shake' : ''}`} style={{ '--rc': color } as CSSProperties} onClick={tap}>
                {result ? DROP_EMOJI[cur] : '⏳'}
              </div>
              <Burst k={k} color={color} n={k ? 22 : 0} />
            </div>
            <div className="tap-hint">{result ? 'Tap the drop! It might upgrade…' : 'Opening…'}</div>
            <button className="btn btn-ghost btn-sm" disabled={!result} onClick={() => setRevealed(true)}>
              Skip
            </button>
          </>
        ) : (
          <>
            <div className="granted-list">
              {result!.granted.map((g, i) => (
                <GrantedTile key={i} g={g} delay={i * 0.12} />
              ))}
            </div>
            <ChestFollowUp granted={result!.granted} />
            <button className="btn btn-primary btn-lg" onClick={close}>
              Collect
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ChestFollowUp({ granted }: { granted: Granted[] }) {
  const chest = granted.find((g): g is Extract<Granted, { kind: 'chest' }> => g.kind === 'chest');
  if (!chest) return null;
  return (
    <button className="btn btn-blue" onClick={() => void openChestFlow(chest.chestId, chest.tier)}>
      Open the {CHESTS[chest.tier].name} now
    </button>
  );
}

// ── chest ──────────────────────────────────────────────────────────────────
function ChestReveal({ tier, granted }: { tier: keyof typeof CHESTS; granted: Granted[] | null }) {
  const [phase, setPhase] = useState<'closed' | 'cards' | 'summary'>('closed');
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = (granted ?? []).filter((g): g is Extract<Granted, { kind: 'card' }> => g.kind === 'card');
  const others = (granted ?? []).filter((g) => g.kind !== 'card');
  const tap = () => {
    if (!granted) return;
    if (phase === 'closed') {
      setPhase(cards.length ? 'cards' : 'summary');
      return;
    }
    if (phase === 'cards') {
      if (!flipped) setFlipped(true);
      else if (idx < cards.length - 1) {
        setIdx(idx + 1);
        setFlipped(false);
      } else setPhase('summary');
    }
  };
  const c = cards[idx];
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && phase === 'summary' && close()}>
      {phase === 'summary' && cards.some((x) => x.isNew) && <Confetti n={90} />}
      <div className="reveal" onClick={phase !== 'summary' ? tap : undefined} style={{ cursor: phase !== 'summary' ? 'pointer' : 'default' }}>
        <h2>{CHESTS[tier].name}</h2>
        {phase === 'closed' && (
          <>
            <div style={{ animation: 'wiggle 1.2s ease-in-out infinite' }}>
              <ChestArt tier={tier} lg />
            </div>
            <div className="tap-hint">{granted ? 'Tap to open!' : 'Opening…'}</div>
          </>
        )}
        {phase === 'cards' && c && (
          <>
            <div className="muted" style={{ fontSize: 12 }}>
              Card {idx + 1} of {cards.length}
            </div>
            <div className={`flip-card ${flipped ? 'flipped' : ''}`} style={{ '--rc': RARITY_COLOR[TOWER_RARITY[c.tower]] } as CSSProperties}>
              <div className="flip-inner">
                <div className="flip-face back" style={{ '--rc': RARITY_COLOR[TOWER_RARITY[c.tower]] } as CSSProperties}>
                  ❔
                </div>
                <div className="flip-face front" style={{ '--rc': RARITY_COLOR[TOWER_RARITY[c.tower]] } as CSSProperties}>
                  {c.isNew && flipped && <span className="new-burst">NEW!</span>}
                  <div className="rar" style={{ color: RARITY_COLOR[TOWER_RARITY[c.tower]], fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                    {RARITY_LABEL[TOWER_RARITY[c.tower]]}
                  </div>
                  <TowerIcon type={c.tower} size={70} />
                  <b style={{ fontFamily: 'var(--display)', fontSize: 18 }}>{TOWERS[c.tower].name}</b>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 26, color: '#6be3a0' }}>{flipped ? <CountUp value={c.copies} from={0} prefix="+" /> : ''}</div>
                  {c.copiesNeeded !== null && (
                    <div className="tcard" style={{ padding: 0, border: 'none', background: 'none', width: '100%', cursor: 'default' }}>
                      <div className="cbar">
                        <div style={{ width: `${Math.min(100, (c.copiesAfter / c.copiesNeeded) * 100)}%`, transition: 'width 0.9s' }} />
                        <span>
                          {c.copiesAfter}/{c.copiesNeeded}
                          {c.copiesAfter >= c.copiesNeeded ? ' — Upgrade!' : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="tap-hint">{flipped ? (idx < cards.length - 1 ? 'Tap for the next card' : 'Tap to finish') : 'Tap to flip'}</div>
          </>
        )}
        {phase === 'summary' && (
          <>
            <div className="granted-list">
              {[...others, ...cards].map((g, i) => (
                <GrantedTile key={i} g={g} delay={i * 0.08} />
              ))}
            </div>
            <button className="btn btn-primary btn-lg" onClick={close}>
              Collect
            </button>
          </>
        )}
        {phase !== 'summary' && granted && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              setPhase('summary');
            }}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

function GrantedReveal({ title, granted }: { title: string; granted: Granted[] }) {
  const special = granted.some((g) => ('isNew' in g && g.isNew) || g.kind === 'arena');
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      {special && <Confetti n={80} />}
      <div className="reveal">
        <h2>{title}</h2>
        <div className="granted-list">
          {granted.map((g, i) => (
            <GrantedTile key={i} g={g} delay={i * 0.12} />
          ))}
        </div>
        <ChestFollowUp granted={granted} />
        <button className="btn btn-primary btn-lg" autoFocus onClick={close}>
          Awesome!
        </button>
      </div>
    </div>
  );
}

export function RevealHost() {
  const reveal = useStore((s) => s.reveal);
  if (!reveal) return null;
  if (reveal.kind === 'drop') return <DropReveal key={reveal.dropId} result={reveal.result} />;
  if (reveal.kind === 'chest') return <ChestReveal key={reveal.chestId} tier={reveal.tier} granted={reveal.granted} />;
  return <GrantedReveal title={reveal.title} granted={reveal.granted} />;
}

// ── celebrations ───────────────────────────────────────────────────────────
export function CelebrationHost() {
  const list = useStore((s) => s.celebrations);
  const reveal = useStore((s) => s.reveal);
  const view = useStore((s) => s.view);
  if (!list.length || reveal || view === 'game') return null;
  const c = list[0];
  const done = () => store.set((s) => ({ celebrations: s.celebrations.slice(1) }));
  if (c.kind === 'levelup') {
    const last = c.levelUps[c.levelUps.length - 1];
    return (
      <div className="overlay" onClick={done}>
        <Confetti n={120} />
        <div className="reveal">
          <div className="celebrate-title">LEVEL UP!</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 90, lineHeight: 1, color: '#8fb6ff', textShadow: '0 0 30px rgba(79,140,255,0.8)' }}>{last.level}</div>
          <div className="granted-list">
            {c.levelUps.map((u) => (
              <GrantedTile key={u.level} g={{ kind: 'chest', tier: u.chest, chestId: '' }} />
            ))}
            <GrantedTile g={{ kind: 'gems', amount: c.levelUps.reduce((a, u) => a + u.gems, 0) }} />
          </div>
          <div className="muted">Your level-up chests are waiting on the Battle tab.</div>
          <button className="btn btn-primary btn-lg">Continue</button>
        </div>
      </div>
    );
  }
  const a = ARENAS[c.arena];
  const towers = a.towers;
  const troops = a.troops;
  return (
    <div className="overlay" onClick={done}>
      <Confetti n={150} />
      <div className="arena-cine" style={{ background: `linear-gradient(160deg, ${a.colors[0]}, ${a.colors[1]})` }}>
        <div className="arena-sub">New arena unlocked!</div>
        <div style={{ fontSize: 110, lineHeight: 1.1, animation: 'floaty 3s ease-in-out infinite' }}>{a.emoji}</div>
        <div className="arena-name" style={{ fontSize: 44 }}>
          {a.name}
        </div>
        <div style={{ margin: '10px 0', opacity: 0.9 }}>{a.trophies} trophies</div>
        {(towers.length > 0 || troops.length > 0 || a.maps.length > 0) && (
          <div className="col" style={{ alignItems: 'center' }}>
            <div className="section-label" style={{ color: '#fff' }}>
              Now in your drop pool
            </div>
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 12 }}>
              {towers.map((t) => (
                <div key={t} className="col" style={{ alignItems: 'center', gap: 2 }}>
                  <TowerIcon type={t} size={48} />
                  <b>{TOWERS[t].name}</b>
                </div>
              ))}
              {troops.map((t) => (
                <div key={t} className="col" style={{ alignItems: 'center', gap: 2 }}>
                  <TroopIcon pack={t} size={26} />
                  <b>{SEND_PACKS[t].name}</b>
                </div>
              ))}
            </div>
            {a.maps.length > 0 && <div style={{ marginTop: 6 }}>New ranked map: {a.maps.join(', ')}</div>}
          </div>
        )}
        <button className="btn btn-primary btn-lg" style={{ marginTop: 18 }}>
          Let's go!
        </button>
        <div className="lock-note" style={{ marginTop: 8, color: '#fff', opacity: 0.7 }}>
          Pool so far: {towerPool(c.arena).length} towers, {troopPool(c.arena).length} troop cards
        </div>
      </div>
    </div>
  );
}

export function SeasonNoticeModal() {
  const profile = useStore((s) => s.profile);
  const view = useStore((s) => s.view);
  const n = profile?.seasonNotice;
  if (!n || view === 'game') return null;
  return (
    <div className="overlay">
      <Confetti n={70} />
      <div className="reveal panel" style={{ padding: 24 }}>
        <div className="celebrate-title" style={{ fontSize: 40 }}>
          Season {n.season} is over!
        </div>
        <div>
          Peak arena: <ArenaBadge arena={n.peakArena} />
        </div>
        <div className="granted-list">
          <GrantedTile g={{ kind: 'coins', amount: n.coins }} />
          <GrantedTile g={{ kind: 'gems', amount: n.gems }} />
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Trophy reset — Duel {n.duelBefore} → {n.duelAfter}, Team {n.teamBefore} → {n.teamAfter}. The Tower Pass has been reset for the new season.
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => void progAct(EV.progAckSeason)}>
          Start the new season
        </button>
      </div>
    </div>
  );
}

export function PartyInvitePopups() {
  const invites = useStore((s) => s.partyInvites);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const live = invites.filter((i) => i.expiresAt > now);
  if (!live.length) return null;
  const respond = async (partyId: string, accept: boolean) => {
    store.set((s) => ({ partyInvites: s.partyInvites.filter((i) => i.partyId !== partyId) }));
    await progAct(EV.partyRespond, { partyId, accept });
  };
  return (
    <div className="invite-pop" style={{ bottom: 100 }}>
      {live.map((i) => (
        <div key={i.partyId} className="panel invite-card">
          <div className="row" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>🤝</span>
            <b>Party invite</b>
            <span className="spacer" />
            <span className="dim" style={{ fontSize: 12 }}>
              {Math.ceil((i.expiresAt - now) / 1000)}s
            </span>
          </div>
          <div style={{ marginBottom: 10 }}>
            <b>{i.fromName}</b> wants to team up for <b>Ranked 2v2</b>.
          </div>
          <div className="row">
            <button className="btn btn-green grow" onClick={() => void respond(i.partyId, true)}>
              Join party
            </button>
            <button className="btn btn-danger grow" onClick={() => void respond(i.partyId, false)}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
