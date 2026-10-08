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
      {screen}
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
