import { useEffect, useState } from 'react';
import { DIFFICULTY, MODE_INFO } from '../../shared/config';
import { MAP_IDS, MAPS } from '../../shared/maps';
import { EV, ROOM_CODE_ALPHABET } from '../../shared/protocol';
import type { Difficulty, GameMode, MapId } from '../../shared/types';
import { act, getSocket, joinRoom } from '../net';
import { useStore } from '../store';
import { TopBar } from './App';
import { MapBadge, MapThumb, Switch } from './components';
import { FriendsPanel } from './FriendsPanel';

const MODE_ICON: Record<GameMode, string> = { coop: '🤝', ffa: '⚔️', teams: '🛡️' };

function ProfileCard() {
  const user = useStore((s) => s.user);
  const stats = useStore((s) => s.stats);
  if (!user) return null;
  const winRate = stats && stats.gamesPlayed ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
  const best = stats ? Object.entries(stats.bestCoop).sort(([a], [b]) => a.localeCompare(b)) : [];
  return (
    <div className="panel">
      <div className="profile-head">
        <div className="avatar">{user.name[0]?.toUpperCase()}</div>
        <div className="grow">
          <div className="row">
            <h3 className="ellipsis">{user.name}</h3>
            {user.guest && <span className="tag-guest">guest</span>}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {user.guest ? 'Guest session — stats are not saved' : 'Commander'}
          </div>
        </div>
      </div>
      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <b>{stats.gamesPlayed}</b>
              <span>Games</span>
            </div>
            <div className="stat">
              <b>{stats.wins}</b>
              <span>Wins</span>
            </div>
            <div className="stat">
              <b>{winRate}%</b>
              <span>Win rate</span>
            </div>
          </div>
          <div className="section-label">Best co-op waves</div>
          {best.length === 0 ? (
            <div className="dim" style={{ fontSize: 12 }}>
              Play a co-op game to set a record.
            </div>
          ) : (
            <div className="best-list">
              {best.map(([key, wave]) => {
                const [mapId, diff] = key.split(':') as [MapId, Difficulty];
                const map = MAPS[mapId];
                return (
                  <div key={key}>
                    <span>
                      {map?.name ?? mapId} · {DIFFICULTY[diff]?.label ?? diff}
                    </span>
                    <b style={{ color: map && wave >= map.finalWave ? 'var(--gold)' : undefined }}>
                      {map && wave >= map.finalWave ? '★ ' : ''}
                      {wave}/{map?.finalWave ?? '?'}
                    </b>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function JoinByCode() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = (v: string) =>
    v
      .toUpperCase()
      .split('')
      .filter((c) => ROOM_CODE_ALPHABET.includes(c))
      .join('')
      .slice(0, 6);
  const go = async () => {
    setBusy(true);
    await joinRoom(code);
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="panel-title">🔑 Join by code</div>
      <div className="row">
        <input
          className="input mono"
          style={{ letterSpacing: 4, fontWeight: 700, textTransform: 'uppercase' }}
          placeholder="ABC234"
          value={code}
          onChange={(e) => setCode(clean(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void go()}
        />
        <button className="btn btn-blue" disabled={code.length !== 6 || busy} onClick={() => void go()}>
          Join
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Codes are 6 characters. Invite links look like <span className="mono">/join/ABC234</span>.
      </div>
    </div>
  );
}

function CreateGame() {
  const [mode, setMode] = useState<GameMode>('coop');
  const [mapId, setMapId] = useState<MapId>('greenfield');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [isPublic, setPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    await act(EV.roomCreate, { mode, mapId, difficulty, isPublic });
    setBusy(false);
  };
  return (
    <div className="panel">
      <div className="panel-title">🏰 Create a game</div>
      <div className="mode-cards">
        {(Object.keys(MODE_INFO) as GameMode[]).map((m) => (
          <button key={m} className={`mode-card ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
            <div className="mode-icon">{MODE_ICON[m]}</div>
            <h4>{MODE_INFO[m].label}</h4>
            <p>{MODE_INFO[m].blurb}</p>
            <p style={{ marginTop: 4 }} className="dim">
              {MODE_INFO[m].minPlayers}–{MODE_INFO[m].maxPlayers} players
            </p>
          </button>
        ))}
      </div>
      <div className="section-label">Map</div>
      <div className="map-grid">
        {MAP_IDS.map((id) => (
          <button key={id} className={`map-card ${mapId === id ? 'active' : ''}`} onClick={() => setMapId(id)}>
            <MapThumb mapId={id} width={190} />
            <div className="meta">
              <span className="name">{MAPS[id].name}</span>
              <MapBadge mapId={id} />
            </div>
            <div className="fw">{mode === 'coop' ? `Survive ${MAPS[id].finalWave} waves` : 'Last one standing'}</div>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            Difficulty
          </div>
          <div className="seg">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button key={d} className={difficulty === d ? 'active' : ''} onClick={() => setDifficulty(d)}>
                {DIFFICULTY[d].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-label" style={{ marginTop: 0 }}>
            Visibility
          </div>
          <Switch on={isPublic} onChange={setPublic} label={isPublic ? 'Public — listed in Browse' : 'Private — invite only'} />
        </div>
        <span className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void create()}>
          Create game
        </button>
      </div>
    </div>
  );
}

function BrowseGames() {
  const rooms = useStore((s) => s.publicRooms);
  const connected = useStore((s) => s.connected);
  useEffect(() => {
    const s = getSocket();
    if (!s || !connected) return;
    s.emit(EV.browseSubscribe);
    return () => {
      s.emit(EV.browseUnsubscribe);
    };
  }, [connected]);
  return (
    <div className="panel">
      <div className="panel-title">
        🌍 Browse public games <span className="count">{rooms.length}</span>
      </div>
      {rooms.length === 0 ? (
        <div className="empty">No public games right now. Create one and set it to Public!</div>
      ) : (
        <div className="browse-list">
          {rooms.map((r) => (
            <div className="browse-row" key={r.code}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }} className="ellipsis">
                  {MODE_ICON[r.mode]} {MODE_INFO[r.mode].label}
                </div>
                <div className="muted ellipsis" style={{ fontSize: 12 }}>
                  {MAPS[r.mapId].name} · {DIFFICULTY[r.difficulty].label} · host {r.hostName}
                </div>
              </div>
              <MapBadge mapId={r.mapId} />
              <span className="badge">
                {r.players}/{r.maxPlayers}
              </span>
              <button className="btn btn-sm btn-blue" disabled={r.players >= r.maxPlayers} onClick={() => void joinRoom(r.code)}>
                {r.players >= r.maxPlayers ? 'Full' : 'Join'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MainMenu() {
  return (
    <>
      <TopBar />
      <div className="page">
        <div className="menu-grid">
          <div className="col" style={{ gap: 18 }}>
            <ProfileCard />
            <JoinByCode />
          </div>
          <div className="col" style={{ gap: 18 }}>
            <CreateGame />
            <BrowseGames />
          </div>
          <div className="col friends-col" style={{ gap: 18 }}>
            <div className="panel">
              <FriendsPanel />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
