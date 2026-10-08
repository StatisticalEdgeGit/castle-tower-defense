// Matchmaking search screen and the VS splash shown before a ranked match.
import { MAPS } from '../../../shared/maps';
import type { VsSide } from '../../../shared/progProtocol';
import { MATCHMAKING } from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import { useStore } from '../../store';
import { useNow } from '../components';
import { progAct } from './actions';
import { ArenaBadge, ProfileIcon } from './bits';

export function MatchmakingOverlay() {
  const mm = useStore((s) => s.mm);
  const vs = useStore((s) => s.vs);
  const now = useNow(250);
  if (mm.state !== 'searching' || vs) return null;
  const secs = Math.max(0, Math.floor((now - mm.since) / 1000));
  const gap = MATCHMAKING.gapStart + MATCHMAKING.gapGrowth * Math.floor(secs / MATCHMAKING.gapEverySec);
  return (
    <div className="overlay">
      <div className="mm-box">
        <div style={{ position: 'relative', display: 'grid', placeItems: 'center', width: 180, height: 180 }}>
          <div className="mm-ring" />
          <div className="mm-swords">⚔️</div>
        </div>
        <h2>{mm.mode === 'team' ? 'Searching for a 2v2 match…' : 'Searching for an opponent…'}</h2>
        <div className="mm-time">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </div>
        {mm.party.length > 1 && <div className="muted">Party: {mm.party.join(' & ')}</div>}
        <div className="muted" style={{ fontSize: 13 }}>
          Looking within ±{gap} trophies{secs >= 6 ? ' — widening the search' : ''}.
          <br />
          {secs < MATCHMAKING.botTimeoutSec ? `A bot of your level fills in after ${MATCHMAKING.botTimeoutSec}s.` : 'Bringing in a bot…'}
        </div>
        <button className="btn btn-danger btn-lg" onClick={() => void progAct(EV.mmCancel)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SideCard({ s }: { s: VsSide }) {
  return (
    <div className="vs-card">
      <ProfileIcon icon={s.icon} level={s.level} size="lg" />
      <div className="grow">
        <div className="nm">
          {s.name} {s.bot && <span className="bot-tag">bot</span>}
        </div>
        <div style={{ margin: '4px 0', fontFamily: 'var(--display)', color: 'var(--trophy)', fontSize: 18 }}>🏆 {s.trophies}</div>
        <ArenaBadge arena={s.arena} />
      </div>
    </div>
  );
}

export function VsSplash() {
  const vs = useStore((s) => s.vs);
  if (!vs) return null;
  const mine = vs.teams[vs.mySide];
  const theirs = vs.teams[vs.mySide === 0 ? 1 : 0];
  return (
    <div className="overlay" style={{ zIndex: 960 }}>
      <div className="col" style={{ alignItems: 'center', gap: 18 }}>
        <div className="arena-sub" style={{ fontSize: 14 }}>
          {vs.mode === 'duel' ? 'Ranked Duel' : 'Ranked 2v2'} · {MAPS[vs.mapId].name}
        </div>
        <div className="vs-wrap">
          <div className="vs-side left">
            {mine.map((s) => (
              <SideCard key={s.id} s={s} />
            ))}
          </div>
          <div className="vs-mid">VS</div>
          <div className="vs-side right">
            {theirs.map((s) => (
              <SideCard key={s.id} s={s} />
            ))}
          </div>
        </div>
        <div className="muted">Get ready…</div>
      </div>
    </div>
  );
}
