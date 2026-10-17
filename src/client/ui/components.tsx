// Shared UI pieces: icons, thumbnails, toasts, modals, chat.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DIFFICULTY, MODE_INFO, PLAYER_COLORS } from '../../shared/config';
import { MAPS } from '../../shared/maps';
import { EV, type ChatMsg, type InviteInfo, type PresenceStatus } from '../../shared/protocol';
import type { EnemyType, MapId, TowerType } from '../../shared/types';
import { drawEnemy, drawTower } from '../game/art';
import { drawMapThumb } from '../game/renderer';
import { setViewTheme, useViewTheme, type ViewTheme } from '../game/viewTheme';
import { request } from '../net';
import { store, toast, useStore } from '../store';

// ── canvas icons ───────────────────────────────────────────────────────────
export function TowerIcon({ type, size = 40, level = 1 }: { type: TowerType; size?: number; level?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawTower(ctx, type, size / 2, size / 2, size * 0.92, { level, angle: -Math.PI / 4, time: 0.4 });
  }, [type, size, level]);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />;
}

export function EnemyIcon({ type, size = 22 }: { type: EnemyType; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useViewTheme();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const scale = type === 'warlord' ? size * 0.95 : type === 'swarm' ? size * 2.2 : size * 1.5;
    drawEnemy(ctx, type, size / 2, size / 2 + (type === 'warlord' ? size * 0.1 : 0), scale, 0, 1, 0, 0, false);
  }, [type, size, theme]);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />;
}

export function MapThumb({ mapId, width }: { mapId: MapId; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useViewTheme();
  useEffect(() => {
    if (ref.current) drawMapThumb(ref.current, mapId, width);
  }, [mapId, width, theme]);
  return <canvas ref={ref} />;
}

const THEME_CHOICES: { id: ViewTheme; icon: string; label: string }[] = [
  { id: 'classic', icon: '🏰', label: 'Classic' },
  { id: 'robots', icon: '🤖', label: 'Robots' },
  { id: 'mushrooms', icon: '🍄', label: 'Mushrooms' },
];

/** Switches this player's art. Other players, and other tabs, keep their own look. */
export function ThemePicker() {
  const theme = useViewTheme();
  return (
    <div className="seg theme-picker" role="group" aria-label="View theme" title="Changes only what you see. Other players keep their own look.">
      {THEME_CHOICES.map((c) => (
        <button key={c.id} type="button" className={theme === c.id ? 'active' : ''} aria-pressed={theme === c.id} onClick={() => setViewTheme(c.id)}>
          {c.icon}
          <span className="wide-only"> {c.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MapBadge({ mapId }: { mapId: MapId }) {
  const b = MAPS[mapId].badge;
  return <span className={`badge ${b.toLowerCase()}`}>{b}</span>;
}

export function settingsLabel(mode: keyof typeof MODE_INFO, mapId: MapId, difficulty: keyof typeof DIFFICULTY): string {
  return `${MODE_INFO[mode].label} · ${MAPS[mapId].name} · ${DIFFICULTY[difficulty].label}`;
}

// ── small widgets ──────────────────────────────────────────────────────────
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <span
      className={`switch ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onChange?.(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="knob" />
      {label}
    </span>
  );
}

export function PresenceDot({ status }: { status: PresenceStatus }) {
  return <span className={`dot ${status}`} title={status} />;
}

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  offline: 'Offline',
  online: 'Online',
  lobby: 'In lobby',
  game: 'In game',
};

export function Swatch({ color }: { color: number }) {
  return <span className="swatch" style={{ background: PLAYER_COLORS[color] ?? '#888' }} />;
}

// ── global overlays ────────────────────────────────────────────────────────
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function InviteCard({ inv }: { inv: InviteInfo }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, inv.expiresAt - now);
  const respond = async (accept: boolean) => {
    setBusy(true);
    const r = await request<{ room?: unknown }>(EV.inviteRespond, { inviteId: inv.id, accept });
    setBusy(false);
    store.set((s) => ({ invites: s.invites.filter((i) => i.id !== inv.id) }));
    if (!r.ok) toast('error', r.error);
    else if (accept) toast('success', `Joined ${inv.fromName}'s room`);
  };
  return (
    <div className="panel invite-card">
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>✉️</span>
        <b>Game invite</b>
        <span className="spacer" />
        <span className="dim" style={{ fontSize: 12 }}>
          {Math.ceil(left / 1000)}s
        </span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <b>{inv.fromName}</b> invited you to <b>{MODE_INFO[inv.mode].label}</b> on <b>{MAPS[inv.mapId].name}</b>{' '}
        <span className="muted">({DIFFICULTY[inv.difficulty].label})</span>
      </div>
      <div className="row">
        <button className="btn btn-green grow" disabled={busy} onClick={() => respond(true)}>
          Accept
        </button>
        <button className="btn btn-danger grow" disabled={busy} onClick={() => respond(false)}>
          Decline
        </button>
      </div>
      <div className="timer" style={{ width: `${(left / 60000) * 100}%` }} />
    </div>
  );
}

export function InvitePopups() {
  const invites = useStore((s) => s.invites);
  if (!invites.length) return null;
  return (
    <div className="invite-pop">
      {invites.map((i) => (
        <InviteCard key={i.id} inv={i} />
      ))}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="panel modal">{children}</div>
    </div>
  );
}

export function ConfirmModal() {
  const c = useStore((s) => s.confirm);
  if (!c) return null;
  const close = () => store.set({ confirm: null });
  return (
    <Modal onClose={close}>
      <h3>{c.title}</h3>
      <p className="muted">{c.text}</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          autoFocus
          onClick={() => {
            close();
            c.onConfirm();
          }}
        >
          {c.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function JoinErrorModal() {
  const err = useStore((s) => s.joinError);
  if (!err) return null;
  const close = () => store.set({ joinError: null });
  return (
    <Modal onClose={close}>
      <h3>Couldn't join that game</h3>
      <p className="muted">{err}</p>
      <p className="muted" style={{ fontSize: 13 }}>
        Ask your friend for a fresh invite link, or create your own game from the menu.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" autoFocus onClick={close}>
          Back to menu
        </button>
      </div>
    </Modal>
  );
}

// ── chat ──────────────────────────────────────────────────────────────────
export function ChatLog({ messages }: { messages: ChatMsg[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div className="chat-log" ref={ref}>
      {messages.length === 0 && <div className="sys">No messages yet — say hi!</div>}
      {messages.map((m) =>
        m.fromId === null ? (
          <div key={m.id} className="sys">
            {m.text}
          </div>
        ) : (
          <div key={m.id}>
            <span className="who" style={{ color: PLAYER_COLORS[m.color] ?? '#ccc' }}>
              {m.name}:
            </span>
            {m.text}
          </div>
        ),
      )}
    </div>
  );
}

export function ChatInput({ ev, placeholder = 'Type a message…', inputRef }: { ev: typeof EV.roomChat | typeof EV.chat; placeholder?: string; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = await request(ev, { text: t });
    if (!r.ok) toast('error', r.error);
  };
  return (
    <div className="row">
      <input
        ref={inputRef}
        className="input"
        value={text}
        maxLength={200}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void send();
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      <button className="btn" onClick={() => void send()}>
        Send
      </button>
    </div>
  );
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
