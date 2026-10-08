// Progress: Trophy Road, Tower Pass (free + premium track, unlocked with EARNED gems) and
// daily / weekly quests.
import { useEffect, useRef, useState } from 'react';
import type { QuestView } from '../../../shared/progProtocol';
import { ARENAS, passFreeReward, passPremiumReward, SEASON, TROPHY_ROAD } from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import { useStore } from '../../store';
import { useNow } from '../components';
import { claimWithReveal, progAct } from './actions';
import { fmtDuration, NavBadge, ProgressBar, RewardPill, untilMidnight } from './bits';

type Sub = 'road' | 'pass' | 'quests';

function TrophyRoad() {
  const p = useStore((s) => s.profile)!;
  const listRef = useRef<HTMLDivElement>(null);
  const [popped, setPopped] = useState<number | null>(null);
  useEffect(() => {
    // scroll to the first claimable node, else to the current progress
    const el = listRef.current;
    if (!el) return;
    const target = el.querySelector('.road-node.claimable') ?? [...el.querySelectorAll('.road-node.reached')].pop();
    if (target) (target as HTMLElement).scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const claim = async (id: number) => {
    setPopped(id);
    await claimWithReveal(EV.progClaimRoad, { nodeId: id }, 'Trophy Road reward!');
  };
  return (
    <div className="panel">
      <div className="panel-title">
        🛤️ Trophy Road <span className="count">progress = best Duel + best 2v2 = {p.roadProgress} 🏆</span>
      </div>
      <div className="road" ref={listRef}>
        {TROPHY_ROAD.map((n) => {
          const reached = p.roadProgress >= n.trophies;
          const claimed = p.roadClaimed.includes(n.id);
          const claimable = reached && !claimed;
          const arenaR = n.rewards.find((r) => r.type === 'arena');
          const a = arenaR && arenaR.type === 'arena' ? ARENAS[arenaR.arena] : null;
          return (
            <div key={n.id} className={`road-node ${reached ? 'reached' : ''} ${claimed ? 'claimed' : ''} ${claimable ? 'claimable' : ''} ${n.milestone ? 'milestone' : ''}`}>
              <div className="tr">🏆 {n.trophies}</div>
              <div className="track">
                <div className="pip" />
              </div>
              <div
                className={`body ${popped === n.id ? 'claim-pop' : ''}`}
                style={a ? { background: `linear-gradient(110deg, ${a.colors[0]}, ${a.colors[1]})` } : undefined}
              >
                {a && <span style={{ fontSize: 40 }}>{a.emoji}</span>}
                <div className="col" style={{ gap: 6 }}>
                  {a && <b style={{ fontFamily: 'var(--display)', fontSize: 20 }}>{a.name}</b>}
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {n.rewards.filter((r) => r.type !== 'arena').map((r, i) => (
                      <RewardPill key={i} r={r} />
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ width: 92, textAlign: 'center' }}>
                {claimed ? <span className="dim">✓ Claimed</span> : claimable ? (
                  <button className="btn btn-green btn-sm" onClick={() => void claim(n.id)}>
                    Claim!
                  </button>
                ) : (
                  <span className="dim">🔒</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pass() {
  const p = useStore((s) => s.profile)!;
  const now = useNow(30_000);
  const tokensInto = p.pass.tokens - p.pass.tier * SEASON.tokensPerTier;
  const tiers = Array.from({ length: SEASON.passTiers }, (_, i) => i + 1);
  return (
    <div className="panel">
      <div className="pass-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="panel-title" style={{ margin: 0 }}>
            🎟️ Tower Pass — Season {p.pass.season}
          </div>
          <div className="hint">Ends in {fmtDuration(p.season.endsAt - now)} · earn tokens from matches and quests</div>
        </div>
        <div className="grow" style={{ minWidth: 220 }}>
          <ProgressBar
            value={p.pass.tier >= SEASON.passTiers ? 1 : tokensInto}
            max={p.pass.tier >= SEASON.passTiers ? 1 : SEASON.tokensPerTier}
            label={p.pass.tier >= SEASON.passTiers ? 'Pass complete!' : `Tier ${p.pass.tier} → ${p.pass.tier + 1}: ${tokensInto}/${SEASON.tokensPerTier}`}
          />
        </div>
        {p.pass.premium ? (
          <span className="badge" style={{ background: 'rgba(194,92,255,0.2)', color: '#e3b5ff' }}>
            ✨ Premium unlocked
          </span>
        ) : (
          <button className="btn" style={{ borderColor: 'var(--epic)', color: '#e3b5ff' }} disabled={p.gems < SEASON.premiumGemCost} onClick={() => void progAct(EV.progBuyPremium)}>
            ✨ Unlock premium · 💎 {SEASON.premiumGemCost}
          </button>
        )}
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>
        The premium track is unlocked with gems you earn in-game — there are no real-money purchases.
      </div>
      <div className="pass-grid">
        <div className="hdr">Tier</div>
        <div className="hdr">Free</div>
        <div className="hdr">Premium</div>
        {tiers.map((t) => {
          const reached = p.pass.tier >= t;
          const fClaimed = p.pass.claimedFree.includes(t);
          const pClaimed = p.pass.claimedPremium.includes(t);
          return [
            <div key={`t${t}`} className={`pass-tier ${reached ? 'reached' : ''}`}>
              {t}
            </div>,
            <div key={`f${t}`} className={`pass-cell ${fClaimed ? 'claimed' : ''}`}>
              <RewardPill r={passFreeReward(t)} />
              <span className="spacer" />
              {fClaimed ? (
                <span className="dim">✓</span>
              ) : reached ? (
                <button className="btn btn-green btn-sm" onClick={() => void claimWithReveal(EV.progClaimPass, { tier: t, track: 'free' }, `Tower Pass tier ${t}`)}>
                  Claim
                </button>
              ) : (
                <span className="dim">🔒</span>
              )}
            </div>,
            <div key={`p${t}`} className={`pass-cell premium ${!p.pass.premium ? 'locked' : ''} ${pClaimed ? 'claimed' : ''}`}>
              <RewardPill r={passPremiumReward(t)} />
              <span className="spacer" />
              {pClaimed ? (
                <span className="dim">✓</span>
              ) : reached && p.pass.premium ? (
                <button className="btn btn-sm" style={{ borderColor: 'var(--epic)' }} onClick={() => void claimWithReveal(EV.progClaimPass, { tier: t, track: 'premium' }, `Premium tier ${t}`)}>
                  Claim
                </button>
              ) : (
                <span className="dim">🔒</span>
              )}
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

function QuestRow({ q, canReroll }: { q: QuestView; canReroll: boolean }) {
  const done = q.progress >= q.target;
  return (
    <div className={`quest ${done ? 'done' : ''} ${q.claimed ? 'claimed' : ''}`}>
      <div>
        <div className="qt">{q.text}</div>
        <div className="qr">
          🪙 {q.coins} · ⭐ {q.xp} XP · 🎟️ {q.tokens} tokens
        </div>
      </div>
      <div className="col" style={{ gap: 3 }}>
        <div className="mini-bar">
          <div style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }} />
        </div>
        <span className="dim" style={{ fontSize: 11, textAlign: 'right' }}>
          {Math.min(q.progress, q.target).toLocaleString()} / {q.target.toLocaleString()}
        </span>
      </div>
      <div className="row" style={{ gap: 6, justifyContent: 'flex-end', minWidth: 120 }}>
        {q.claimed ? (
          <span className="dim">✓ Done</span>
        ) : done ? (
          <button className="btn btn-green btn-sm" onClick={() => void claimWithReveal(EV.progClaimQuest, { questId: q.id }, 'Quest complete!')}>
            Claim
          </button>
        ) : (
          canReroll &&
          !q.weekly && (
            <button className="btn btn-sm btn-ghost" title="Swap for another quest (1 free per day)" onClick={() => void progAct(EV.progRerollQuest, { questId: q.id })}>
              🎲 Reroll
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Quests() {
  const p = useStore((s) => s.profile)!;
  const now = useNow(30_000);
  const reset = untilMidnight(now);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel">
        <div className="panel-title">
          📜 Daily quests <span className="count">new ones in {fmtDuration(reset)}</span>
          <span className="spacer" />
          <span className="hint">{p.quests.rerollsLeft ? '1 free reroll left today' : 'Reroll used'}</span>
        </div>
        {p.quests.daily.map((q) => (
          <QuestRow key={q.id} q={q} canReroll={p.quests.rerollsLeft > 0} />
        ))}
      </div>
      <div className="panel">
        <div className="panel-title">🗓️ Weekly quests</div>
        {p.quests.weekly.map((q) => (
          <QuestRow key={q.id} q={q} canReroll={false} />
        ))}
      </div>
    </div>
  );
}

export function ProgressTab() {
  const p = useStore((s) => s.profile)!;
  const [sub, setSub] = useState<Sub>(() => (p.badges.road ? 'road' : p.badges.quests ? 'quests' : p.badges.pass ? 'pass' : 'road'));
  return (
    <>
      <div className="subtabs">
        {(
          [
            ['road', '🛤️ Trophy Road', p.badges.road],
            ['pass', '🎟️ Tower Pass', p.badges.pass],
            ['quests', '📜 Quests', p.badges.quests],
          ] as [Sub, string, number][]
        ).map(([id, label, n]) => (
          <button key={id} className={`subtab ${sub === id ? 'active' : ''}`} onClick={() => setSub(id)}>
            {label}
            <NavBadge n={n} />
          </button>
        ))}
      </div>
      {sub === 'road' && <TrophyRoad />}
      {sub === 'pass' && <Pass />}
      {sub === 'quests' && <Quests />}
    </>
  );
}
