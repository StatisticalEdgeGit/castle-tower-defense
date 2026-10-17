import { Component, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { AuthScreen } from './AuthScreen';
import { ConfirmModal, InvitePopups, JoinErrorModal, Toasts } from './components';
import { FriendsPanel } from './FriendsPanel';
import { GameScreen } from './GameScreen';
import { DevPanel } from './hub/DevPanel';
import { Home, HudBar } from './hub/Home';
import { MatchmakingOverlay, VsSplash } from './hub/overlays';
import { CelebrationHost, PartyInvitePopups, RevealHost, SeasonNoticeModal } from './hub/reveals';
import { Lobby } from './Lobby';
import { Results } from './Results';

/** Top bar used outside the home hub (lobby, results). */
export function TopBar() {
  return <HudBar />;
}

/** Keeps a render crash on one screen from blanking the whole page. */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="panel" style={{ maxWidth: 440 }}>
          <h2>This screen hit a snag</h2>
          <p className="muted">Reload the page. If you were in a match, your seat stays open for about a minute and your turrets keep firing.</p>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

/** Shown after the socket drops, until it connects again. */
function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user);
  const [wasConnected, setWasConnected] = useState(false);
  useEffect(() => {
    if (connected) setWasConnected(true);
  }, [connected]);
  if (!user || !wasConnected || connected || view === 'auth' || view === 'boot') return null;
  return (
    <div className="conn-banner" role="status">
      Reconnecting to the server… your seat is held.
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const friendsOpen = useStore((s) => s.friendsOpen);
  const user = useStore((s) => s.user);
  let screen;
  switch (view) {
    case 'boot':
      screen = (
        <div className="auth-wrap">
          <div className="muted">Loading…</div>
        </div>
      );
      break;
    case 'auth':
      screen = <AuthScreen />;
      break;
    case 'menu':
      screen = <Home />;
      break;
    case 'lobby':
      screen = <Lobby />;
      break;
    case 'game':
      screen = <GameScreen />;
      break;
    case 'results':
      screen = <Results />;
      break;
  }
  return (
    <>
      <ConnectionBanner />
      <ScreenBoundary>{screen}</ScreenBoundary>
      {friendsOpen && user && !user.guest && view !== 'menu' && (
        <div className="panel drawer">
          <FriendsPanel showClose />
        </div>
      )}
      {user && view !== 'auth' && (
        <>
          <MatchmakingOverlay />
          <VsSplash />
          <RevealHost />
          <CelebrationHost />
          <SeasonNoticeModal />
          <PartyInvitePopups />
          <DevPanel />
        </>
      )}
      <InvitePopups />
      <ConfirmModal />
      <JoinErrorModal />
      <Toasts />
    </>
  );
}
