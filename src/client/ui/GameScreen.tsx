import { useEffect, useRef, useState, type Ref } from 'react';
import { armoredDps, minePaybackWaves, sendRole, shownDps, upgradeSpend } from '../../shared/combatMath';
import { DIFFICULTY, ECONOMY, ENEMIES, MODE_INFO, PLAYER_COLORS, SEND_PACKS, TARGET_MODE_LABEL, TOWERS, waveHpMultiplier } from '../../shared/config';
import { MAPS } from '../../shared/maps';
import { EV, type Snapshot } from '../../shared/protocol';
import { ICONS, STARTER_ICONS } from '../../shared/progression';
import { PACK_IDS, TARGET_MODES, type PackId, type TowerType } from '../../shared/types';
import { previewWave } from '../../shared/wavePreview';
import { cuesForBoard, playCue, toggleMuted, unlockAudio, useMuted } from '../game/audio';
import { game, useEmotes, useGameUi, useSnapshot } from '../game/gameState';
import { emoteDef, ProfileIcon } from './hub/bits';
import {
  attachBoardInput,
  beginMove,
  cancelPlacementEdit,
  confirmPlacement,
  cycleSendTarget,
  cycleTargeting,
  onShopClick,
  onShopPointerDown,
  ownedMineCount,
  sellSelected,
  toggleBuild,
  upgradeSelected,
} from '../game/input';
import { placementPreview } from '../game/placement';
import { BoardRenderer } from '../game/renderer';
import { act, leaveRoom, request } from '../net';
import { confirmDialog, toast, useStore } from '../store';
import { ChatInput, ChatLog, EnemyIcon, Modal, ThemePicker, TowerIcon } from './components';

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
      if (map && mini) wrap.style.aspectRatio = `${map.width} / ${map.height}`;
      else wrap.style.aspectRatio = '';
      const h = map && mini ? (w * map.height) / map.width : wrap.clientHeight;
      r.resize(w, Math.max(1, h));
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
function Hud() {
  const snap = useSnapshot(10);
  const [leakTick, setLeakTick] = useState(0);
  const prevLives = useRef<number | null>(null);
  const info = game.info!;
  const me = snap?.players.find((p) => p.id === game.myId);
  const myInfo = game.myInfo();
  const coop = info.mode === 'coop';
  const lives = snap && myInfo ? boardLives(snap, myInfo.boardId) : null;
  useEffect(() => {
    if (lives === null) return;
    if (prevLives.current !== null && lives < prevLives.current) setLeakTick((n) => n + 1);
    prevLives.current = lives;
  }, [lives]);
  if (!snap || !myInfo || lives === null) return null;
  const maxLives = info.boards[myInfo.boardId]?.maxLives ?? lives;
  const dropped = snap.players.filter((p) => p.id !== game.myId && !p.connected && !game.playerInfo(p.id)?.bot);
  let countdown: string;
  if (snap.phase === 'over') countdown = 'Game over';
  else if (snap.nextWaveIn === null) countdown = 'Wave in progress';
  else if (snap.wave === 0) countdown = `First wave in ${fmtTime(snap.nextWaveIn)}`;
  else countdown = `Next wave in ${fmtTime(snap.nextWaveIn)}`;
  const roundLabel = coop && info.finalWave ? `Round ${snap.wave} / ${info.finalWave}` : `Round ${snap.wave}`;

  return (
    <div className="hud-stack">
      <div className="hud-plate">
        <div className="hud-round">{roundLabel}</div>
        <div className="hud-money" aria-label="Your money">
          ${me?.money ?? 0}
        </div>
        {!coop && (
          <div className="hud-income" aria-label="Income paid at the start of every wave">
            +${me?.income ?? 0} income
          </div>
        )}
        <div key={leakTick} className={`hud-lives${leakTick ? ' pulse' : ''}`} aria-label={coop ? 'Shared team lives' : 'Your board lives'}>
          ♥ {lives}
          <span className="hud-max"> / {maxLives}</span>
        </div>
        <div className="hud-next" style={{ color: snap.nextWaveIn !== null && snap.nextWaveIn <= 5 ? '#ffd23f' : undefined }}>
          {countdown}
        </div>
      </div>
      {dropped.length > 0 && (
        <div className="hud-note">{dropped.map((p) => game.playerInfo(p.id)?.name ?? 'A player').join(', ')} disconnected</div>
      )}
    </div>
  );
}

const PLACE_HINT_KEY = 'ctd.placeOnce';

/** Shown once, in the turret list. Never over the map. */
function useFirstPlaceHint(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(PLACE_HINT_KEY) !== '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const hide = () => setShow(false);
    window.addEventListener('ctd-placed', hide);
    return () => window.removeEventListener('ctd-placed', hide);
  }, []);
  return {
    show,
    dismiss: () => {
      try {
        localStorage.setItem(PLACE_HINT_KEY, '1');
      } catch {
        /* private mode */
      }
      setShow(false);
    },
  };
}

// ── Shop ───────────────────────────────────────────────────────────────────
function Shop({ firstRef }: { firstRef?: Ref<HTMLButtonElement> }) {
  const snap = useSnapshot(6);
  const ui = useGameUi();
  const myInfo = game.myInfo();
  const me = snap?.players.find((p) => p.id === game.myId);
  const hint = useFirstPlaceHint();
  if (!myInfo) return null;
  return (
    <div className="gpanel">
      <h4 id="turret-menu-label">Turrets</h4>
      <div className="shop-grid" role="toolbar" aria-labelledby="turret-menu-label">
        {myInfo.loadout.map((type: TowerType, i) => {
          const def = TOWERS[type];
          const cost = def.levels[0].cost;
          const mines = type === 'mine' ? ownedMineCount() : 0;
          const capped = type === 'mine' && mines >= ECONOMY.maxMinesPerPlayer;
          const can = !!me && me.alive && me.money >= cost && !capped;
          const hotkey = String(i + 1);
          const cap = type === 'mine' ? `, ${mines} of ${ECONOMY.maxMinesPerPlayer} mines` : '';
          return (
            <button
              key={type}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className={`shop-card ${ui.buildType === type ? 'active' : ''} ${can ? '' : 'disabled'}`}
              aria-pressed={ui.buildType === type}
              aria-disabled={!can}
              aria-keyshortcuts={hotkey}
              aria-label={`${def.name}, $${cost}${cap}. ${def.blurb} Tap, then tap the map. Press ${hotkey}.`}
              onPointerDown={(e) => onShopPointerDown(type, e)}
              onClick={() => onShopClick(type)}
            >
              <span className="key" aria-hidden="true">
                {hotkey}
              </span>
              <TowerIcon type={type} size={38} />
              <span className="name">{def.name}</span>
              <span className="cost">
                ${cost}
                {type === 'mine' ? ` · ${mines}/${ECONOMY.maxMinesPerPlayer}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {hint.show && (
        <div className="hint place-hint">
          Tap a turret, then tap the map. Drag on the map to slide it before you let go.
          <button type="button" className="btn btn-sm" onClick={hint.dismiss}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

// ── Selected tower ─────────────────────────────────────────────────────────
function TowerPanel({ backRef, onBack }: { backRef: Ref<HTMLButtonElement>; onBack: () => void }) {
  const snap = useSnapshot(6);
  const ui = useGameUi();
  const t = ui.selectedTower !== null ? game.findTower(ui.selectedTower) : null;
  if (!t) return null;
  const def = TOWERS[t.type];
  const cur = def.levels[t.level - 1];
  const next = t.level < 3 ? def.levels[t.level] : null;
  const owner = game.playerInfo(t.owner);
  const mine = t.owner === game.myId;
  const me = snap?.players.find((p) => p.id === game.myId);
  const refund = Math.floor(t.invested * ECONOMY.sellRefund);
  const mult = t.mult > 0 ? t.mult : 1;
  const scaled = (n: number) => {
    const v = n * mult;
    return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  };
  const armor = ENEMIES.knight.armor;
  const spend = next && def.attacks ? upgradeSpend(t.type, t.level, mult) : null;
  const payback = t.type === 'mine' ? minePaybackWaves(t.level) : null;
  const nextPayback = t.type === 'mine' && next ? minePaybackWaves(t.level + 1) : null;
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
    <div className="gpanel tower-menu" role="region" aria-label={`${def.name}, level ${t.level}`}>
      <h4>
        <button ref={backRef} type="button" className="btn btn-sm" onClick={onBack}>
          ← Turrets
        </button>
        <TowerIcon type={t.type} size={28} level={t.level} />
        <span>
          {def.name} <span className="badge gold">Lv {t.level}</span>
        </span>
      </h4>
      <div className="row" style={{ fontSize: 12, marginBottom: 6 }}>
        <span className="swatch" style={{ background: owner ? PLAYER_COLORS[owner.color] : '#888' }} />
        <span className="muted">Owner:</span> <b>{owner?.name ?? '?'}</b>
        <span className="spacer" />
        {def.attacks && <span className="muted">{t.kills} kills</span>}
      </div>
      <table className="stat-table">
        <tbody>
          {def.attacks && row('Damage', scaled(cur.damage), next ? scaled(next.damage) : undefined)}
          {def.attacks && row('Fire rate', `${cur.rate}/s`, next ? `${next.rate}/s` : undefined)}
          {def.attacks && row('DPS', Math.round(shownDps(t.type, t.level, mult)), next ? Math.round(shownDps(t.type, t.level + 1, mult)) : undefined)}
          {def.attacks && !def.ignoresArmor && !def.beam && row(`vs armor ${armor}`, Math.round(armoredDps(t.type, t.level, armor, mult)), next ? Math.round(armoredDps(t.type, t.level + 1, armor, mult)) : undefined)}
          {def.attacks && row('Range', cur.range, next?.range)}
          {row('Splash', cur.splash, next?.splash)}
          {row('Slow', pct(cur.slow), pct(next?.slow))}
          {row('Chains', cur.chains, next?.chains)}
          {row('Income / wave', cur.income ? `$${scaled(cur.income)}` : undefined, next?.income ? `$${scaled(next.income)}` : undefined)}
          {cur.pulse || next?.pulse ? row('Pulse', cur.pulse ? 'all in range' : 'no', next?.pulse ? 'all in range' : undefined) : null}
          {row('Min range', cur.minRange, next?.minRange)}
          {row('Burn', cur.burnDps ? `${cur.burnDps}/s · ${cur.burnTime}s` : undefined, next?.burnDps ? `${next.burnDps}/s · ${next.burnTime}s` : undefined)}
          {row('Cone', cur.cone ? `${cur.cone * 2}°` : undefined, next?.cone ? `${next.cone * 2}°` : undefined)}
          {row('Poison', cur.poisonDps ? `${cur.poisonDps}/s ×${cur.poisonMaxStacks}` : undefined, next?.poisonDps ? `${next.poisonDps}/s ×${next.poisonMaxStacks}` : undefined)}
          {row('Beam ramp', cur.rampMax ? `up to ×${cur.rampMax}` : undefined, next?.rampMax ? `up to ×${next.rampMax}` : undefined)}
          {row('Buff', cur.buffDmg ? `+${Math.round(cur.buffDmg * 100)}% dmg, +${Math.round((cur.buffRate ?? 0) * 100)}% rate` : undefined, next?.buffDmg ? `+${Math.round(next.buffDmg * 100)}% / +${Math.round((next.buffRate ?? 0) * 100)}%` : undefined)}
          {row('Buff radius', cur.buffRadius, next?.buffRadius)}
          {def.ignoresArmor && row('Armor', 'ignores')}
          {def.beam && row('Armor', 'beam ignores')}
        </tbody>
      </table>
      {spend && (
        <div className="hint spend-hint">
          +{Math.round(spend.extraDps)} DPS for ${spend.cost}
          {spend.beatsNewCopy
            ? ` — more damage per gold than another ${def.name}.`
            : ` — against one target, another ${def.name} deals more damage per gold.`}
        </div>
      )}
      {payback !== null && Number.isFinite(payback) && (
        <div className="hint spend-hint">
          Pays for itself in {payback.toFixed(1)} waves
          {nextPayback !== null && Number.isFinite(nextPayback) ? `. The upgrade pays back in ${nextPayback.toFixed(1)}.` : '.'}
        </div>
      )}
      {mine ? (
        <>
          <div className="row" style={{ marginTop: 8 }} role="group" aria-label={`${def.name} actions`}>
            <button
              type="button"
              className="btn btn-primary grow"
              aria-keyshortcuts="U"
              disabled={!next || !me || me.money < (next?.cost ?? 0)}
              onClick={upgradeSelected}
            >
              {next ? `Upgrade $${next.cost}` : 'Max level'} <span className="kbd">U</span>
            </button>
            <button type="button" className="btn btn-danger" aria-keyshortcuts="S" onClick={sellSelected}>
              Sell +${refund} <span className="kbd">S</span>
            </button>
          </div>
          {t.freeMove !== false ? (
            <button type="button" className="btn btn-sm" style={{ marginTop: 8, width: '100%' }} aria-keyshortcuts="M" onClick={() => beginMove(t.id)}>
              Move once, free <span className="kbd">M</span>
            </button>
          ) : (
            <div className="hint" style={{ marginTop: 8 }}>
              This turret already used its free move.
            </div>
          )}
          {def.attacks && (
            <>
              <div className="section-label" id="targeting-label">
                Targeting <span className="kbd">T</span>
              </div>
              <div className="target-modes" role="group" aria-labelledby="targeting-label">
                {TARGET_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn btn-sm ${t.targeting === m ? 'active' : ''}`}
                    aria-pressed={t.targeting === m}
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
            Target <span className="kbd">Q</span>
          </span>
          <select
            className="input"
            style={{ padding: '5px 8px' }}
            aria-label="Opponent to send troops to"
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
            <button
              key={id}
              type="button"
              className={`pack-card ${can ? '' : 'disabled'}`}
              aria-disabled={!can}
              aria-label={`${pack.name}, $${pack.cost}, plus $${pack.income} income each wave${locked ? `, unlocks at wave ${pack.unlockWave}` : ''}`}
              onClick={() => can && void send(id)}
            >
              <div className="row" style={{ gap: 2 }}>
                {pack.units.map((u) => (
                  <EnemyIcon key={u.type} type={u.type} size={20} />
                ))}
                <span className="spacer" />
                <span className="pcost">${pack.cost}</span>
              </div>
              <div className="pname">{pack.name}</div>
              <div className="pinc">
                +${pack.income}/wave
                {sendRole(id) === 'eco' ? ' · eco' : sendRole(id) === 'threat' ? ' · threat' : ''}
              </div>
              {frac > 0 && (
                <div
                  className="cd"
                  style={{ background: `conic-gradient(rgba(8,12,20,0.72) ${frac * 360}deg, transparent ${frac * 360}deg)` }}
                />
              )}
              {locked && <div className="locked">🔒 Wave {pack.unlockWave}</div>}
            </button>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        Cheap packs are the income buy. Heavy packs hit harder and pay less income per gold. A 2-player team board receives sends 1.6× bigger.
      </div>
    </div>
  );
}

function watchBoard(boardId: number) {
  game.setUi({ viewBoard: boardId, selectedTower: null, buildType: null, moveTowerId: null, staged: null });
}

function MiniBoard({ boardId, onOpen }: { boardId: number; onOpen: () => void }) {
  const { canvasRef, wrapRef } = useCanvasRenderer(boardId, true);
  const emotes = useEmotes();
  const snap = useSnapshot(5);
  const info = game.info!;
  const defenders = info.players.filter((p) => p.boardId === boardId);
  const board = snap?.boards[boardId];
  return (
    <div className="mini" style={{ borderColor: PLAYER_COLORS[defenders[0]?.color ?? 0] }} onClick={onOpen} role="button" tabIndex={0}>
      <div ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>
      <div className="mini-foot">♥ {board?.lives ?? 0} · tap the map to watch</div>
      {emotes
        .filter((e) => defenders.some((d) => d.id === e.playerId))
        .slice(-1)
        .map((e) => (
          <div key={e.key} className="emote-bubble">
            <span className="e">{emoteDef(e.emoteId).emoji}</span>
          </div>
        ))}
    </div>
  );
}

function FaceCard({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const snap = useSnapshot(5);
  const ui = useGameUi();
  const info = game.info!;
  const p = game.playerInfo(playerId);
  const myInfo = game.myInfo();
  if (!p || !myInfo || !snap) return null;
  const board = snap.boards[p.boardId];
  const same = p.boardId === myInfo.boardId;
  const isMe = p.id === myInfo.id;
  const versus = info.mode !== 'coop';
  const me = snap.players.find((x) => x.id === game.myId);
  const ps = snap.players.find((x) => x.id === p.id);
  const viewingMine = ui.viewBoard === myInfo.boardId;
  const openMap = () => {
    watchBoard(p.boardId);
    onClose();
  };
  const home = () => {
    watchBoard(myInfo.boardId);
    onClose();
  };
  return (
    <div className="face-pop" role="dialog" aria-label={p.name}>
      <div className="face-pop-head">
        <ProfileIcon icon={p.icon} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis">{p.name}</b>
          <div className="hint">
            {isMe ? 'You' : same ? 'Teammate' : 'Opponent'} · ♥ {board?.lives ?? 0}
            {ps ? ` · $${ps.money}` : ''}
            {!board?.alive ? ' · eliminated' : ''}
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {!same && (
        <>
          <MiniBoard boardId={p.boardId} onOpen={openMap} />
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={openMap}>
            Watch their map
          </button>
        </>
      )}
      {same && !viewingMine && (
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={home}>
          Back to my map
        </button>
      )}
      {same && viewingMine && <div className="hint" style={{ marginTop: 8 }}>This is the map you are playing.</div>}
      {versus && !same && !!me?.alive && !!board?.alive && <SendPanel />}
      {versus && !same && (!me?.alive || !board?.alive) && (
        <div className="hint" style={{ marginTop: 8 }}>
          {!board?.alive ? 'Eliminated. You can still watch the map.' : 'You are eliminated, so you cannot send.'}
        </div>
      )}
    </div>
  );
}

function FaceRail({ openId, setOpenId }: { openId: string | null; setOpenId: (id: string | null) => void }) {
  const snap = useSnapshot(5);
  const ui = useGameUi();
  const info = game.info;
  const myInfo = game.myInfo();
  if (!info || !myInfo || !snap) return null;
  const target = effectiveTarget(snap, ui.sendTarget);
  const targetBoard = target ? game.playerInfo(target)?.boardId : undefined;
  const players = info.players.slice().sort((a, b) => {
    if (a.id === myInfo.id) return -1;
    if (b.id === myInfo.id) return 1;
    return a.color - b.color;
  });
  return (
    <div className="face-rail" role="list" aria-label="Players">
      {players.map((p) => {
        const board = snap.boards[p.boardId];
        const open = openId === p.id;
        const isMe = p.id === myInfo.id;
        const isTarget = !isMe && targetBoard === p.boardId && info.mode !== 'coop';
        const viewing = ui.viewBoard === p.boardId;
        return (
          <div key={p.id} className="face-slot" role="listitem">
            <button
              type="button"
              className={`face-btn ${isMe ? 'me' : ''} ${isTarget ? 'target' : ''} ${viewing && !isMe ? 'viewing' : ''} ${board?.alive ? '' : 'dead'}`}
              style={{ borderColor: PLAYER_COLORS[p.color] }}
              aria-pressed={open}
              aria-label={`${p.name}, ${board?.lives ?? 0} lives. Open their map and sends.`}
              title={p.name}
              onClick={() => {
                const next = open ? null : p.id;
                setOpenId(next);
                if (next && info.mode === 'ffa' && !isMe && board?.alive) game.setUi({ sendTarget: p.id });
              }}
            >
              <ProfileIcon icon={p.icon} />
              <span className="face-lives">♥{board?.lives ?? 0}</span>
            </button>
            {open && <FaceCard playerId={p.id} onClose={() => setOpenId(null)} />}
          </div>
        );
      })}
    </div>
  );
}

/** Turret list by default. A selected turret replaces that list with its own menu. */
function SideMenu() {
  const ui = useGameUi();
  const tower = ui.selectedTower !== null ? game.findTower(ui.selectedTower) : null;
  const backRef = useRef<HTMLButtonElement>(null);
  const shopRef = useRef<HTMLButtonElement>(null);
  const prevId = useRef<number | null>(null);
  const restoreOnClose = useRef(false);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest('canvas')) restoreOnClose.current = false;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('.tower-menu')) restoreOnClose.current = true;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  useEffect(() => {
    const id = tower?.id ?? null;
    if (id === prevId.current) return;
    const opened = id !== null && prevId.current === null;
    const closed = id === null && prevId.current !== null;
    prevId.current = id;
    if (opened) {
      backRef.current?.focus();
      restoreOnClose.current = true;
    } else if (closed && restoreOnClose.current) {
      restoreOnClose.current = false;
      shopRef.current?.focus();
    }
  }, [tower?.id]);

  const label = tower ? `${TOWERS[tower.type].name} menu` : 'Turrets';
  return (
    <div className="dock-menu" aria-label={label}>
      {tower ? (
        <TowerPanel
          backRef={backRef}
          onBack={() => {
            restoreOnClose.current = true;
            game.setUi({ selectedTower: null, moveTowerId: null, staged: null });
          }}
        />
      ) : (
        <Shop firstRef={shopRef} />
      )}
    </div>
  );
}

type DrawerId = 'towers' | 'wave' | 'menu';

function OptionsDock({
  drawer,
  setDrawer,
  onHelp,
  onEmote,
  chatOpen,
  setChatOpen,
}: {
  drawer: DrawerId | null;
  setDrawer: (d: DrawerId | null) => void;
  onHelp: () => void;
  onEmote: () => void;
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
}) {
  const snap = useSnapshot(10);
  const muted = useMuted();
  const hint = useFirstPlaceHint();
  const info = game.info!;
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const myInfo = game.myInfo();
  const me = snap?.players.find((p) => p.id === game.myId);
  const coop = info.mode === 'coop';
  const active = snap?.players.filter((p) => p.connected) ?? [];
  const readyN = active.filter((p) => p.ready).length;
  const speedN = active.filter((p) => p.speedVote).length;
  const owned = user && !user.guest && profile ? profile.icons : STARTER_ICONS;
  const toggle = (id: DrawerId) => setDrawer(drawer === id ? null : id);
  const pickFace = async (icon: string) => {
    const r = await request(EV.setFace, { icon });
    if (!r.ok) toast('error', r.error);
  };
  const title = drawer === 'towers' ? 'Towers' : drawer === 'wave' ? 'Next wave' : 'Menu';

  return (
    <div className="options-dock">
      {drawer && (
        <div className={`dock-panel ${drawer === 'towers' ? 'wood' : 'dark'}`} role="dialog" aria-label={title}>
          <div className="dock-head">
            <b>{title}</b>
            <button type="button" className="dock-close" onClick={() => setDrawer(null)} aria-label={`Hide ${title}`}>
              ›
            </button>
          </div>
          {drawer === 'towers' && <SideMenu />}
          {drawer === 'wave' && <WaveScout />}
          {drawer === 'menu' && (
            <div className="menu-drawer">
              <div className="hint">
                {info.ranked ? `Ranked ${info.mode === 'ffa' ? 'Duel' : '2v2'}` : info.endless ? 'Endless' : MODE_INFO[info.mode].short}
                {' · '}
                {MAPS[info.mapId].name}
                {' · '}
                {DIFFICULTY[info.difficulty].label}
              </div>
              <div className="section-label">Your face</div>
              <div className="face-picker">
                {ICONS.filter((i) => owned.includes(i.id)).map((i) => (
                  <button key={i.id} type="button" className={myInfo?.icon === i.id ? 'on' : ''} aria-label={i.name} title={i.name} onClick={() => void pickFace(i.id)}>
                    <ProfileIcon icon={i.id} />
                  </button>
                ))}
              </div>
              <div className="hint">Everyone in this match sees the portrait you pick.</div>
              <ThemePicker />
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" aria-pressed={muted} onClick={() => toggleMuted()}>
                  {muted ? '🔇 Unmute' : '🔊 Mute'}
                </button>
                <button type="button" className="btn btn-sm" onClick={onHelp}>
                  ? Controls
                </button>
                <button type="button" className="btn btn-sm" onClick={onEmote}>
                  😀 Emotes
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setChatOpen(!chatOpen)}>
                  💬 {chatOpen ? 'Hide chat' : 'Chat'}
                </button>
              </div>
              <button
                type="button"
                className="btn btn-danger"
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
                {info.ranked ? 'Forfeit' : 'Leave game'}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="options-rail" role="toolbar" aria-label="Game menus">
        {coop && snap && snap.phase !== 'over' && (
          <>
            <button
              type="button"
              className={`map-btn ${me?.ready ? 'on' : ''}`}
              title={active.length > 1 ? `Ready ${readyN}/${active.length}` : 'Ready, or start the next wave'}
              aria-label="Ready, or start the next wave early"
              onClick={() => void act(EV.ready, {})}
            >
              {me?.ready ? '✔' : '▶'}
            </button>
            <button
              type="button"
              className={`map-btn ${me?.speedVote || snap.speed > 1 ? 'on' : ''}`}
              title={active.length > 1 ? `Double speed ${speedN}/${active.length}` : 'Vote for double speed'}
              aria-label="Vote for double speed"
              onClick={() => void act(EV.speedVote, {})}
            >
              {snap.speed > 1 ? '⏩' : '×2'}
            </button>
          </>
        )}
        <button
          type="button"
          className={`map-btn ${drawer === 'towers' ? 'on' : ''} ${hint.show && drawer !== 'towers' ? 'attention' : ''}`}
          aria-pressed={drawer === 'towers'}
          aria-label="Towers"
          title="Towers"
          onClick={() => toggle('towers')}
        >
          🏰
        </button>
        <button type="button" className={`map-btn ${drawer === 'wave' ? 'on' : ''}`} aria-pressed={drawer === 'wave'} aria-label="Next wave" title="Next wave" onClick={() => toggle('wave')}>
          👾
        </button>
        <button type="button" className={`map-btn ${drawer === 'menu' ? 'on' : ''}`} aria-pressed={drawer === 'menu'} aria-label="Menu" title="Menu" onClick={() => toggle('menu')}>
          ⚙
        </button>
        {hint.show && drawer !== 'towers' && <div className="dock-tip">Open Towers, then tap the map.</div>}
      </div>
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
        <button key={id} onClick={() => void send(id)} aria-label={emoteDef(id).text}>
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
      <PlaceBar />
    </div>
  );
}

function PlaceBar() {
  const ui = useGameUi();
  const moving = ui.moveTowerId !== null;
  const placing = !!ui.buildType;
  if (!ui.staged || (!moving && !placing)) return null;
  const preview = placementPreview(ui.viewBoard, ui);
  const miss = placing && !!preview?.ok && preview.reaches === false;
  if (!moving && !miss) return null;
  return (
    <div className="place-bar">
      <div className="msg">
        <span className={miss ? 'reach-warn' : undefined}>{moving ? 'New square' : 'Misses the road'}</span>
      </div>
      <button type="button" className="btn btn-sm btn-green" disabled={!preview || !preview.ok} onClick={(e) => void confirmPlacement(!moving && e.shiftKey)}>
        {moving ? 'Confirm move' : 'Place anyway'} <span className="kbd">Enter</span>
      </button>
      <button type="button" className="btn btn-sm" onClick={cancelPlacementEdit}>
        Cancel <span className="kbd">Esc</span>
      </button>
    </div>
  );
}

function WaveScout() {
  const snap = useSnapshot(4);
  const ui = useGameUi();
  const info = game.info;
  if (!snap || !info || snap.phase === 'over') return null;
  const board = info.boards.find((b) => b.id === ui.viewBoard) ?? info.boards[0];
  const upcoming = snap.wave + 1;
  if (info.finalWave !== null && upcoming > info.finalWave) {
    return (
      <div className="wave-scout" role="status">
        Final wave — clear the path to win.
      </div>
    );
  }
  const preview = previewWave(upcoming, info.waveSeed, board?.defenders.length ?? 1);
  const title = snap.wave === 0 ? 'First wave' : 'Next wave';
  return (
    <div className="wave-scout" role="status" aria-label={`${title} ${preview.wave}, ${preview.total} enemies`}>
      <span className="scout-title">
        {preview.boss ? '👑' : '👾'} {title} {preview.wave}
      </span>
      {preview.units.map((u) => (
        <span key={u.type} className={`scout-unit${u.debut ? ' debut' : ''}`} aria-label={u.debut ? `${u.name} joins this wave` : u.name}>
          <EnemyIcon type={u.type} size={22} />
          <span>×{u.count}</span>
          {u.debut && <span className="scout-new">NEW</span>}
        </span>
      ))}
      <span className="hint">{preview.total} on this board</span>
      <span className="muted scout-hp" aria-label="How much tougher each enemy is compared with wave 1">
        HP ×{waveHpMultiplier(upcoming).toFixed(2)}
      </span>
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ['Face', 'Open that player’s map, watch it, or send troops'],
  ['Towers / 👾 / ⚙', 'Show or hide the turret, wave, and menu panels'],
  ['1–6', 'Choose a turret'],
  ['Tap, then tap', 'Arm a turret, then tap a square to place it'],
  ['Drag on the map', 'Slide the ghost, then let go to place it'],
  ['Enter', 'Confirm the place or move'],
  ['Shift+click / Shift+Enter', 'Place and keep that turret armed'],
  ['Esc / right click', 'Cancel placement or selection'],
  ['U / S / M', 'Upgrade, sell, or move the selected turret'],
  ['T', 'Next targeting mode'],
  ['Space', 'Ready, or call the next co-op wave'],
  ['F', 'Vote for double speed (co-op)'],
  ['Q', 'Next send target (free-for-all)'],
  ['E', 'Emote wheel'],
  ['Enter', 'Chat, when you are not placing'],
  ['?', 'Show or hide this list'],
];

function ControlsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <h3>Controls</h3>
      <div className="help-list">
        {CONTROLS.map(([key, text]) => (
          <div key={key + text} className="help-row">
            <span className="help-key">{key}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function GameScreen() {
  const match = useStore((s) => s.match);
  const ui = useGameUi();
  const snap = useSnapshot(4);
  const chatRef = useRef<HTMLInputElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [wheel, setWheel] = useState(false);
  const [help, setHelp] = useState(false);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [faceId, setFaceId] = useState<string | null>(null);
  const helpRef = useRef(false);
  helpRef.current = help;
  useRenderLoop();

  useEffect(() => {
    if (ui.selectedTower !== null) setDrawer('towers');
  }, [ui.selectedTower]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.face-pop, .face-btn')) return;
      setFaceId(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => {
    const arm = () => unlockAudio();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  useEffect(() => {
    let seen = game.fxEvents.length;
    const unsub = game.subscribeSnap(() => {
      const boardId = game.myInfo()?.boardId;
      if (boardId === undefined) return;
      const fresh = game.fxEvents.slice(seen);
      seen = game.fxEvents.length;
      for (const cue of cuesForBoard(fresh, boardId)) playCue(cue);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (helpRef.current) {
        if (e.key === 'Escape' || e.key === '?') setHelp(false);
        return;
      }
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setHelp(true);
        return;
      }
      const myInfo = game.myInfo();
      const me = game.me();
      if (!myInfo) return;
      if (e.key >= '1' && e.key <= '9') {
        const type = myInfo.loadout[Number(e.key) - 1];
        if (type && me?.alive) toggleBuild(type);
      } else if (e.key === 'u' || e.key === 'U') upgradeSelected();
      else if (e.key === 's' || e.key === 'S') sellSelected();
      else if (e.key === 'm' || e.key === 'M') {
        if (game.ui.selectedTower !== null && game.ui.moveTowerId === null && !game.ui.buildType) beginMove(game.ui.selectedTower);
      } else if (e.key === 't' || e.key === 'T') cycleTargeting();
      else if ((e.key === 'f' || e.key === 'F') && game.info?.mode === 'coop' && game.latest?.phase !== 'over') {
        e.preventDefault();
        void act(EV.speedVote, {});
      } else if ((e.key === 'q' || e.key === 'Q') && game.info?.mode === 'ffa') {
        cycleSendTarget();
      } else if (e.key === 'Escape') cancelPlacementEdit();
      else if (e.key === ' ' && game.info?.mode === 'coop') {
        e.preventDefault();
        void act(EV.ready, {});
      } else if (e.key === 'e' || e.key === 'E') {
        setWheel((w) => !w);
      } else if (e.key === 'Enter' && (game.ui.buildType || game.ui.moveTowerId !== null) && !(e.target as HTMLElement).closest?.('.place-bar')) {
        e.preventDefault();
        void confirmPlacement(e.shiftKey);
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
  const me = snap?.players.find((p) => p.id === game.myId);
  const myInfo = game.myInfo();
  const spectating = !!me && !me.alive;
  const viewingOther = myInfo && ui.viewBoard !== myInfo.boardId;
  const watched = viewingOther ? game.info.players.find((p) => p.boardId === ui.viewBoard) : undefined;

  return (
    <div className="game-root">
      <div className="rotate-gate" role="dialog" aria-label="Turn your phone sideways">
        <div className="rotate-phone" aria-hidden="true" />
        <p>Turn your phone sideways to play.</p>
      </div>
      {help && <ControlsHelp onClose={() => setHelp(false)} />}
      <div className="game-stage">
        {(spectating || viewingOther) && (
          <div className="spectate-banner">
            {spectating
              ? 'You were eliminated. Click a face to watch their map.'
              : `Watching ${watched?.name ?? 'another map'}. Click your face to return.`}
          </div>
        )}
        <MainBoard />
        <Hud />
        <FaceRail openId={faceId} setOpenId={setFaceId} />
        <OptionsDock drawer={drawer} setDrawer={setDrawer} onHelp={() => setHelp(true)} onEmote={() => setWheel((w) => !w)} chatOpen={chatOpen} setChatOpen={setChatOpen} />
        <EmoteStrip />
        {wheel && <EmoteWheel onClose={() => setWheel(false)} />}
        <GameChat inputRef={chatRef} open={chatOpen} setOpen={setChatOpen} />
      </div>
    </div>
  );
}
