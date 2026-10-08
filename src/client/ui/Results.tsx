import { useEffect, useState } from 'react';
import { DIFFICULTY, MODE_INFO, PLAYER_COLORS } from '../../shared/config';
import { MAPS } from '../../shared/maps';
import type { MatchRewards } from '../../shared/progProtocol';
import { ARENAS } from '../../shared/progression';
import { game } from '../game/gameState';
import { leaveRoom } from '../net';
import { store, toast, useStore, type Celebration } from '../store';
import { TopBar } from './App';
import { openDropFlow } from './hub/actions';
import { ArenaBadge, Confetti, CountUp, GrantedTile, Stars } from './hub/bits';

const processed = new Set<string>();

function AnimatedBar({ from, to, max, color, delay = 300 }: { from: number; to: number; max: number; color?: string; delay?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    setV(from);
    const t = window.setTimeout(() => setV(to), delay);
    return () => clearTimeout(t);
  }, [from, to, delay]);
  return (
    <div className="tbar">
      <div style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 100}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

function RewardsPanel({ rw }: { rw: MatchRewards }) {
  const t = rw.trophies;
  const arena = ARENAS[rw.arena.after];
  const next = ARENAS[rw.arena.after + 1];
  const levelUp = rw.xp.levelAfter > rw.xp.levelBefore;
  return (
    <div className="reward-panel">
      {t && (
        <div className="panel center">
          <div className="section-label" style={{ marginTop: 0 }}>
            {t.ladder === 'duel' ? 'Duel' : '2v2'} trophies {rw.vsBot && <span className="bot-tag">vs bot</span>}
          </div>
          <div className={`trophy-delta ${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : ''}`}>
            {t.delta > 0 ? '+' : t.delta === 0 ? '±' : ''}
            <CountUp value={t.delta} from={0} ms={1200} />
          </div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--trophy)' }}>
            🏆 <CountUp value={t.after} from={t.before} ms={1200} />
          </div>
          <div style={{ marginTop: 8 }}>
            {next ? (
              <>
                <AnimatedBar from={Math.max(0, t.before - arena.trophies)} to={Math.max(0, t.after - arena.trophies)} max={next.trophies - arena.trophies} />
                <div className="hint" style={{ marginTop: 4 }}>
                  {next.trophies - Math.max(t.after, arena.trophies)} to {next.emoji} {next.name}
                </div>
              </>
            ) : (
              <ArenaBadge arena={rw.arena.after} />
            )}
          </div>
          {t.delta === 0 && !rw.won && t.before > 0 && arena.trophies > 0 && <div className="hint">Arena gate: you can't drop below {arena.name}.</div>}
        </div>
      )}
      <div className="panel center">
        <div className="section-label" style={{ marginTop: 0 }}>
          Experience
        </div>
        <div style={{ fontFamily: 'var(--display)', fontSize: 30, color: '#8fb6ff' }}>
          +<CountUp value={rw.xp.gained} from={0} /> XP
        </div>
        <AnimatedBar from={levelUp ? 0 : rw.xp.intoBefore} to={rw.xp.intoAfter} max={rw.xp.needAfter || 1} color="linear-gradient(90deg,#5b8cff,#8fb6ff)" />
        <div className="hint" style={{ marginTop: 4 }}>
          {levelUp ? `LEVEL UP! You're level ${rw.xp.levelAfter}` : `Level ${rw.xp.levelAfter} · ${rw.xp.intoAfter}/${rw.xp.needAfter}`}
        </div>
        <div className="hint">🎟️ +{rw.tokens} pass tokens</div>
      </div>
      {rw.quests.length > 0 && (
        <div className="panel">
          <div className="section-label" style={{ marginTop: 0 }}>
            Quest progress
          </div>
          <div className="col" style={{ gap: 6 }}>
            {rw.quests.map((q) => (
              <div key={q.id} className={`quest-chip ${q.completed ? 'done' : ''}`}>
                <span>{q.completed ? '🎉' : '📌'}</span>
                <span className="grow ellipsis">{q.text}</span>
                <div className="mini-bar" style={{ maxWidth: 80 }}>
                  <div style={{ width: `${(q.after / q.target) * 100}%` }} />
                </div>
                <span className="dim" style={{ fontSize: 11 }}>
                  +{(q.after - q.before).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="panel center">
        <div className="section-label" style={{ marginTop: 0 }}>
          Rewards
        </div>
        {rw.drop.granted && rw.drop.dropId ? (
          <>
            <div style={{ fontSize: 54, animation: 'wiggle 1.4s ease-in-out infinite' }}>🎁</div>
            <button className="btn btn-primary btn-lg" onClick={() => void openDropFlow(rw.drop.dropId!)}>
              Claim drop
            </button>
            <div className="hint" style={{ marginTop: 4 }}>
              {rw.drop.earnedToday}/8 drops today
            </div>
          </>
        ) : rw.drop.capped ? (
          <div className="muted">Daily drop limit reached (8/8) — more tomorrow!</div>
        ) : (
          <div className="muted">{rw.won ? 'No drop this time.' : 'Win to earn a reward drop.'}</div>
        )}
        {rw.stars && (
          <div style={{ marginTop: 8 }}>
            {MAPS[rw.stars.mapId].name}: <Stars n={rw.stars.after} /> {rw.stars.after > rw.stars.before && <span className="badge gold">new stars!</span>}
          </div>
        )}
        {rw.endlessRecord !== null && <div className="badge gold" style={{ marginTop: 8 }}>New endless record: wave {rw.endlessRecord}!</div>}
        {rw.firstClear && (
          <div className="col" style={{ alignItems: 'center', marginTop: 8 }}>
            <div className="hint">First clear bonus</div>
            <div className="granted-list">
              {rw.firstClear.map((g, i) => (
                <GrantedTile key={i} g={g} delay={0.3 + i * 0.1} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Results() {
  const r = useStore((s) => s.results);
  const user = useStore((s) => s.user);
  const room = useStore((s) => s.room);
  const rewards = useStore((s) => s.rewards);
  const rw = rewards && r && rewards.matchId === r.matchId ? rewards : null;

  useEffect(() => {
    if (!rw || processed.has(rw.matchId)) return;
    processed.add(rw.matchId);
    for (const q of rw.quests) if (q.completed) toast('success', `Quest complete! ${q.text}`);
    const cel: Celebration[] = [];
    if (rw.levelUps.length) cel.push({ kind: 'levelup' as const, levelUps: rw.levelUps });
    if (rw.arena.unlocked) cel.push({ kind: 'arena' as const, arena: rw.arena.after });
    if (cel.length) window.setTimeout(() => store.set((s) => ({ celebrations: [...s.celebrations, ...cel] })), 1600);
  }, [rw]);

  if (!r || !user) return null;
  const iWon = r.winners.includes(user.id) && (rw ? rw.won : true);
  const coop = r.mode === 'coop';
  const title = coop ? (r.outcome === 'victory' ? 'Victory!' : r.endless ? 'Run over' : 'Defeat') : iWon ? 'Victory!' : r.winners.length ? 'Defeat' : 'Draw';
  const winnerNames = r.players.filter((p) => r.winners.includes(p.id)).map((p) => p.name);
  const subtitle = coop
    ? r.endless
      ? `You held out for ${r.wavesSurvived} wave${r.wavesSurvived === 1 ? '' : 's'}.`
      : r.outcome === 'victory'
        ? `You held the line through all ${r.wavesSurvived} waves.`
        : `Overrun on wave ${r.wave} — survived ${r.wavesSurvived} wave${r.wavesSurvived === 1 ? '' : 's'}.`
    : winnerNames.length
      ? `${winnerNames.join(' & ')} ${winnerNames.length > 1 ? 'win' : 'wins'} after ${r.wave} waves.`
      : 'Everyone fell at the same time.';
  const best = Math.max(1, ...r.players.map((p) => p.stats.damage));
  const home = () => {
    game.clear();
    store.set({ view: 'menu', match: null, results: null });
  };
  const backToLobby = () => {
    game.clear();
    store.set({ view: room ? 'lobby' : 'menu', match: null });
  };
  return (
    <>
      <TopBar />
      {title === 'Victory!' && <Confetti n={90} />}
      <div className="page" style={{ maxWidth: 1080 }}>
        <div className="results-hero">
          <h1 className={title === 'Victory!' ? 'win' : 'lose'}>{title}</h1>
          <p className="muted" style={{ fontSize: 16, marginTop: 10 }}>
            {subtitle}
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
            {r.ranked && <span className="badge gold">🏆 Ranked</span>}
            {r.vsBot && <span className="bot-tag">vs bot</span>}
            <span className="badge">{r.ranked ? (r.mode === 'ffa' ? 'Ranked Duel' : 'Ranked 2v2') : r.endless ? 'Endless co-op' : MODE_INFO[r.mode].label}</span>
            <span className="badge">{MAPS[r.mapId].name}</span>
            <span className="badge">{DIFFICULTY[r.difficulty].label}</span>
            <span className="badge">
              {Math.floor(r.durationSec / 60)}m {r.durationSec % 60}s
            </span>
          </div>
        </div>
        {rw && <RewardsPanel rw={rw} />}
        {!rw && !user.guest && <div className="center dim" style={{ marginBottom: 12 }}>Tallying rewards…</div>}
        <div className="panel">
          <table className="results-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Kills</th>
                <th>Damage dealt</th>
                <th>Money earned</th>
                {!coop && <th>Troops sent</th>}
                <th>Towers built</th>
                {!coop && <th>Eliminated</th>}
              </tr>
            </thead>
            <tbody>
              {r.players
                .slice()
                .sort((a, b) => Number(r.winners.includes(b.id)) - Number(r.winners.includes(a.id)) || b.stats.damage - a.stats.damage)
                .map((p) => (
                  <tr key={p.id} className={r.winners.includes(p.id) ? 'winner' : ''}>
                    <td>
                      <div className="row">
                        <span className="swatch" style={{ background: PLAYER_COLORS[p.color] }} />
                        <b>{p.name}</b>
                        {p.bot && <span className="bot-tag">bot</span>}
                        {p.guest && <span className="tag-guest">guest</span>}
                        {r.winners.includes(p.id) && !coop && <span>🏆</span>}
                        {p.id === user.id && <span className="dim">(you)</span>}
                      </div>
                    </td>
                    <td>{p.stats.kills}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <div style={{ width: 70, height: 6, borderRadius: 4, background: '#0b1120', overflow: 'hidden' }}>
                          <div style={{ width: `${(p.stats.damage / best) * 100}%`, height: '100%', background: PLAYER_COLORS[p.color] }} />
                        </div>
                        {p.stats.damage.toLocaleString()}
                      </div>
                    </td>
                    <td>${p.stats.earned.toLocaleString()}</td>
                    {!coop && <td>{p.stats.sent}</td>}
                    <td>{p.stats.built}</td>
                    {!coop && <td>{p.eliminatedWave ? `wave ${p.eliminatedWave}` : '—'}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 22, gap: 12 }}>
          {r.ranked ? (
            <button className="btn btn-primary btn-lg" onClick={home}>
              Continue
            </button>
          ) : (
            <>
              {room && (
                <button className="btn btn-primary btn-lg" onClick={backToLobby}>
                  ↺ Back to lobby
                </button>
              )}
              <button
                className="btn btn-lg"
                onClick={() => {
                  if (room) void leaveRoom();
                  else home();
                }}
              >
                Main menu
              </button>
            </>
          )}
        </div>
        {room && !r.ranked && (
          <p className="center dim" style={{ fontSize: 12, marginTop: 10 }}>
            The room stays open with the same players — head back to the lobby to play again.
          </p>
        )}
      </div>
    </>
  );
}
