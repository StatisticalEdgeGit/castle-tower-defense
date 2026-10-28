import { useState, type FormEvent } from 'react';
import { api, onLoggedIn } from '../net';
import { useStore } from '../store';

// 'start' = pick a player name (passwordless device account, the default);
// 'login' = username + password for players who secured their account.
type Mode = 'start' | 'login';

export function AuthScreen() {
  const pendingJoin = useStore((s) => s.pendingJoin);
  const [mode, setMode] = useState<Mode>('start');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = mode === 'start' ? await api.start(name.trim()) : await api.login(username.trim(), password);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onLoggedIn(r.token, r.user, r.stats);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="hero-title">Castle Tower Defense</div>
        <div className="hero-sub">Build, defend, and send armies at your friends. Up to 4 players.</div>
        <div className="panel">
          {pendingJoin && (
            <div className="callout">
              You've been invited to game <b className="mono">{pendingJoin}</b>.{' '}
              {mode === 'start' ? "Pick a name and you'll join automatically." : "Log in and you'll join automatically."}
            </div>
          )}
          <form onSubmit={submit}>
            {mode === 'start' ? (
              <div className="field">
                <label>Pick a player name</label>
                <input
                  className="input"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={name}
                  maxLength={16}
                  placeholder="3–16 letters, digits or _"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="field">
                  <label>Username</label>
                  <input
                    className="input"
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={username}
                    maxLength={16}
                    placeholder="3–16 letters, digits or _"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'start' ? 'Play' : 'Log in'}
            </button>
          </form>
          {mode === 'start' ? (
            <>
              <p className="muted center" style={{ fontSize: 12, margin: '10px 0 0' }}>
                No password needed — this browser remembers you. You can add a password later to play on other devices.
              </p>
              <div className="center" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => switchMode('login')}>
                  Already have a password? Log in
                </button>
              </div>
            </>
          ) : (
            <div className="center" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => switchMode('start')}>
                ← New here? Just pick a name
              </button>
            </div>
          )}
        </div>
        <p className="dim center" style={{ fontSize: 12, marginTop: 14 }}>
          Local test build — accounts are stored on this server only.
        </p>
      </div>
    </div>
  );
}
