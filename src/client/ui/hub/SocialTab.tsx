// Social: friends panel + leaderboards (Duel, Team, Endless co-op) with Global/Friends and
// This season/All time toggles, top 100 and your own rank pinned at the bottom.
import { useCallback, useEffect, useState } from 'react';
import { MAPS, MAP_IDS } from '../../../shared/maps';
import type { LbRowView, LeaderboardQuery, LeaderboardView } from '../../../shared/progProtocol';
import { EV } from '../../../shared/protocol';
import type { MapId } from '../../../shared/types';
import { request } from '../../net';
import { useStore } from '../../store';
import { FriendsPanel } from '../FriendsPanel';
import { ArenaBadge, LevelInline, ProfileIcon } from './bits';

const MEDAL = ['🥇', '🥈', '🥉'];

function Row({ r, me, pinned, endless }: { r: LbRowView; me: boolean; pinned?: boolean; endless: boolean }) {
  return (
    <div className={`lb-row ${me ? 'me' : ''} ${pinned ? 'pinned' : ''}`}>
      <div className="lb-rank">{r.rank <= 3 ? MEDAL[r.rank - 1] : `#${r.rank}`}</div>
      <ProfileIcon icon={r.icon} size="sm" />
      <div className="row ellipsis" style={{ gap: 6 }}>
        {!endless && <LevelInline level={r.level} />}
        <b className="ellipsis">{r.name}</b>
        {me && <span className="dim">(you)</span>}
      </div>
      <div>{!endless && <ArenaBadge arena={r.arena} />}</div>
      <div className="lb-val">{endless ? `🌊 ${r.value}` : `🏆 ${r.value.toLocaleString()}`}</div>
    </div>
  );
}

function Leaderboards() {
  const user = useStore((s) => s.user);
  const [q, setQ] = useState<LeaderboardQuery>({ board: 'duel', scope: 'global', period: 'season', mapId: 'greenfield' });
  const [data, setData] = useState<LeaderboardView | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await request<LeaderboardView>(EV.progLeaderboard, q);
    setLoading(false);
    if (r.ok) setData({ rows: r.rows, me: r.me, lastTop3: r.lastTop3 });
  }, [q]);
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  const endless = q.board === 'endless';
  const meInView = !!data?.me && data.rows.some((r) => r.rank === data.me!.rank);
  const top3 = data?.lastTop3;
  return (
    <div className="panel">
      <div className="panel-title">
        🏅 Leaderboards
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
          ↻ Refresh
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div className="seg">
          {(
            [
              ['duel', '⚔️ Duel (1v1)'],
              ['team', '🛡️ Team (2v2)'],
              ['endless', '♾️ Endless co-op'],
            ] as [LeaderboardQuery['board'], string][]
          ).map(([b, label]) => (
            <button key={b} className={q.board === b ? 'active' : ''} onClick={() => setQ({ ...q, board: b })}>
              {label}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={q.scope === 'global' ? 'active' : ''} onClick={() => setQ({ ...q, scope: 'global' })}>
            🌍 Global
          </button>
          <button className={q.scope === 'friends' ? 'active' : ''} onClick={() => setQ({ ...q, scope: 'friends' })}>
            👥 Friends
          </button>
        </div>
        <div className="seg">
          <button className={q.period === 'season' ? 'active' : ''} onClick={() => setQ({ ...q, period: 'season' })}>
            This season
          </button>
          <button className={q.period === 'all' ? 'active' : ''} onClick={() => setQ({ ...q, period: 'all' })}>
            All time
          </button>
        </div>
        {endless && (
          <select className="input" style={{ width: 'auto' }} value={q.mapId} onChange={(e) => setQ({ ...q, mapId: e.target.value as MapId })}>
            {MAP_IDS.map((m) => (
              <option key={m} value={m}>
                {MAPS[m].name}
              </option>
            ))}
          </select>
        )}
      </div>
      {top3 && !endless && (top3.duel.length > 0 || top3.team.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div className="section-label" style={{ marginTop: 0 }}>
            Last season (#{top3.season}) top 3
          </div>
          <div className="top3">
            {(q.board === 'team' ? top3.team : top3.duel).map((t, i) => (
              <div key={t.userId} className="row">
                <span style={{ fontSize: 20 }}>{MEDAL[i]}</span>
                <ProfileIcon icon={t.icon} size="sm" />
                <b className="ellipsis grow">{t.name}</b>
                <span className="lb-val">🏆 {t.trophies}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="lb-table">
        {data && data.rows.length === 0 && (
          <div className="empty">{endless ? 'No endless runs recorded yet — play Endless Co-op!' : 'Nobody on this board yet. Play ranked to get on it!'}</div>
        )}
        {data?.rows.map((r) => (
          <Row key={`${r.rank}-${r.userId}`} r={r} me={endless ? !!r.players?.some((p) => p.id === user?.id) : r.userId === user?.id} endless={endless} />
        ))}
        {data?.me && !meInView && <Row r={data.me} me pinned endless={endless} />}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Top 100 · bots never appear on leaderboards · {endless ? 'best run per team composition' : q.period === 'season' ? 'current trophies' : 'highest trophies ever'}
      </div>
    </div>
  );
}

export function SocialTab() {
  const user = useStore((s) => s.user);
  return (
    <div className="battle-grid social-grid">
      {user?.guest ? (
        <div className="panel">
          <div className="panel-title">🏅 Leaderboards</div>
          <div className="empty">Create an account to appear on the leaderboards.</div>
        </div>
      ) : (
        <Leaderboards />
      )}
      <div className="panel">
        <FriendsPanel />
      </div>
    </div>
  );
}
