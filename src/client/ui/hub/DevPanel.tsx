// Dev panel (only when the server runs with DEV_TOOLS=1). Toggle with ` or the 🛠 button.
// Everything goes through /api/dev/* endpoints which the server refuses otherwise.
import { useEffect, useState } from 'react';
import { TOWERS } from '../../../shared/config';
import { TOWER_TYPES, type TowerType } from '../../../shared/types';
import { api } from '../../net';
import { store, toast, useStore } from '../../store';
import { celebrateLevelUps } from './actions';

async function dev(path: string, body: object = {}, msg?: string) {
  const r = (await api.dev(path, body)) as { ok: boolean; error?: string; levelUps?: never[] };
  if (!r.ok) toast('error', r.error ?? 'Dev call failed');
  else {
    if (msg) toast('success', msg);
    celebrateLevelUps(r.levelUps);
  }
  return r.ok;
}

export function DevPanel() {
  const enabled = useStore((s) => s.serverInfo?.devTools ?? false);
  const open = useStore((s) => s.devOpen);
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const view = useStore((s) => s.view);
  const [duel, setDuel] = useState('');
  const [team, setTeam] = useState('');
  const [tower, setTower] = useState<TowerType>('tesla');
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === '`') store.set({ devOpen: !store.get().devOpen });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  if (!enabled || !user || user.guest) return null;
  if (!open)
    return (
      <button className="dev-toggle" onClick={() => store.set({ devOpen: true })} title="Dev tools (`)">
        DEV
      </button>
    );
  return (
    <div className="panel dev-panel">
      <div className="panel-title">
        🛠 Dev tools <span className="count">local testing</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => store.set({ devOpen: false })}>
          ✕
        </button>
      </div>
      <div className="section-label" style={{ marginTop: 0 }}>
        Grant
      </div>
      <div className="grid2">
        <button className="btn btn-sm" onClick={() => void dev('grant', { coins: 5000 }, '+5000 coins')}>
          🪙 +5,000
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { gems: 1000 }, '+1000 gems')}>
          💎 +1,000
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { xp: 500 }, '+500 XP')}>
          ⭐ +500 XP
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { tokens: 300 }, '+3 pass tiers')}>
          🎟️ +300 tokens
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { drop: true }, 'Drop added (Battle tab)')}>
          🎁 +1 drop
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { chest: 'magic' }, 'Magic chest added')}>
          🧰 +Magic chest
        </button>
        <button className="btn btn-sm" onClick={() => void dev('grant', { cards: 'all', copies: 50 }, '+50 copies of every card')}>
          🃏 All cards ×50
        </button>
        <button className="btn btn-sm" onClick={() => void dev('unlock-all', {}, 'Everything unlocked')}>
          🔓 Unlock all
        </button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <select className="input" style={{ padding: '4px 6px' }} value={tower} onChange={(e) => setTower(e.target.value as TowerType)}>
          {TOWER_TYPES.map((t) => (
            <option key={t} value={t}>
              {TOWERS[t].name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => void dev('grant', { tower, copies: 20 }, `+20 ${TOWERS[tower].name}`)}>
          +20 copies
        </button>
      </div>
      <div className="section-label">Trophies (now {profile ? `${profile.duel} / ${profile.team}` : '?'})</div>
      <div className="row">
        <input className="input" style={{ padding: '4px 8px' }} placeholder="Duel" value={duel} onChange={(e) => setDuel(e.target.value.replace(/\D/g, ''))} />
        <input className="input" style={{ padding: '4px 8px' }} placeholder="2v2" value={team} onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))} />
        <button
          className="btn btn-sm"
          onClick={() =>
            void dev('trophies', { ...(duel ? { duel: Number(duel) } : {}), ...(team ? { team: Number(team) } : {}) }, 'Trophies set')
          }
        >
          Set
        </button>
      </div>
      <div className="section-label">Time & season</div>
      <div className="grid2">
        <button className="btn btn-sm" onClick={() => void dev('reset-daily', {}, 'Daily quests, drops and shop reset')}>
          🔄 Reset daily
        </button>
        <button className="btn btn-sm" onClick={() => void dev('end-season', {}, 'Season ended')}>
          🏁 End season now
        </button>
      </div>
      <div className="section-label">Matches</div>
      <div className="grid2">
        <button className="btn btn-sm" onClick={() => void dev('bot-match', { mode: 'duel' })}>
          🤖 Bot duel now
        </button>
        <button className="btn btn-sm" onClick={() => void dev('bot-match', { mode: 'team' })}>
          🤖 Bot 2v2 now
        </button>
        <button className="btn btn-sm" disabled={view !== 'game'} onClick={() => void dev('fast-forward', { seconds: 60 })}>
          ⏩ Match +60s
        </button>
        <button className="btn btn-sm" disabled={view !== 'game'} onClick={() => void dev('fast-forward', { seconds: 600 })}>
          ⏩ Match +10 min
        </button>
      </div>
      <div className="section-label">Danger</div>
      <button
        className="btn btn-sm btn-danger btn-block"
        onClick={() =>
          store.set({
            confirm: {
              title: 'Reset progression?',
              text: 'Your coins, gems, cards, trophies and quests go back to a brand-new account.',
              confirmLabel: 'Reset',
              onConfirm: () => void dev('reset-progression', {}, 'Progression reset'),
            },
          })
        }
      >
        ♻️ Reset my progression
      </button>
    </div>
  );
}
