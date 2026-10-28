// The home hub: top HUD (icon, level/XP, currencies, trophies) + tab content + bottom nav.
import { useState, type FormEvent } from 'react';
import { api, logout, switchAccount } from '../../net';
import { ThemePicker } from '../components';
import { store, toast, useStore, type HubTab } from '../../store';
import type { PublicUser } from '../../../shared/types';
import { BattleTab } from './BattleTab';
import { CurrencyChip, NavBadge, ProfileIcon } from './bits';
import { CollectionTab } from './CollectionTab';
import { ProgressTab } from './ProgressTab';
import { ShopTab } from './ShopTab';
import { SocialTab } from './SocialTab';

export function HudBar() {
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const connected = useStore((s) => s.connected);
  const devTools = useStore((s) => s.serverInfo?.devTools ?? false);
  const view = useStore((s) => s.view);
  const incoming = useStore((s) => s.social.incoming.length);
  if (!user) return null;
  return (
    <div className="hudbar">
      <div className="pchip" onClick={() => store.set({ tab: 'collection' })} title="Your profile">
        <ProfileIcon icon={profile?.icon ?? 'shield'} level={profile?.level ?? 1} />
        <div>
          <div className="row" style={{ gap: 6 }}>
            <b style={{ fontSize: 15 }}>{user.name}</b>
            {user.guest && <span className="tag-guest">guest</span>}
          </div>
          {profile ? (
            <div className="row" style={{ gap: 6, marginTop: 3 }}>
              <div className="xpbar" title={`${profile.xpInto} / ${profile.xpNeed} XP`}>
                <div style={{ width: `${profile.xpNeed ? (profile.xpInto / profile.xpNeed) * 100 : 100}%` }} />
              </div>
              <span className="dim" style={{ fontSize: 10 }}>
                {profile.xpInto}/{profile.xpNeed}
              </span>
            </div>
          ) : (
            <div className="dim" style={{ fontSize: 11 }}>
              Guest — no progression
            </div>
          )}
        </div>
      </div>
      <span className="spacer" />
      {profile && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <CurrencyChip kind="coins" value={profile.coins} />
          <CurrencyChip kind="gems" value={profile.gems} />
          <CurrencyChip kind="trophy" value={profile.duel} sub="1v1" />
          <CurrencyChip kind="trophy" value={profile.team} sub="2v2" />
        </div>
      )}
      <span className="spacer" />
      <span className="conn" title={connected ? 'Connected' : 'Reconnecting…'}>
        <span className={`dot ${connected ? 'online' : ''}`} />
      </span>
      {!user.guest && view !== 'menu' && (
        <button className="btn btn-sm" onClick={() => store.set({ friendsOpen: !store.get().friendsOpen })}>
          👥 Friends
          {incoming > 0 && <span className="badge gold">{incoming}</span>}
        </button>
      )}
      {devTools && (
        <button className="btn btn-sm" style={{ borderColor: '#ff7a3c', color: '#ffb08a' }} onClick={() => store.set({ devOpen: !store.get().devOpen })} title="Dev tools (`)">
          🛠 Dev
        </button>
      )}
      <ThemePicker />
      <button
        className="btn btn-sm btn-ghost"
        title="Use a different account in this tab (other tabs stay logged in)"
        onClick={() => {
          if (confirmLeaveUnsecured(user, 'switch')) switchAccount();
        }}
      >
        <span className="wide-only">Switch account</span>
        <span className="narrow-only">Switch</span>
      </button>
      <button
        className="btn btn-sm"
        onClick={() => {
          if (confirmLeaveUnsecured(user, 'logout')) void logout();
        }}
      >
        Log out
      </button>
    </div>
  );
}

/** A saved player without a password is only reachable through this browser's token. */
function isUnsecured(user: PublicUser | null): boolean {
  return !!user && !user.guest && !user.secured;
}

/** Warn before leaving a player that has no password. Returns false when the player cancels. */
function confirmLeaveUnsecured(user: PublicUser, action: 'logout' | 'switch'): boolean {
  if (!isUnsecured(user)) return true;
  const text =
    action === 'logout'
      ? `"${user.name}" has no password. After logging out, this player cannot be recovered and its progress is lost.\n\nSet a password on the Battle tab first, or press OK to log out anyway.`
      : `"${user.name}" has no password. If you start or log in as another player in this tab, you may not be able to get back to "${user.name}".\n\nSet a password on the Battle tab first, or press OK to switch anyway.`;
  return window.confirm(text);
}

/** Home-tab nudge for passwordless device accounts: add a password to play anywhere. */
export function SecureCallout() {
  const user = useStore((s) => s.user);
  const token = useStore((s) => s.token);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user || !token || !isUnsecured(user)) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) return setError('Passwords do not match');
    setBusy(true);
    const r = await api.setPassword(token, password);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPassword('');
    setPassword2('');
    store.set((s) => ({ user: s.user ? { ...s.user, secured: true } : s.user }));
    toast('success', `Password set — log in as ${user.name} on any device`);
  };

  return (
    <div className="callout" style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 8 }}>
        🔐 <b>Secure your progress.</b> Set a password so you can play on another device or recover your player if your browser data is cleared.
      </div>
      <form onSubmit={submit}>
        {/* lets password managers save the login under the right name */}
        <input type="text" autoComplete="username" value={user.name} readOnly hidden />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Password (at least 4 characters)"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ minWidth: 160 }}
          />
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm password"
            aria-label="Confirm password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            style={{ minWidth: 160 }}
          />
          <button className="btn btn-primary btn-sm" disabled={busy || !password || !password2}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </div>
        {error && (
          <div className="form-error" style={{ margin: '8px 0 0' }}>
            {error}
          </div>
        )}
      </form>
    </div>
  );
}

const TABS: { id: HubTab; label: string; icon: string }[] = [
  { id: 'shop', label: 'Shop', icon: '🛒' },
  { id: 'collection', label: 'Collection', icon: '🃏' },
  { id: 'battle', label: 'Battle', icon: '⚔️' },
  { id: 'social', label: 'Social', icon: '👥' },
  { id: 'progress', label: 'Progress', icon: '🏆' },
];

export function BottomNav() {
  const tab = useStore((s) => s.tab);
  const badges = useStore((s) => s.profile?.badges);
  const incoming = useStore((s) => s.social.incoming.length);
  const counts: Record<HubTab, number> = {
    shop: badges?.shop ?? 0,
    collection: badges?.collection ?? 0,
    battle: badges?.battle ?? 0,
    social: incoming,
    progress: badges?.progress ?? 0,
  };
  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button key={t.id} className={`nav-btn ${t.id === 'battle' ? 'battle' : ''} ${tab === t.id ? 'active' : ''}`} onClick={() => store.set({ tab: t.id })}>
          <span className="ni">{t.icon}</span>
          {t.label}
          <NavBadge n={counts[t.id]} />
        </button>
      ))}
    </nav>
  );
}

export function GuestGate({ what }: { what: string }) {
  return (
    <div className="panel center" style={{ padding: 40 }}>
      <div style={{ fontSize: 56 }}>🔒</div>
      <h2 style={{ marginBottom: 8 }}>{what} needs an account</h2>
      <p className="muted">Guests can play friendly lobbies. Register to unlock ranked ladders, cards, rewards, quests and the Tower Pass.</p>
      <button className="btn btn-primary btn-lg" onClick={switchAccount}>
        Create an account
      </button>
    </div>
  );
}

export function Home() {
  const tab = useStore((s) => s.tab);
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const guest = !!user?.guest;
  let content;
  switch (tab) {
    case 'shop':
      content = guest ? <GuestGate what="The shop" /> : profile ? <ShopTab /> : null;
      break;
    case 'collection':
      content = guest ? <GuestGate what="Your card collection" /> : profile ? <CollectionTab /> : null;
      break;
    case 'social':
      content = <SocialTab />;
      break;
    case 'progress':
      content = guest ? <GuestGate what="Trophy Road, quests and the Tower Pass" /> : profile ? <ProgressTab /> : null;
      break;
    default:
      content = (
        <>
          <SecureCallout />
          <BattleTab />
        </>
      );
  }
  return (
    <div className="hub">
      <HudBar />
      <div className="hub-content">{content}</div>
      <BottomNav />
    </div>
  );
}
