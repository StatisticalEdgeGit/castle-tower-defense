import { useState } from 'react';
import { EV } from '../../shared/protocol';
import { act, request } from '../net';
import { confirmDialog, store, toast, useStore } from '../store';
import { PRESENCE_LABEL, PresenceDot } from './components';

export function FriendsPanel({ showClose = false, inviteMode = false }: { showClose?: boolean; inviteMode?: boolean }) {
  const social = useStore((s) => s.social);
  const user = useStore((s) => s.user);
  const room = useStore((s) => s.room);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<Record<string, number>>({});

  if (!user) return null;
  if (user.guest) {
    return (
      <div>
        <div className="panel-title">👥 Friends</div>
        <div className="empty">Guests can't add friends. Register an account to build a friends list and send in-app invites.</div>
      </div>
    );
  }

  const canInvite = !!room && room.state === 'waiting' && room.players.length < room.maxPlayers;
  const add = async () => {
    const u = name.trim();
    if (!u) return;
    setBusy(true);
    const r = await request<{ autoAccepted: boolean }>(EV.friendRequest, { username: u });
    setBusy(false);
    if (!r.ok) return toast('error', r.error);
    setName('');
    if (!r.autoAccepted) toast('success', `Friend request sent to ${u}`);
  };
  const invite = async (id: string, fname: string) => {
    const r = await act(EV.inviteSend, { userId: id });
    if (r.ok) {
      toast('success', `Invite sent to ${fname}`);
      setInvited((m) => ({ ...m, [id]: Date.now() }));
    }
  };
  const online = social.friends.filter((f) => f.status !== 'offline').length;

  return (
    <div>
      <div className="panel-title">
        👥 Friends <span className="count">{online} online</span>
        <span className="spacer" />
        {showClose && (
          <button className="btn btn-sm btn-ghost" onClick={() => store.set({ friendsOpen: false })}>
            ✕
          </button>
        )}
      </div>
      {!inviteMode && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Add friend by username"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') void add();
            }}
          />
          <button className="btn btn-blue" disabled={busy || !name.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
      )}

      {!inviteMode && social.incoming.length > 0 && (
        <>
          <div className="section-label">Requests ({social.incoming.length})</div>
          {social.incoming.map((r) => (
            <div className="friend-row" key={r.userId}>
              <span style={{ fontSize: 16 }}>📨</span>
              <b className="grow ellipsis">{r.name}</b>
              <div className="actions">
                <button className="btn btn-sm btn-green" onClick={() => void act(EV.friendRespond, { userId: r.userId, accept: true })}>
                  Accept
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => void act(EV.friendRespond, { userId: r.userId, accept: false })}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {!inviteMode && social.outgoing.length > 0 && (
        <>
          <div className="section-label">Sent requests</div>
          {social.outgoing.map((r) => (
            <div className="friend-row" key={r.userId}>
              <span className="dim">⏳</span>
              <span className="grow ellipsis">{r.name}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => void act(EV.friendCancel, { userId: r.userId })}>
                Cancel
              </button>
            </div>
          ))}
        </>
      )}

      <div className="section-label">Friends ({social.friends.length})</div>
      {social.friends.length === 0 && <div className="empty">No friends yet. Add someone by their username!</div>}
      {social.friends.map((f) => {
        const inRoom = room?.players.some((p) => p.id === f.id);
        const recently = invited[f.id] && Date.now() - invited[f.id] < 60_000;
        return (
          <div className="friend-row" key={f.id}>
            <PresenceDot status={f.status} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 600 }}>
                {f.name}
              </div>
              <div className="status">{PRESENCE_LABEL[f.status]}</div>
            </div>
            <div className="actions">
              {canInvite && f.status !== 'offline' && !inRoom && (
                <button className="btn btn-sm btn-primary" disabled={!!recently} onClick={() => void invite(f.id, f.name)}>
                  {recently ? 'Invited' : 'Invite'}
                </button>
              )}
              {inRoom && <span className="badge blue">In room</span>}
              {!inviteMode && f.status === 'online' && (
                <button
                  className="btn btn-sm"
                  title="Invite to a party for Ranked 2v2"
                  onClick={async () => {
                    const r = await act(EV.partyInvite, { userId: f.id });
                    if (r.ok) toast('success', `Party invite sent to ${f.name}`);
                  }}
                >
                  🤝 Party
                </button>
              )}
              {!inviteMode && (
                <button
                  className="btn btn-sm btn-ghost"
                  title="Remove friend"
                  onClick={() =>
                    confirmDialog({
                      title: `Remove ${f.name}?`,
                      text: 'You can always send a new friend request later.',
                      confirmLabel: 'Remove',
                      onConfirm: () => void act(EV.friendRemove, { userId: f.id }),
                    })
                  }
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
