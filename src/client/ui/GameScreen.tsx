import { useEffect, useRef, useState } from 'react';
import { DIFFICULTY, ECONOMY, MODE_INFO, PLAYER_COLORS, SEND_PACKS, TARGET_MODE_LABEL, TOWERS } from '../../shared/config';
import { MAPS } from '../../shared/maps';
import { EV, type Snapshot } from '../../shared/protocol';
import { PACK_IDS, TARGET_MODES, type PackId, type TowerType } from '../../shared/types';
import { game, useEmotes, useGameUi, useSnapshot } from '../game/gameState';
import { emoteDef } from './hub/bits';
import { attachBoardInput, sellSelected, upgradeSelected } from '../game/input';
import { BoardRenderer } from '../game/renderer';
import { act, leaveRoom, request } from '../net';
import { confirmDialog, toast, useStore } from '../store';
import { ChatInput, ChatLog, EnemyIcon, TowerIcon } from './components';

// all live renderers are drawn from one requestAnimationFrame loop
const renderers = new Set<BoardRenderer>();

function useRenderLoop() {
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const now = performance.now();
      for (const r of renderers) r.render(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

function useCanvasRenderer(boardId: number, mini: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const r = new BoardRenderer(canvas, mini);
    rendererRef.current = r;
    renderers.add(r);
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const map = game.map;
      const h = mini && map ? (w * map.height) / map.width : wrap.clientHeight;
      r.resize(w, h);
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      renderers.delete(r);
      rendererRef.current = null;
    };
  }, [mini]);
  useEffect(() => {
    if (rendererRef.current && game.map) rendererRef.current.setBoard(boardId, game.map);
  }, [boardId]);
  return { canvasRef, wrapRef, rendererRef };
}

// ── helpers ────────────────────────────────────────────────────────────────
function boardLives(snap: Snapshot | null, boardId: number): number {
  return snap?.boards[boardId]?.lives ?? 0;
}

function defaultTarget(snap: Snapshot): string | null {
  const info = game.info;
  const me = game.myInfo();
  if (!info || !me) return null;
  const order = info.players.slice().sort((a, b) => a.color - b.color);
  const start = order.findIndex((p) => p.id === me.id);
  for (let i = 1; i < order.length; i++) {
    const q = order[(start + i) % order.length];
    if (q.boardId !== me.boardId && snap.boards[q.boardId]?.alive) return q.id;
  }
  return null;
}

function effectiveTarget(snap: Snapshot, chosen: string | null): string | null {
  const me = game.myInfo();
  if (chosen) {
    const q = game.playerInfo(chosen);
    if (q && me && q.boardId !== me.boardId && snap.boards[q.boardId]?.alive) return chosen;
  }
  return defaultTarget(snap);
}

function fmtTime(sec: number): string {
  const s = Math.ceil(sec);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ── HUD ────────────────────────────────────────────────────────────────────
function Hud({ onEmote }: { onEmote: () => void }) {
  const snap = useSnapshot(10);
  const info = game.info!;
  const me = snap?.players.find((p) => p.id === game.myId);
  const myInfo = game.myInfo();
  const coop = info.mode === 'coop';
  if (!snap || !myInfo) return <div className="hud" />;
  const lives = boardLives(snap, myInfo.boardId);
  const maxLives = info.boards[myInfo.boardId]?.maxLives ?? lives;
  const active = snap.players.filter((p) => p.connected);
  const readyN = active.filter((p) => p.ready).length;
  const speedN = active.filter((p) => p.speedVote).length;
  let countdown: string;
  if (snap.phase === 'over') countdown = 'Game over';
  else if (snap.nextWaveIn === null) countdown = 'Wave in progress';
  else if (snap.wave === 0) countdown = `First wave in ${fmtTime(snap.nextWaveIn)}`;
  else countdown = `Next wave in ${fmtTime(snap.nextWaveIn)}`;

  return (
    <div className="hud">
      <div className="hud-item money" title="Your money">
        <span className="icon">💰</span>${me?.money ?? 0}
      </div>
      {!coop && (
        <div className="hud-item income" title="Income paid to you at the start of every wave (raise it by sending troops)">
          <span className="lbl">Income</span>+${me?.income ?? 0}
        </div>
      )}
      <div className="hud-item lives" title={coop ? 'Shared team lives' : 'Your board lives'}>
        <span className="icon">❤️</span>
        {lives}
        <span className="lbl">/ {maxLives}</span>
      </div>
      <div className="hud-item">
        <span className="lbl">Wave</span>
        {snap.wave}
        {coop && info.finalWave ? <span className="lbl">/ {info.finalWave}</span> : null}
      </div>
      <div className="hud-item countdown" style={{ color: snap.nextWaveIn !== null && snap.nextWaveIn <= 5 ? '#ffd23f' : undefined }}>
        ⏱ {countdown}
      </div>
      {coop && snap.phase !== 'over' && (
        <>
          <button
            className={`btn ${me?.ready ? 'btn-green' : ''}`}
            title="Space — start the next wave early when everyone is ready (+10% bonus)"
            onClick={() => void act(EV.ready, {})}
          >
            {me?.ready ? '✔ Ready' : 'Ready / Next wave'} <span className="kbd">Space</span>
            {active.length > 1 && (
              <span className="badge">
                {readyN}/{active.length}
              </span>
            )}
          </button>
          <button
            className={`btn ${me?.speedVote ? 'speed-on' : ''}`}
            title="Double speed — applies when every player has it on"
            onClick={() => void act(EV.speedVote, {})}
          >
            {snap.speed > 1 ? '⏩ ×2 ON' : '×2 speed'}
            {active.length > 1 && (
              <span className="badge">
                {speedN}/{active.length}
              </span>
            )}
          </button>
        </>
      )}
      <span className="spacer" />
      <button className="btn btn-sm" title="Emotes (E)" onClick={onEmote}>
        😀 <span className="kbd">E</span>
      </button>
      <span className="muted nowrap" style={{ fontSize: 12 }}>
        {info.ranked ? `🏆 Ranked ${info.mode === 'ffa' ? 'Duel' : '2v2'}` : info.endless ? 'Endless' : MODE_INFO[info.mode].short} · {MAPS[info.mapId].name} ·{' '}
        {DIFFICULTY[info.difficulty].label}
      </span>
      <button
        className="btn btn-sm btn-danger"
        onClick={() =>
          confirmDialog({
            title: info.ranked ? 'Forfeit this ranked match?' : 'Leave this game?',
            text: info.ranked
              ? 'Leaving a ranked match counts as a loss.'
              : info.mode === 'coop'
                ? 'Your towers will keep defending for your team.'
                : 'Your board will keep defending without you, but you will forfeit.',
            confirmLabel: info.ranked ? 'Forfeit' : 'Leave game',
            onConfirm: () => void leaveRoom(),
          })
        }
      >
        {info.ranked ? 'Forfeit' : 'Leave'}
      </button>
    </div>
  );
}

// ── Shop ───────────────────────────────────────────────────────────────────
function Shop() {
  const snap = useSnapshot(6);
  const ui = useGameUi();
  const myInfo = game.myInfo();
  const me = snap?.players.find((p) => p.id === game.myId);
  if (!myInfo) return null;
  return (
    <div className="gpanel">
      <h4>
        🏗️ Build <span className="spacer" />
        <span className="hint">Shift-click to place several</span>
      </h4>
      <div className="shop-grid">
        {myInfo.loadout.map((type: TowerType, i) => {
          const def = TOWERS[type];
          const cost = def.levels[0].cost;
          const can = !!me && me.alive && me.money >= cost;
          return (
            <div
              key={type}
              className={`shop-card ${ui.buildType === type ? 'active' : ''} ${can ? '' : 'disabled'}`}
              title={`${def.name} — ${def.blurb}`}
              onClick={() => {
                if (!me?.alive) return;
                game.setUi({ buildType: ui.buildType === type ? null : type, selectedTower: null, viewBoard: myInfo.boardId });
              }}
            >
              <span className="key">{i + 1}</span>
              <TowerIcon type={type} size={38} />
              <span className="name">{def.name}</span>
              <span className="cost">${cost}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Selected tower ─────────────────────────────────────────────────────────
function TowerPanel() {
  const snap = useSnapshot(6);
  const ui = useGameUi();
  const t = ui.selectedTower !== null ? game.findTower(ui.selectedTower) : null;
  if (!t) {
    return (
      <div className="gpanel">
        <h4>🔍 Tower info</h4>
        <div className="hint" style={{ lineHeight: 1.7 }}>
          Click a tower to inspect it.
          <br />
          <span className="kbd">1</span>–<span className="kbd">6</span> build · <span className="kbd">U</span> upgrade · <span className="kbd">S</span> sell ·{' '}
          <span className="kbd">Esc</span>/right-click cancel
          {game.info?.mode === 'coop' && (
            <>
              {' '}
              · <span className="kbd">Space</span> ready
            </>
          )}
        </div>
      </div>
    );
  }
  const def = TOWERS[t.type];
  const cur = def.levels[t.level - 1];
  const next = t.level < 3 ? def.levels[t.level] : null;
  const owner = game.playerInfo(t.owner);
  const mine = t.owner === game.myId;
  const me = snap?.players.find((p) => p.id === game.myId);
  const refund = Math.floor(t.invested * ECONOMY.sellRefund);
  const row = (label: string, a: number | string | undefined, b?: number | string | undefined) =>
    a === undefined || a === 0 ? null : (
      <tr>
        <td>{label}</td>
        <td>{a}</td>
        <td className="up">{b !== undefined && b !== a ? `→ ${b}` : ''}</td>
      </tr>
    );
  const pct = (v?: number) => (v ? `${Math.round(v * 100)}%` : undefined);
  return (
    <div className="gpanel">
      <h4>
        <TowerIcon type={t.type} size={28} level={t.level} />
        {def.name} <span className="badge gold">Lv {t.level}</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => game.setUi({ selectedTower: null })}>
          ✕
        </button>
      </h4>
      <div className="row" style={{ fontSize: 12, marginBottom: 6 }}>
        <span className="swatch" style={{ background: owner ? PLAYER_COLORS[owner.color] : '#888' }} />
        <span className="muted">Owner:</span> <b>{owner?.name ?? '?'}</b>
        <span className="spacer" />
        {def.attacks && <span className="muted">{t.kills} kills</span>}
      </div>
      <table className="stat-table">
        <tbody>
          {def.attacks && row('Damage', cur.damage, next?.damage)}
          {def.attacks && row('Fire rate', `${cur.rate}/s`, next ? `${next.rate}/s` : undefined)}
          {def.attacks && row('DPS', Math.round(cur.damage * cur.rate), next ? Math.round(next.damage * next.rate) : undefined)}
          {def.attacks && row('Range', cur.range, next?.range)}
          {row('Splash', cur.splash, next?.splash)}
          {row('Slow', pct(cur.slow), pct(next?.slow))}
          {row('Chains', cur.chains, next?.chains)}
          {row('Income / wave', cur.income ? `$${cur.income}` : undefined, next?.income ? `$${next.income}` : undefined)}
          {cur.pulse || next?.pulse ? row('Pulse', cur.pulse ? 'all in range' : 'no', next?.pulse ? 'all in range' : undefined) : null}
          {row('Min range', cur.minRange, next?.minRange)}
          {row('Burn', cur.burnDps ? `${cur.burnDps}/s · ${cur.burnTime}s` : undefined, next?.burnDps ? `${next.burnDps}/s · ${next.burnTime}s` : undefined)}
          {row('Cone', cur.cone ? `${cur.cone * 2}°` : undefined, next?.cone ? `${next.cone * 2}°` : undefined)}
          {row('Poison', cur.poisonDps ? `${cur.poisonDps}/s ×${cur.poisonMaxStacks}` : undefined, next?.poisonDps ? `${next.poisonDps}/s ×${next.poisonMaxStacks}` : undefined)}
          {row('Beam ramp', cur.rampMax ? `up to ×${cur.rampMax}` : undefined, next?.rampMax ? `up to ×${next.rampMax}` : undefined)}
          {row('Buff', cur.buffDmg ? `+${Math.round(cur.buffDmg * 100)}% dmg, +${Math.round((cur.buffRate ?? 0) * 100)}% rate` : undefined, next?.buffDmg ? `+${Math.round(next.buffDmg * 100)}% / +${Math.round((next.buffRate ?? 0) * 100)}%` : undefined)}
          {row('Buff radius', cur.buffRadius, next?.buffRadius)}
          {def.ignoresArmor && row('Armor', 'ignores')}
        </tbody>
      </table>
      {mine ? (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary grow" disabled={!next || !me || me.money < (next?.cost ?? 0)} onClick={upgradeSelected}>
              {next ? `Upgrade $${next.cost}` : 'Max level'} <span className="kbd">U</span>
            </button>
            <button className="btn btn-danger" onClick={sellSelected}>
              Sell +${refund} <span className="kbd">S</span>
            </button>
          </div>
          {def.attacks && (
            <>
              <div className="section-label">Targeting</div>
              <div className="target-modes">
                {TARGET_MODES.map((m) => (
                  <button
                    key={m}
                    className={`btn btn-sm ${t.targeting === m ? 'active' : ''}`}
                    onClick={() => void act(EV.setTargeting, { towerId: t.id, mode: m })}
                  >
                    {TARGET_MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="hint" style={{ marginTop: 8 }}>
          Targeting: {TARGET_MODE_LABEL[t.targeting]} · only {owner?.name ?? 'the owner'} can upgrade or sell this tower.
        </div>
      )}
    </div>
  );
}

// ── Send troops (versus) ───────────────────────────────────────────────────
function SendPanel() {
  const snap = useSnapshot(10);
  const ui = useGameUi();
  const info = game.info!;
  const myInfo = game.myInfo();
  if (!snap || !myInfo) return null;
  const me = snap.players.find((p) => p.id === game.myId);
  const target = effectiveTarget(snap, ui.sendTarget);
  const opponents = info.players.filter((p) => p.boardId !== myInfo.boardId);
  const send = async (packId: PackId) => {
    const r = await request(EV.sendTroops, { packId, targetPlayerId: target ?? undefined });
    if (!r.ok) toast('error', r.error);
  };
  const targetInfo = target ? game.playerInfo(target) : undefined;
  return (
    <div className="gpanel">
      <h4>⚔️ Send troops</h4>
      {info.mode === 'ffa' ? (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Target
          </span>
          <select
            className="input"
            style={{ padding: '5px 8px' }}
            value={ui.sendTarget ?? ''}
            onChange={(e) => game.setUi({ sendTarget: e.target.value || null })}
          >
            <option value="">Auto — next alive clockwise{targetInfo && !ui.sendTarget ? ` (${targetInfo.name})` : ''}</option>
            {opponents.map((p) => (
              <option key={p.id} value={p.id} disabled={!snap.boards[p.boardId]?.alive}>
                {p.name}
                {!snap.boards[p.boardId]?.alive ? ' (eliminated)' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="hint" style={{ marginBottom: 8 }}>
          Sends go to the other team's board ({opponents.map((p) => p.name).join(' & ')}).
        </div>
      )}
      <div className="send-grid">
        {myInfo.troops.map((id) => {
          const pack = SEND_PACKS[id];
          const idx = PACK_IDS.indexOf(id);
          const cd = me?.cds[idx] ?? 0;
          const locked = snap.wave < pack.unlockWave;
          const can = !!me && me.alive && !locked && cd <= 0 && me.money >= pack.cost && !!target;
          const frac = cd > 0 ? Math.min(1, cd / pack.cooldown) : 0;
          return (
            <div key={id} className={`pack-card ${can ? '' : 'disabled'}`} onClick={() => can && void send(id)} title={`${pack.name}: +$${pack.income} income every wave`}>
              <div className="row" style={{ gap: 2 }}>
                {pack.units.map((u) => (
                  <EnemyIcon key={u.type} type={u.type} size={20} />
                ))}
                <span className="spacer" />
                <span className="pcost">${pack.cost}</span>
              </div>
              <div className="pname">{pack.name}</div>
              <div className="pinc">+${pack.income} income</div>
              {frac > 0 && (
                <div
                  className="cd"
                  style={{ background: `conic-gradient(rgba(8,12,20,0.72) ${frac * 360}deg, transparent ${frac * 360}deg)` }}
                />
              )}
              {locked && <div className="locked">🔒 Wave {pack.unlockWave}</div>}
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Each send permanently raises your income. Packs sent into a 2-player team board arrive 1.6× bigger.
      </div>
    </div>
  );
}

// ── Mini boards (versus) ───────────────────────────────────────────────────
function MiniBoard({ boardId }: { boardId: number }) {
  const { canvasRef, wrapRef } = useCanvasRenderer(boardId, true);
  const emotes = useEmotes();
  const snap = useSnapshot(5);
  const ui = useGameUi();
  const info = game.info!;
  const myInfo = game.myInfo();
  const board = snap?.boards[boardId];
  const defenders = info.players.filter((p) => p.boardId === boardId);
  const target = snap ? effectiveTarget(snap, ui.sendTarget) : null;
  const isTarget = !!target && defenders.some((p) => p.id === target);
  const meAlive = snap?.players.find((p) => p.id === game.myId)?.alive ?? false;
  const viewing = ui.viewBoard === boardId;
  const click = () => {
    if (!meAlive || !myInfo) {
      game.setUi({ viewBoard: viewing ? (myInfo?.boardId ?? 0) : boardId, selectedTower: null, buildType: null });
      return;
    }
    if (info.mode === 'ffa' && board?.alive) game.setUi({ sendTarget: defenders[0].id });
  };
  return (
    <div className={`mini ${isTarget && meAlive ? 'target' : ''}`} style={{ borderColor: viewing ? '#fff' : PLAYER_COLORS[defenders[0]?.color ?? 0] }} onClick={click}>
      <div className="mini-head">
        {defenders.map((p) => (
          <span key={p.id} className="swatch" style={{ background: PLAYER_COLORS[p.color] }} />
        ))}
        <span className="ellipsis grow">{defenders.map((p) => p.name).join(' & ')}</span>
        <span style={{ color: '#ff8080' }}>❤️{board?.lives ?? 0}</span>
      </div>
      <div ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>
      {emotes
        .filter((e) => defenders.some((d) => d.id === e.playerId))
        .slice(-1)
        .map((e) => (
          <div key={e.key} className="emote-bubble">
            <span className="e">{emoteDef(e.emoteId).emoji}</span>
          </div>
        ))}
      {isTarget && meAlive && (
        <div className="target-tag" style={{ padding: '2px 6px' }}>
          🎯 SEND TARGET
        </div>
      )}
    </div>
  );
}

function MiniBoards() {
  const info = game.info!;
  const myInfo = game.myInfo();
  const boards = info.boards.filter((b) => b.id !== myInfo?.boardId);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="section-label" style={{ margin: 0 }}>
        Opponents
      </div>
      {boards.map((b) => (
        <MiniBoard key={b.id} boardId={b.id} />
      ))}
      <div className="hint">{info.mode === 'ffa' ? 'Click a board to make it your send target.' : 'Watch the enemy team defend.'}</div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────
function Scoreboard() {
  const snap = useSnapshot(4);
  const emotes = useEmotes();
  const info = game.info!;
  if (!snap) return null;
  return (
    <div className="gpanel">
      <h4>🏅 Players</h4>
      {info.players.map((p) => {
        const ps = snap.players.find((x) => x.id === p.id);
        const b = snap.boards[p.boardId];
        return (
          <div key={p.id} className={`score-row ${ps && !ps.alive ? 'dead' : ''}`}>
            <span className="swatch" style={{ background: PLAYER_COLORS[p.color] }} />
            <span className="lvl-inline" style={{ minWidth: 18, height: 16, fontSize: 10 }}>
              {p.level}
            </span>
            <span className="grow ellipsis" style={{ fontWeight: p.id === game.myId ? 700 : 500 }}>
              {p.name}
              {p.guest ? ' ·g' : ''}
              {p.bot ? ' 🤖' : ''}
            </span>
            {emotes.find((e) => e.playerId === p.id) && <span title="emote">{emoteDef(emotes.find((e) => e.playerId === p.id)!.emoteId).emoji}</span>}
            {!ps?.connected && <span title="Disconnected">📴</span>}
            {info.mode === 'coop' && ps?.ready && <span title="Ready">✔</span>}
            <span style={{ color: 'var(--gold)', fontSize: 12 }}>${ps?.money ?? 0}</span>
            {info.mode !== 'coop' && <span style={{ color: '#ff8080', fontSize: 12 }}>❤️{b?.lives ?? 0}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Chat overlay ───────────────────────────────────────────────────────────
function GameChat({ inputRef, open, setOpen }: { inputRef: React.RefObject<HTMLInputElement | null>; open: boolean; setOpen: (v: boolean) => void }) {
  const chat = useStore((s) => s.chat);
  const recent = chat.slice(-30);
  const [seen, setSeen] = useState(chat.length);
  useEffect(() => {
    if (open) setSeen(chat.length);
  }, [open, chat.length]);
  const unread = open ? 0 : chat.slice(seen).filter((m) => m.fromId !== null).length;
  const last = chat[chat.length - 1];
  return (
    <div className={`game-chat ${open ? '' : 'collapsed'}`}>
      <div className="row" style={{ marginBottom: 4 }}>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          💬 {open ? 'Hide chat' : 'Chat'}
          {unread > 0 && <span className="badge gold">{unread}</span>}
        </button>
        {open ? (
          <span className="hint">Enter to type</span>
        ) : (
          unread > 0 &&
          last?.fromId && (
            <span className="hint ellipsis" style={{ maxWidth: 220, color: '#cdd6ea' }}>
              {last.name}: {last.text}
            </span>
          )
        )}
      </div>
      {open && (
        <>
          <ChatLog messages={recent} />
          <div style={{ marginTop: 4 }}>
            <ChatInput ev={EV.chat} inputRef={inputRef} placeholder="Message everyone…" />
          </div>
        </>
      )}
    </div>
  );
}

// ── Emotes ─────────────────────────────────────────────────────────────────
function EmoteWheel({ onClose }: { onClose: () => void }) {
  const mine = game.myInfo()?.emotes ?? [];
  const list = mine.length ? mine : ['gg', 'wow', 'laugh', 'angry'];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (e.altKey && n >= 1 && n <= list.length) {
        void send(list[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const send = async (id: string) => {
    onClose();
    const r = await request(EV.emote, { emoteId: id });
    if (!r.ok) toast('warn', r.error);
  };
  return (
    <div className="emote-wheel" onMouseLeave={onClose}>
      {list.slice(0, 12).map((id) => (
        <button key={id} onClick={() => void send(id)} title={emoteDef(id).text}>
          {emoteDef(id).emoji}
          <span>{emoteDef(id).text}</span>
        </button>
      ))}
    </div>
  );
}

function EmoteStrip() {
  const emotes = useEmotes();
  if (!emotes.length) return null;
  return (
    <div className="emote-strip">
      {emotes.map((e) => {
        const p = game.playerInfo(e.playerId);
        const d = emoteDef(e.emoteId);
        return (
          <div key={e.key} className="emote-bubble" style={{ borderLeft: `5px solid ${p ? PLAYER_COLORS[p.color] : '#888'}` }}>
            <span className="e">{d.emoji}</span>
            <span>
              {p?.name ?? '?'}: {d.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main board ─────────────────────────────────────────────────────────────
function MainBoard() {
  const ui = useGameUi();
  const { canvasRef, wrapRef, rendererRef } = useCanvasRenderer(ui.viewBoard, false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const r = rendererRef.current;
    if (!canvas || !r) return;
    return attachBoardInput(canvas, r);
  }, [canvasRef, rendererRef]);
  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export function GameScreen() {
  const match = useStore((s) => s.match);
  const ui = useGameUi();
  const snap = useSnapshot(4);
  const chatRef = useRef<HTMLInputElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [wheel, setWheel] = useState(false);
  useRenderLoop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const myInfo = game.myInfo();
      const me = game.me();
      if (!myInfo) return;
      if (e.key >= '1' && e.key <= '9') {
        const type = myInfo.loadout[Number(e.key) - 1];
        if (type && me?.alive) {
          game.setUi({ buildType: game.ui.buildType === type ? null : type, selectedTower: null, viewBoard: myInfo.boardId });
        }
      } else if (e.key === 'u' || e.key === 'U') upgradeSelected();
      else if (e.key === 's' || e.key === 'S') sellSelected();
      else if (e.key === 'Escape') game.setUi({ buildType: null, selectedTower: null });
      else if (e.key === ' ' && game.info?.mode === 'coop') {
        e.preventDefault();
        void act(EV.ready, {});
      } else if (e.key === 'e' || e.key === 'E') {
        setWheel((w) => !w);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setChatOpen(true);
        window.setTimeout(() => chatRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!match || !game.info) return null;
  const versus = match.mode !== 'coop';
  const me = snap?.players.find((p) => p.id === game.myId);
  const myInfo = game.myInfo();
  const spectating = !!me && !me.alive;
  const viewingOther = myInfo && ui.viewBoard !== myInfo.boardId;

  return (
    <div className="game-root">
      <Hud onEmote={() => setWheel((w) => !w)} />
      <div className="game-body">
        {versus && (
          <div className="game-left">
            <MiniBoards />
          </div>
        )}
        <div className="game-center">
          {(spectating || viewingOther) && (
            <div className="spectate-banner">
              {spectating ? '💀 You were eliminated — spectating. Click an opponent board to watch it.' : 'Viewing another board — click it again to return.'}
            </div>
          )}
          <MainBoard />
          <EmoteStrip />
          {wheel && <EmoteWheel onClose={() => setWheel(false)} />}
          <GameChat inputRef={chatRef} open={chatOpen} setOpen={setChatOpen} />
        </div>
        <div className="game-right">
          <Shop />
          <TowerPanel />
          {versus && <SendPanel />}
          <Scoreboard />
        </div>
      </div>
    </div>
  );
}
