import { describe, expect, it } from 'vitest';
import { cuesForBoard, readMuted, writeMuted, type Cue } from '../src/client/game/audio';
import { nextId, nextTargetMode } from '../src/client/game/hotkeys';
import type { Fx } from '../src/shared/protocol';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('match hotkeys', () => {
  it('cycles targeting and wraps', () => {
    expect(nextTargetMode('first')).toBe('last');
    expect(nextTargetMode('last')).toBe('strong');
    expect(nextTargetMode('strong')).toBe('close');
    expect(nextTargetMode('close')).toBe('first');
  });

  it('cycles send targets and starts at the first opponent', () => {
    expect(nextId(['a', 'b', 'c'], null)).toBe('a');
    expect(nextId(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextId(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextId(['a', 'b', 'c'], 'missing')).toBe('a');
    expect(nextId([], 'a')).toBeNull();
  });
});

describe('match audio cues', () => {
  it('keeps one cue per kind and ignores other boards', () => {
    const leak: Fx = { k: 'leak', x: 1, y: 2, n: 1 };
    const shot: Fx = { k: 'shot', t: 'archer', x1: 0, y1: 0, x2: 1, y2: 1 };
    const wave: Fx = { k: 'wave', wave: 10, boss: true };
    const incoming: Fx = { k: 'inc', from: 'p2', pack: 'grunts', count: 6, delay: 2 };
    const cues = cuesForBoard(
      [
        { boardId: 0, fx: leak },
        { boardId: 0, fx: leak },
        { boardId: 0, fx: shot },
        { boardId: 1, fx: wave },
        { boardId: 0, fx: incoming },
      ],
      0,
    );
    expect(cues).toEqual(['leak', 'incoming'] satisfies Cue[]);
  });

  it('stores mute as a flag and clears it when sound comes back', () => {
    const store = memory();
    expect(readMuted(store)).toBe(false);
    writeMuted(store, true);
    expect(readMuted(store)).toBe(true);
    writeMuted(store, false);
    expect(readMuted(store)).toBe(false);
  });
});
