// Short synthesized match cues. No audio files. The context stays silent until the
// player presses a key or clicks, which is what browsers allow.
import { useSyncExternalStore } from 'react';
import type { Fx } from '../../shared/protocol';

export type Cue = 'build' | 'sell' | 'leak' | 'wave' | 'boss' | 'incoming';

const MUTE_KEY = 'ctd.muted';

/** True when the stored flag is the muted value. */
export function readMuted(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(MUTE_KEY) === '1';
}

/** Remember mute across reloads. */
export function writeMuted(storage: Pick<Storage, 'setItem' | 'removeItem'>, value: boolean): void {
  if (value) storage.setItem(MUTE_KEY, '1');
  else storage.removeItem(MUTE_KEY);
}

/** One cue for an effect, or null when that effect should stay silent. */
export function cueForFx(fx: Fx): Cue | null {
  switch (fx.k) {
    case 'build':
      return 'build';
    case 'sell':
      return 'sell';
    case 'leak':
      return 'leak';
    case 'wave':
      return fx.boss ? 'boss' : 'wave';
    case 'inc':
      return 'incoming';
    default:
      return null;
  }
}

/** Unique cues for effects on one board. Shots and deaths stay quiet so waves are not a wall of noise. */
export function cuesForBoard(events: { boardId: number; fx: Fx }[], boardId: number): Cue[] {
  const out: Cue[] = [];
  for (const event of events) {
    if (event.boardId !== boardId) continue;
    const cue = cueForFx(event.fx);
    if (cue && !out.includes(cue)) out.push(cue);
  }
  return out;
}

const listeners = new Set<() => void>();
let muted = false;
let armed = false;
let ctx: AudioContext | null = null;

function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

function emit(): void {
  for (const fn of listeners) fn();
}

try {
  const storage = browserStorage();
  if (storage) muted = readMuted(storage);
} catch {
  muted = false;
}

/** Whether match cues are silenced. */
export function isMuted(): boolean {
  return muted;
}

/** Turn cues on or off and remember the choice. */
export function setMuted(value: boolean): void {
  if (value === muted) return;
  muted = value;
  const storage = browserStorage();
  if (storage) writeMuted(storage, value);
  emit();
}

/** Flip mute. Returns the new value. */
export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Subscribe to mute changes. Returns an unsubscribe function. */
export function subscribeMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook for the mute button. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
}

/** Allow sound after a user gesture. Safe to call more than once. */
export function unlockAudio(): void {
  armed = true;
  const audio = context();
  if (audio && audio.state === 'suspended') void audio.resume();
}

function context(): AudioContext | null {
  if (!armed || muted) return null;
  const AC = globalThis.AudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0): void {
  const audio = context();
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const endFreq = Math.max(40, freq + slide);
  if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(amp);
  amp.connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Play one cue. Does nothing while muted, or before the first click or key press. */
export function playCue(cue: Cue): void {
  switch (cue) {
    case 'build':
      tone(520, 0.07, 'square', 0.035);
      break;
    case 'sell':
      tone(640, 0.12, 'triangle', 0.05, 220);
      break;
    case 'leak':
      tone(150, 0.22, 'sawtooth', 0.05, -90);
      break;
    case 'wave':
      tone(420, 0.14, 'square', 0.045, 200);
      break;
    case 'boss':
      tone(170, 0.32, 'sawtooth', 0.06, -50);
      break;
    case 'incoming':
      tone(880, 0.09, 'square', 0.04);
      tone(660, 0.12, 'square', 0.03);
      break;
  }
}
