import { useState } from 'react';
import { DIFFICULTY, MODE_INFO, PLAYER_COLOR_NAMES, PLAYER_COLORS } from '../../shared/config';
import { MAP_IDS, MAPS } from '../../shared/maps';
import { EV, type RoomPlayer, type RoomState } from '../../shared/protocol';
import type { Difficulty, GameMode, MapId } from '../../shared/types';
import { act, copyText, inviteLink, isLocalhost, lanOrigin, leaveRoom } from '../net';
import { confirmDialog, store, toast, useStore } from '../store';
import { TopBar } from './App';
import { ChatInput, ChatLog, MapBadge, MapThumb, Switch, TowerIcon } from './components';
import { LevelInline, ProfileIcon, Stars } from './hub/bits';
import { FriendsPanel } from './FriendsPanel';

const EMPTY: string[] = [];

function startProblem(room: RoomState): string | null {
  const n = room.players.length;
  const info = MODE_INFO[room.mode];
  if (n < info.minPlayers) return `${info.short} needs at least ${info.minPlayers} players`;
  if (room.mode === 'teams') {
    const t0 = room.players.filter((p) => p.team === 0).length;
    if (t0 === 0 || t0 === n) return 'Both teams need at least one player';
  }
  const waiting = room.players.filter((p) => p.id !== room.hostId && (!p.ready || !p.connected));
  if (waiting.length) return `Waiting for ${waiting.map((p) => p.name).join(', ')} to ready up`;
  return null;
}

function InviteLinks({ code }: { code: string }) {
  const local = isLocalhost();
  const lanIps = useStore((s) => s.serverInfo?.lan ?? EMPTY);
  const [ip, setIp] = useState<string | undefined>(undefined);
  const lan = lanOrigin(ip && lanIps.includes(ip) ? ip : undefined);
  const link = inviteLink(code);
  const lanLink = lan ? inviteLink(code, lan) : null;
  const copy = async (text: string) => {
    if (await copyText(text)) toast('success', 'Invite link copied!');
    else toast('error', 'Could not copy — select the link manually');
  };
  return (
      <div className="col" style={{ gap: 8, flex: 1, minWidth: 0 }}>
      {local && lanLink && (
        <div className="lan-callout">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>📡 Share this link with players on your network</div>
          <div className="link-box">
            <span className="url" title={lanLink}>
              {lanLink}
            </span>
            <button className="btn btn-sm btn-green" onClick={() => void copy(lanLink)}>
              Copy LAN link
            </button>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            You're on localhost — that address only works on this PC. Others on your Wi-Fi/LAN should use the link above.
          </div>
          {lanIps.length > 1 && (
            <div className="row" style={{ marginTop: 6 }}>
              <span className="hint">Wrong network? Pick another address:</span>
              <select className="input" style={{ padding: '3px 6px', width: 'auto', fontSize: 12 }} value={ip ?? lanIps[0]} onChange={(e) => setIp(e.target.value)}>
                {lanIps.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {local && !lanLink && (
        <div className="callout">No LAN address detected — other devices can't reach this PC. Check your network connection.</div>
      )}
      <div className="link-box">
        <span className="url" title={link}>
          {link}
        </span>
        <button className="btn btn-sm" onClick={() => void copy(link)}>
          {local ? 'Copy local link' : 'Copy invite link'}
        </button>
      </div>
    </div>
  );
}

function PlayerSlot({ p, room, me }: { p: RoomPlayer; room: RoomState; me: string }) {
  const isHost = room.hostId === p.id;
  const amHost = room.hostId === me;
  return (
    <div className={`slot ${p.id === me ? 'me' : ''}`}>
      <div className="pcolor" style={{ background: PLAYER_COLORS[p.color] }} title={PLAYER_COLOR_NAMES[p.color]} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row">
          {isHost && (
            <span className="crown" title="Host">
              👑
            </span>
          )}
          <ProfileIcon icon={p.icon} size="sm" />
          <LevelInline level={p.level} />
          <span className="pname ellipsis">{p.name}</span>
          {p.guest && <span className="tag-guest">guest</span>}
          {p.bot && <span className="bot-tag">bot</span>}
          {p.id === me && <span className="dim" style={{ fontSize: 12 }}>(you)</span>}
        </div>
        <div className="row" style={{ gap: 2, marginTop: 4 }} title="Towers this player brings">
          {p.loadout.map((t) => (
            <TowerIcon key={t} type={t} size={22} />
          ))}
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          {isHost ? (
            <span className="ready-pill host">HOST</span>
          ) : p.ready ? (
            <span className="ready-pill yes">READY</span>
          ) : (
            <span className="ready-pill no">NOT READY</span>
          )}
          {!p.connected && <span className="badge" style={{ color: '#ff9a9a' }}>disconnected</span>}
        </div>
      </div>
      {room.mode === 'teams' && p.id === me && (
        <button className="btn btn-sm" onClick={() => void act(EV.roomTeam, { team: p.team === 0 ? 1 : 0 })}>
          Switch team
        </button>
      )}
      {amHost && p.id !== me && (
        <button
          className="btn btn-sm btn-danger"
          title="Kick"
          onClick={() =>
            confirmDialog({ title: `Kick ${p.name}?`, text: 'They can rejoin with the code unless the room is full.', confirmLabel: 'Kick', onConfirm: () => void act(EV.roomKick, { playerId: p.id }) })
          }
        >
          Kick
        </button>
      )}
    </div>
  );
}

function Settings({ room, amHost }: { room: RoomState; amHost: boolean }) {
  const set = (patch: object) => void act(EV.roomSettings, patch);
  const profile = useStore((s) => s.profile);
  const coopLocked = (id: MapId) => room.mode === 'coop' && !room.endless && !!profile && !profile.unlockedMaps.includes(id);
  return (
    <div className="panel">
      <div className="panel-title">
        ⚙️ Game settings {!amHost && <span className="count">host controls these</span>}
      </div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {(Object.keys(MODE_INFO) as GameMode[]).map((m) => (
          <button key={m} className={room.mode === m ? 'active' : ''} disabled={!amHost} onClick={() => set({ mode: m })}>
            <span className="wide-only">{MODE_INFO[m].label}</span>
            <span className="narrow-only">{MODE_INFO[m].short}</span>
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {MODE_INFO[room.mode].blurb}
      </div>
      <div className="map-grid">
        {MAP_IDS.map((id) => (
          <button
            key={id}
            className={`map-card ${room.mapId === id ? 'active' : ''}`}
            disabled={!amHost}
            onClick={() => set({ mapId: id })}
            style={{ cursor: amHost ? 'pointer' : 'default', opacity: amHost && coopLocked(id) ? 0.5 : 1 }}
          >
            <MapThumb mapId={id} width={160} />
            <div className="meta">
              <span className="name">{MAPS[id].name}</span>
              {room.mode === 'coop' && profile ? <Stars n={profile.campaign[id] ?? 0} /> : <MapBadge mapId={id} />}
            </div>
            {room.mode === 'coop' && (
              <div className="fw">{amHost && coopLocked(id) ? '🔒 earn 2★ on the previous map' : room.endless ? `Best ${profile?.endlessBest[id] ?? 0}` : `Final wave ${MAPS[id].finalWave}`}</div>
            )}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 16, flexWrap: 'wrap' }}>
        <div className="seg">
          {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
            <button key={d} className={room.difficulty === d ? 'active' : ''} disabled={!amHost} onClick={() => set({ difficulty: d })}>
              {DIFFICULTY[d].label}
            </button>
          ))}
        </div>
        <Switch on={room.isPublic} disabled={!amHost} onChange={(v) => set({ isPublic: v })} label={room.isPublic ? 'Public (listed in Browse)' : 'Private (invite only)'} />
        <Switch
          on={room.equalLevels}
          disabled={!amHost}
          onChange={(v) => set({ equalLevels: v })}
          label={room.equalLevels ? 'Equal levels (all towers Lv 5)' : 'Real card levels'}
        />
        {room.mode === 'coop' && (
          <Switch
            on={room.endless}
            disabled={!amHost || (!!profile && !profile.endlessUnlocked)}
            onChange={(v) => set({ endless: v })}
            label={room.endless ? 'Endless (no final wave)' : profile && !profile.endlessUnlocked ? 'Endless 🔒 (2★ on any map)' : 'Endless off'}
          />
        )}
      </div>
    </div>
  );
}

export function Lobby() {
  const room = useStore((s) => s.room);
  const user = useStore((s) => s.user);
  const chat = useStore((s) => s.chat);
  if (!room || !user) return null;
  const me = room.players.find((p) => p.id === user.id);
  const amHost = room.hostId === user.id;
  const problem = startProblem(room);
  const emptySlots = room.maxPlayers - room.players.length;

  const slots = (players: RoomPlayer[]) => players.map((p) => <PlayerSlot key={p.id} p={p} room={room} me={user.id} />);

  return (
    <>
      <TopBar />
      <div className="page">
        <div className="lobby-grid">
          <div className="col" style={{ gap: 18 }}>
            <div className="panel">
              <div className="row" style={{ marginBottom: 12 }}>
                <h2>Game lobby</h2>
                <span className="badge gold">{MODE_INFO[room.mode].label}</span>
                <span className="badge">{MAPS[room.mapId].name}</span>
                <span className="badge">{DIFFICULTY[room.difficulty].label}</span>
                <span className="spacer" />
                <button className="btn btn-danger btn-sm" onClick={() => void leaveRoom()}>
                  Leave room
                </button>
              </div>
              <div className="code-box">
                <div>
                  <div className="section-label" style={{ marginTop: 0 }}>
                    Room code
                  </div>
                  <div className="room-code">{room.code}</div>
                </div>
                <InviteLinks code={room.code} />
              </div>
            </div>

            {room.lastResults && (
              <div className="panel row">
                <span style={{ fontSize: 20 }}>{room.lastResults.outcome === 'victory' || room.lastResults.winners.includes(user.id) ? '🏆' : '📜'}</span>
                <span className="grow">
                  Last game:{' '}
                  <b>
                    {room.lastResults.outcome === 'victory'
                      ? 'Victory'
                      : room.lastResults.outcome === 'defeat'
                        ? `Defeat at wave ${room.lastResults.wave}`
                        : `Won by ${room.lastResults.players.filter((p) => room.lastResults!.winners.includes(p.id)).map((p) => p.name).join(' & ') || 'nobody'}`}
                  </b>
                </span>
                <button className="btn btn-sm" onClick={() => store.set({ results: room.lastResults, view: 'results' })}>
                  View results
                </button>
              </div>
            )}

            <div className="panel">
              <div className="panel-title">
                🎮 Players <span className="count">{room.players.length}/{room.maxPlayers}</span>
              </div>
              {room.mode === 'teams' ? (
                <div className="teams">
                  {[0, 1].map((t) => (
                    <div className="team-col" key={t}>
                      <h4>{t === 0 ? '🔷 Team 1' : '🔶 Team 2'}</h4>
                      <div className="col">
                        {slots(room.players.filter((p) => p.team === t))}
                        {room.players.filter((p) => p.team === t).length === 0 && <div className="slot empty-slot">Empty team</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="slots">
                  {slots(room.players)}
                  {Array.from({ length: emptySlots }, (_, i) => (
                    <div className="slot empty-slot" key={`e${i}`}>
                      Open slot — invite a friend or share the code
                    </div>
                  ))}
                </div>
              )}
              {amHost && room.players.filter((p) => !p.bot).length === 2 && room.players.every((p) => !p.guest) && (
                <div className="callout blue row" style={{ marginTop: 14, marginBottom: 0 }}>
                  <span className="grow">Two of you? Take this duo into the ranked 2v2 ladder together.</span>
                  <button className="btn btn-sm btn-blue" onClick={() => void act(EV.roomQueueRanked)}>
                    🏆 Queue ranked 2v2 together
                  </button>
                </div>
              )}
              <div className="row" style={{ marginTop: 16 }}>
                {amHost ? (
                  <>
                    <span className="muted grow" style={{ fontSize: 13 }}>
                      {problem ?? 'Everyone is ready!'}
                    </span>
                    <button className="btn btn-primary btn-lg" disabled={!!problem} onClick={() => void act(EV.roomStart)}>
                      ▶ Start game
                    </button>
                  </>
                ) : (
                  <>
                    <span className="muted grow" style={{ fontSize: 13 }}>
                      {me?.ready ? 'Waiting for the host to start…' : 'Ready up when you are set.'}
                    </span>
                    <button className={`btn btn-lg ${me?.ready ? '' : 'btn-green'}`} onClick={() => void act(EV.roomReady, { ready: !me?.ready })}>
                      {me?.ready ? 'Not ready' : '✔ Ready'}
                    </button>
                  </>
                )}
              </div>
            </div>

            <Settings room={room} amHost={amHost} />
          </div>

          <div className="col" style={{ gap: 18 }}>
            <div className="panel">
              {user.guest ? (
                <>
                  <div className="panel-title">✉️ Invite</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Share the room code or invite link. Register an account to invite friends directly in the app.
                  </div>
                </>
              ) : (
                <FriendsPanel inviteMode />
              )}
            </div>
            <div className="panel chat">
              <div className="panel-title">💬 Room chat</div>
              <ChatLog messages={chat} />
              <ChatInput ev={EV.roomChat} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
