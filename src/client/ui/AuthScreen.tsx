import { useState, type FormEvent } from 'react';
import { api, onLoggedIn } from '../net';
import { useStore } from '../store';

type Tab = 'login' | 'register' | 'guest';

export function AuthScreen() {
  const pendingJoin = useStore((s) => s.pendingJoin);
  const [tab, setTab] = useState<Tab>(pendingJoin ? 'guest' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === 'register' && password !== password2) return setError('Passwords do not match');
    setBusy(true);
    const r =
      tab === 'login' ? await api.login(username.trim(), password) : tab === 'register' ? await api.register(username.trim(), password) : await api.guest(guestName.trim());
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
              You've been invited to game <b className="mono">{pendingJoin}</b>. Log in, register, or play as a guest — you'll join automatically.
            </div>
          )}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {(['login', 'register', 'guest'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`tab ${tab === t ? 'active' : ''}`}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
              >
                {t === 'login' ? 'Log in' : t === 'register' ? 'Register' : 'Play as guest'}
              </button>
            ))}
          </div>
          <form onSubmit={submit}>
            {tab !== 'guest' ? (
              <>
                <div className="field">
                  <label>Username</label>
                  <input
                    className="input"
                    autoFocus
                    autoComplete="username"
                    value={username}
                    maxLength={16}
                    placeholder="3–16 letters, digits or _"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    className="input"
                    type="password"
                    autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    placeholder={tab === 'register' ? 'At least 4 characters' : ''}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {tab === 'register' && (
                  <div className="field">
                    <label>Confirm password</label>
                    <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="field">
                  <label>Display name</label>
                  <input
                    className="input"
                    autoFocus
                    value={guestName}
                    maxLength={16}
                    placeholder="What should others call you?"
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                  Guests can join games by link or code and play normally, but can't add friends and stats aren't saved.
                </p>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Please wait…' : tab === 'login' ? 'Log in' : tab === 'register' ? 'Create account' : 'Play as guest'}
            </button>
          </form>
        </div>
        <p className="dim center" style={{ fontSize: 12, marginTop: 14 }}>
          Local test build — accounts are stored on this server only.
        </p>
      </div>
    </div>
  );
}
