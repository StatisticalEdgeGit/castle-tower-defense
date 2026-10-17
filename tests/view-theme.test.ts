import { describe, expect, it } from 'vitest';
import { parseViewTheme, readStoredTheme, themeStorageKey, writeStoredTheme } from '../src/client/game/viewTheme';
import { themedEnemyColor, worldColors } from '../src/client/game/themeArt';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('view theme storage', () => {
  it('treats unknown values as classic', () => {
    expect(parseViewTheme(null)).toBe('classic');
    expect(parseViewTheme('nope')).toBe('classic');
    expect(parseViewTheme('robots')).toBe('robots');
  });

  it('keeps each player on their own theme', () => {
    const store = memory();
    writeStoredTheme(store, 'ada', 'robots');
    writeStoredTheme(store, 'bob', 'mushrooms');
    expect(readStoredTheme(store, 'ada')).toBe('robots');
    expect(readStoredTheme(store, 'bob')).toBe('mushrooms');
    expect(themeStorageKey('ada')).not.toBe(themeStorageKey('bob'));
  });
});

describe('theme palettes', () => {
  it('gives robots and mushrooms different ground colours', () => {
    const robots = worldColors('robots');
    const mushrooms = worldColors('mushrooms');
    expect(robots.grassA).not.toBe(mushrooms.grassA);
    expect(robots.path).not.toBe(mushrooms.path);
    expect(themedEnemyColor('robots', 'grunt')).not.toBe(themedEnemyColor('mushrooms', 'grunt'));
  });
});
