import { DIFFICULTY, MODE_INFO, PLAYER_COLORS } from '../../shared/config';
import { MAPS } from '../../shared/maps';
import { game } from '../game/gameState';
import { leaveRoom } from '../net';
import { store, useStore } from '../store';
import { TopBar } from './App';

export function Results() {
  const r = useStore((s) => s.results);
  const user = useStore((s) => s.user);
  const room = useStore((s) => s.room);
  if (!r || !user) return null;
  const iWon = r.winners.includes(user.id);
  const coop = r.mode === 'coop';
  const title = coop ? (r.outcome === 'victory' ? 'Victory!' : 'Defeat') : iWon ? 'Victory!' : r.winners.length ? 'Defeat' : 'Draw';
  const winnerNames = r.players.filter((p) => r.winners.includes(p.id)).map((p) => p.name);
  const subtitle = coop
    ? r.outcome === 'victory'
      ? `You held the line through all ${r.wavesSurvived} waves.`
      : `Overrun on wave ${r.wave} — survived ${r.wavesSurvived} wave${r.wavesSurvived === 1 ? '' : 's'}.`
    : winnerNames.length
      ? `${winnerNames.join(' & ')} ${winnerNames.length > 1 ? 'win' : 'wins'} after ${r.wave} waves.`
      : 'Everyone fell at the same time.';
  const best = Math.max(1, ...r.players.map((p) => p.stats.damage));
  const backToLobby = () => {
    game.clear();
    store.set({ view: room ? 'lobby' : 'menu', match: null });
  };
  return (
    <>
      <TopBar />
      <div className="page" style={{ maxWidth: 980 }}>
        <div className="results-hero">
          <h1 className={title === 'Victory!' ? 'win' : 'lose'}>{title}</h1>
          <p className="muted" style={{ fontSize: 16, marginTop: 10 }}>
            {subtitle}
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
            <span className="badge gold">{MODE_INFO[r.mode].label}</span>
            <span className="badge">{MAPS[r.mapId].name}</span>
            <span className="badge">{DIFFICULTY[r.difficulty].label}</span>
            <span className="badge">
              {Math.floor(r.durationSec / 60)}m {r.durationSec % 60}s
            </span>
          </div>
        </div>
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
          {room && (
            <button className="btn btn-primary btn-lg" onClick={backToLobby}>
              ↺ Back to lobby
            </button>
          )}
          <button className="btn btn-lg" onClick={() => void leaveRoom()}>
            Main menu
          </button>
        </div>
        {room && (
          <p className="center dim" style={{ fontSize: 12, marginTop: 10 }}>
            The room stays open with the same players — head back to the lobby to play again.
          </p>
        )}
      </div>
    </>
  );
}
