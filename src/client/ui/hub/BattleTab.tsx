// Battle tab: arena banner + trophy progress, the big BATTLE button with a mode selector,
// daily drops counter, unopened drops/chests and quest chips.
import { useState } from 'react';
import { DIFFICULTY } from '../../../shared/config';
import { MAPS } from '../../../shared/maps';
import { ARENAS, CAMPAIGN_ORDER, CHESTS, firstClearReward, MATCHMAKING, STARS_FOR, STARS_TO_UNLOCK_NEXT } from '../../../shared/progression';
import { EV } from '../../../shared/protocol';
import type { Difficulty, MapId } from '../../../shared/types';
import { store, toast, useStore } from '../../store';
import { MapThumb, PresenceDot } from '../components';
import { BrowseGames, CreateGame, JoinByCode, ProfileCard } from '../MainMenu';
import { openChestFlow, openDropFlow, progAct } from './actions';
import { ChestArt, ProfileIcon, ProgressBar, RewardPill, Stars } from './bits';

type BattleMode = 'duel' | 'team' | 'campaign' | 'endless' | 'friendly';

const MODES: { id: BattleMode; icon: string; label: string; sub: string; account: boolean }[] = [
  { id: 'duel', icon: '⚔️', label: 'Ranked Duel', sub: '1v1 · trophies', account: true },
  { id: 'team', icon: '🛡️', label: 'Ranked 2v2', sub: 'solo or with a friend', account: true },
  { id: 'campaign', icon: '🗺️', label: 'Co-op Campaign', sub: 'earn ★ on every map', account: true },
  { id: 'endless', icon: '♾️', label: 'Endless Co-op', sub: 'how far can you go?', account: true },
  { id: 'friendly', icon: '🧪', label: 'Sandbox', sub: 'all turrets · any map', account: false },
];

function loadMode(): BattleMode {
  try {
    const m = localStorage.getItem('ctd.mode') as BattleMode | null;
    if (m && MODES.some((x) => x.id === m)) return m;
  } catch {
    /* ignore */
  }
  return 'duel';
}

export function ArenaBanner() {
  const p = useStore((s) => s.profile);
  if (!p) return null;
  const a = ARENAS[p.arena];
  const next = ARENAS[p.arena + 1];
  const best = Math.max(p.duel, p.team);
  return (
    <div className="arena-banner" style={{ background: `linear-gradient(120deg, ${a.colors[0]}, ${a.colors[1]})` }}>
      <div className="arena-emoji">{a.emoji}</div>
      <div className="grow">
        <div className="arena-sub">Arena {a.index + 1}</div>
        <div className="arena-name">{a.name}</div>
        <div style={{ marginTop: 10, maxWidth: 520 }}>
          {next ? (
            <>
              <ProgressBar value={best - a.trophies} max={next.trophies - a.trophies} label={`🏆 ${best} / ${next.trophies}`} />
              <div style={{ fontSize: 12, marginTop: 5, opacity: 0.85 }}>
                Next: {next.emoji} {next.name} — unlocks {next.towers.length ? next.towers.join(', ') : 'glory'}
              </div>
            </>
          ) : (
            <div style={{ fontWeight: 700 }}>🏆 {best} — the top arena!</div>
          )}
        </div>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
        <span className="arena-badge" style={{ background: 'rgba(0,0,0,0.35)' }}>
          ⚔️ Duel {p.duel} · W{p.ranked.duelWins}/L{p.ranked.duelLosses}
        </span>
        <span className="arena-badge" style={{ background: 'rgba(0,0,0,0.35)' }}>
          🛡️ 2v2 {p.team} · W{p.ranked.teamWins}/L{p.ranked.teamLosses}
        </span>
        <span className="season-pill">Season {p.season.id}</span>
      </div>
    </div>
  );
}

function PartyPanel() {
  const party = useStore((s) => s.party);
  const friends = useStore((s) => s.social.friends);
  const user = useStore((s) => s.user);
  const online = friends.filter((f) => f.status !== 'offline');
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-title">🤝 Party</div>
      {party ? (
        <>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {party.members.map((m) => (
              <div key={m.id} className="row">
                <ProfileIcon icon={m.icon} level={m.level} size="sm" />
                <b>{m.name}</b>
                {m.id === party.leaderId && <span className="crown">👑</span>}
              </div>
            ))}
            <span className="spacer" />
            <button className="btn btn-sm btn-danger" onClick={() => void progAct(EV.partyLeave)}>
              Leave party
            </button>
          </div>
          {party.members.length < 2 && <div className="hint" style={{ marginTop: 6 }}>Waiting for your friend to accept…</div>}
          {party.leaderId !== user?.id && <div className="hint" style={{ marginTop: 6 }}>The party leader starts the search.</div>}
        </>
      ) : (
        <div className="hint" style={{ marginBottom: 8 }}>
          Queue solo (we'll find you a teammate — or a bot after {MATCHMAKING.botTimeoutSec}s), or invite an online friend:
        </div>
      )}
      {(!party || party.members.length < 2) && (
        <div className="col" style={{ gap: 4, marginTop: 8 }}>
          {online.length === 0 && <div className="dim" style={{ fontSize: 12 }}>No friends online right now.</div>}
          {online.map((f) => (
            <div key={f.id} className="friend-row">
              <PresenceDot status={f.status} />
              <span className="grow">{f.name}</span>
              <button className="btn btn-sm btn-primary" onClick={async () => (await progAct(EV.partyInvite, { userId: f.id })).ok && toast('success', `Party invite sent to ${f.name}`)}>
                Invite
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignPicker({ endless, mapId, setMap, difficulty, setDifficulty }: { endless: boolean; mapId: MapId; setMap: (m: MapId) => void; difficulty: Difficulty; setDifficulty: (d: Difficulty) => void }) {
  const p = useStore((s) => s.profile)!;
  return (
    <>
      <div className="map-grid" style={{ marginTop: 12 }}>
        {CAMPAIGN_ORDER.map((id, i) => {
          const unlocked = endless ? p.endlessUnlocked : p.unlockedMaps.includes(id);
          const stars = p.campaign[id] ?? 0;
          return (
            <button key={id} className={`map-card ${mapId === id ? 'active' : ''}`} style={{ opacity: unlocked ? 1 : 0.5 }} onClick={() => unlocked && setMap(id)}>
              <MapThumb mapId={id} width={190} />
              <div className="meta">
                <span className="name">{MAPS[id].name}</span>
                {endless ? <span className="badge gold">Best {p.endlessBest[id] ?? 0}</span> : <Stars n={stars} />}
              </div>
              <div className="fw">
                {unlocked
                  ? endless
                    ? 'No final wave'
                    : `Final wave ${MAPS[id].finalWave}`
                  : endless
                    ? '🔒 Earn 2★ on any map'
                    : `🔒 ${STARS_TO_UNLOCK_NEXT}★ on ${MAPS[CAMPAIGN_ORDER[i - 1]]?.name}`}
              </div>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 14, flexWrap: 'wrap' }}>
        <div className="seg">
          {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
            <button key={d} className={difficulty === d ? 'active' : ''} onClick={() => setDifficulty(d)}>
              {DIFFICULTY[d].label} {!endless && <span className="stars">{'★'.repeat(STARS_FOR[d])}</span>}
            </button>
          ))}
        </div>
        {!endless && !p.unlockedMaps.includes(mapId) ? null : !endless ? (
          <div className="row" style={{ gap: 6 }}>
            <span className="hint">First clear:</span>
            {firstClearReward(CAMPAIGN_ORDER.indexOf(mapId), difficulty).map((r, i) => (
              <RewardPill key={i} r={r} />
            ))}
          </div>
        ) : (
          <span className="hint">Your best runs go on the Endless leaderboard.</span>
        )}
      </div>
    </>
  );
}

function Sidebar() {
  const p = useStore((s) => s.profile);
  if (!p) return null;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="panel">
        <div className="panel-title">
          🎁 Reward drops <span className="spacer" />
          <span className="drops-counter" title={`${p.drops.earnedToday}/${p.drops.cap} drops earned today`}>
            {Array.from({ length: p.drops.cap }, (_, i) => (
              <i key={i} className={i < p.drops.earnedToday ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div className="hint" style={{ marginBottom: 8 }}>
          {p.drops.earnedToday}/{p.drops.cap} today — every win (ranked or versus) and co-op victory earns one.
        </div>
        {p.drops.pending.length + p.chests.length === 0 ? (
          <div className="dim" style={{ fontSize: 12 }}>
            Nothing to open. Go win something!
          </div>
        ) : (
          <div className="inv-row">
            {p.drops.pending.map((d) => (
              <div key={d.id} className="inv-item" onClick={() => void openDropFlow(d.id)} title={d.source}>
                <div className="big">🎁</div>
                <span>Drop</span>
                <span className="dim" style={{ fontWeight: 500 }}>
                  {d.source}
                </span>
              </div>
            ))}
            {p.chests.map((c) => (
              <div key={c.id} className="inv-item" onClick={() => void openChestFlow(c.id, c.tier)} title={c.source}>
                <div className="big" style={{ display: 'grid', placeItems: 'center' }}>
                  <ChestArt tier={c.tier} />
                </div>
                <span>{CHESTS[c.tier].name}</span>
                <span className="dim" style={{ fontWeight: 500 }}>
                  {c.source}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-title">
          📜 Daily quests
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => store.set({ tab: 'progress' })}>
            All quests →
          </button>
        </div>
        <div className="col" style={{ gap: 6 }}>
          {p.quests.daily.map((q) => (
            <div key={q.id} className={`quest-chip ${q.progress >= q.target ? 'done' : ''}`}>
              <span>{q.claimed ? '✅' : q.progress >= q.target ? '🎉' : '📌'}</span>
              <span className="grow ellipsis">{q.text}</span>
              <div className="mini-bar" style={{ maxWidth: 70 }}>
                <div style={{ width: `${(q.progress / q.target) * 100}%` }} />
              </div>
              <span className="dim" style={{ fontSize: 11 }}>
                {Math.min(q.progress, q.target).toLocaleString()}/{q.target.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BattleTab() {
  const user = useStore((s) => s.user);
  const p = useStore((s) => s.profile);
  const party = useStore((s) => s.party);
  const [mode, setModeState] = useState<BattleMode>(() => (user?.guest ? 'friendly' : loadMode()));
  const [mapId, setMap] = useState<MapId>('greenfield');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [busy, setBusy] = useState(false);
  const guest = !!user?.guest;
  const setMode = (m: BattleMode) => {
    setModeState(m);
    try {
      localStorage.setItem('ctd.mode', m);
    } catch {
      /* ignore */
    }
  };
  const effective: BattleMode = guest ? 'friendly' : mode;

  const battle = async () => {
    setBusy(true);
    try {
      if (effective === 'duel' || effective === 'team') await progAct(EV.mmQueue, { mode: effective });
      else if (effective === 'campaign' || effective === 'endless') {
        await progAct(EV.roomCreate, { mode: 'coop', mapId, difficulty, isPublic: false, endless: effective === 'endless' });
      }
    } finally {
      setBusy(false);
    }
  };

  const canBattle =
    effective === 'duel' ||
    (effective === 'team' && (!party || (party.members.length === 2 && party.leaderId === user?.id)) && !(party && party.members.length === 1)) ||
    (effective === 'campaign' && !!p?.unlockedMaps.includes(mapId)) ||
    (effective === 'endless' && !!p?.endlessUnlocked);

  return (
    <>
      {p ? (
        <ArenaBanner />
      ) : (
        <div className="arena-banner" style={{ background: 'linear-gradient(120deg, #2f7d46, #174a2a)' }}>
          <div className="arena-emoji">🏰</div>
          <div>
            <div className="arena-name">Welcome, {user?.name}!</div>
            <div style={{ opacity: 0.85 }}>Guests can play friendly lobbies. Register to climb the ranked ladders.</div>
          </div>
        </div>
      )}
      <div className="battle-grid">
        <div className="col" style={{ gap: 14 }}>
          <div className="mode-chips">
            {MODES.map((m) => {
              const locked = (m.account && guest) || (m.id === 'endless' && p && !p.endlessUnlocked);
              return (
                <button key={m.id} className={`mode-chip ${effective === m.id ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => (m.account && guest ? toast('info', 'Create an account to play this mode') : setMode(m.id))}>
                  <span className="mi">{m.icon}</span>
                  <b>{m.label}</b>
                  <span>{locked && m.id === 'endless' && !guest ? '🔒 needs 2★ on a map' : m.sub}</span>
                </button>
              );
            })}
          </div>

          {effective !== 'friendly' && (
            <div className="panel">
              <div className="row" style={{ alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <button className="battle-btn" disabled={busy || !canBattle} onClick={() => void battle()}>
                  BATTLE
                  <small>{MODES.find((m) => m.id === effective)?.label}</small>
                </button>
                <div className="grow" style={{ minWidth: 220 }}>
                  {effective === 'duel' && (
                    <>
                      <h3>Ranked Duel</h3>
                      <p className="muted" style={{ margin: '4px 0' }}>
                        1v1 versus with ranked rules: waves every 20 s, sudden death after wave 18. Win to climb, unlock arenas and earn drops. Your card levels count.
                      </p>
                      <div className="hint">Matched by trophies (±100, widening). No opponent in {MATCHMAKING.botTimeoutSec}s → a bot of your level steps in.</div>
                    </>
                  )}
                  {effective === 'team' && (
                    <>
                      <h3>Ranked 2v2</h3>
                      <p className="muted" style={{ margin: '4px 0' }}>
                        Teams share a board and send troops at each other. Trophy changes use the other team's average.
                      </p>
                      {party && party.members.length === 2 ? (
                        <div className="hint">Queuing as a party of 2.</div>
                      ) : (
                        <div className="hint">Queuing solo — teammate found by matchmaking (or a bot).</div>
                      )}
                    </>
                  )}
                  {effective === 'campaign' && (
                    <>
                      <h3>Co-op Campaign</h3>
                      <p className="muted" style={{ margin: '4px 0' }}>
                        Clear maps with friends (or alone): Easy ★, Normal ★★, Hard ★★★. 2★ unlocks the next map. Creates a private lobby you can invite friends to.
                      </p>
                    </>
                  )}
                  {effective === 'endless' && (
                    <>
                      <h3>Endless Co-op</h3>
                      <p className="muted" style={{ margin: '4px 0' }}>
                        No final wave. Survive as long as you can — the best run for each team lands on the leaderboard.
                      </p>
                    </>
                  )}
                </div>
              </div>
              {(effective === 'campaign' || effective === 'endless') && p && (
                <CampaignPicker endless={effective === 'endless'} mapId={mapId} setMap={setMap} difficulty={difficulty} setDifficulty={setDifficulty} />
              )}
            </div>
          )}
          {effective === 'team' && !guest && <PartyPanel />}
          {effective === 'friendly' && (
            <>
              <CreateGame />
              <JoinByCode />
              <BrowseGames />
            </>
          )}
        </div>
        <div className="col" style={{ gap: 14 }}>
          {p && <Sidebar />}
          <ProfileCard />
        </div>
      </div>
    </>
  );
}
