import { describe, expect, it } from 'vitest';
import { phoneJoinUrl } from '../src/server/app';

describe('phoneJoinUrl', () => {
  it('points phones at the game server when it serves the client', () => {
    expect(phoneJoinUrl(['192.168.8.158', '172.17.0.1'], 4777, true)).toBe('http://192.168.8.158:4777');
  });

  it('points phones at the Vite port when the client is served separately', () => {
    expect(phoneJoinUrl(['192.168.8.158'], 4777, false)).toBe('http://192.168.8.158:5180');
  });

  it('returns null when the PC has no LAN address', () => {
    expect(phoneJoinUrl([], 4777, true)).toBeNull();
  });
});
