import { useStore, store } from '../store';
import { logout, switchAccount } from '../net';
import { AuthScreen } from './AuthScreen';
import { ConfirmModal, InvitePopups, JoinErrorModal, Toasts } from './components';
import { FriendsPanel } from './FriendsPanel';
import { GameScreen } from './GameScreen';
import { Lobby } from './Lobby';
import { MainMenu } from './MainMenu';
import { Results } from './Results';

export function TopBar() {
  const user = useStore((s) => s.user);
  const connected = useStore((s) => s.connected);
  const incoming = useStore((s) => s.social.incoming.length);
  const friendsOpen = useStore((s) => s.friendsOpen);
  return (
    <div className="topbar">
      <div className="logo">
        <div className="mark">♜</div>
        Castle Tower Defense
      </div>
      <span className="spacer" />
      <span className="conn">
        <span className={`dot ${connected ? 'online' : ''}`} />
        {connected ? 'Connected' : 'Connecting…'}
      </span>
      {user && !user.guest && (
        <button className={`btn btn-sm ${friendsOpen ? 'active' : ''}`} onClick={() => store.set({ friendsOpen: !friendsOpen })}>
          👥 Friends
          {incoming > 0 && <span className="badge gold">{incoming}</span>}
        </button>
      )}
      {user && (
        <div className="row">
          <span style={{ fontWeight: 700 }}>{user.name}</span>
          {user.guest && <span className="tag-guest">guest</span>}
          <button className="btn btn-sm btn-ghost" title="Use a different account in this tab (other tabs stay logged in)" onClick={switchAccount}>
            Switch account
          </button>
          <button className="btn btn-sm" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      )}
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
      screen = <MainMenu />;
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
      <InvitePopups />
      <ConfirmModal />
      <JoinErrorModal />
      <Toasts />
    </>
  );
}
