import { describe, it, expect } from 'vitest';
import { GameRoom } from '@coordination-games/engine';

import { TragedyCommonsPlugin } from '../plugin.js';
import { DEFAULT_TC_CONFIG, type TCConfig } from '../types.js';
import { applyAction, createInitialState, validateAction } from '../game.js';

function mkConfig(overrides: Partial<TCConfig> = {}): TCConfig {
  return {
    ...DEFAULT_TC_CONFIG,
    playerIds: ['a', 'b', 'c'],
    rounds: 3,
    ...overrides,
  };
}

describe('TragedyCommons plugin', () => {
  it('creates initial state with full resource', () => {
    const s = createInitialState(mkConfig());
    expect(s.resourceLevel).toBe(DEFAULT_TC_CONFIG.initialResource);
    expect(s.phase).toBe('waiting');
  });

  it('rejects extraction rates out of range', () => {
    const s0 = createInitialState(mkConfig());
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    expect(validateAction(s1, 'a', { type: 'set_extraction', rate: -0.1 })).toBe(false);
    expect(validateAction(s1, 'a', { type: 'set_extraction', rate: 1.5 })).toBe(false);
    expect(validateAction(s1, 'a', { type: 'set_extraction', rate: 0.5 })).toBe(true);
  });

  it('resolves a round when all submit', () => {
    const cfg = mkConfig({ rounds: 5 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    ({ state: s } = applyAction(s, 'a', { type: 'set_extraction', rate: 0.2 }));
    ({ state: s } = applyAction(s, 'b', { type: 'set_extraction', rate: 0.2 }));
    ({ state: s } = applyAction(s, 'c', { type: 'set_extraction', rate: 0.2 }));
    expect(s.history.length).toBe(1);
    expect(s.round).toBe(2);
    expect(s.resourceLevel).toBeLessThanOrEqual(cfg.capacity);
    expect(s.resourceLevel).toBeGreaterThan(0);
    // Each player got (0.2 * 100) / 3 ≈ 6.67
    for (const p of s.players) expect(p.score).toBeCloseTo(20 / 3, 6);
  });

  it('high extraction depletes the commons early', () => {
    const cfg = mkConfig({ rounds: 20, growthRate: 1.5, capacity: 100 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    for (let r = 0; r < cfg.rounds; r++) {
      for (const id of cfg.playerIds) {
        if (s.phase !== 'playing') break;
        ({ state: s } = applyAction(s, id, { type: 'set_extraction', rate: 1.0 }));
      }
      if (s.phase === 'finished') break;
    }
    expect(s.phase).toBe('finished');
    expect(s.endedByDepletion).toBe(true);
    expect(s.resourceLevel).toBe(0);
  });

  it('round_timeout fills defaults', () => {
    const cfg = mkConfig({ rounds: 1, timeoutDefaultRate: 0.3 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    ({ state: s } = applyAction(s, null, { type: 'round_timeout' }));
    expect(s.phase).toBe('finished');
    for (const p of s.players) {
      expect(p.totalExtracted).toBeCloseTo(0.3, 10);
    }
  });

  it('runs through GameRoom end-to-end', async () => {
    const cfg = mkConfig({ rounds: 5 });
    const room = GameRoom.create(TragedyCommonsPlugin, cfg, 'test_tc', cfg.playerIds);
    await room.handleAction(null, { type: 'game_start' });

    // Sustainable rate of ~0.25 keeps the commons healthy
    while (!room.isOver()) {
      for (const id of cfg.playerIds) {
        await room.handleAction(id, { type: 'set_extraction', rate: 0.25 });
      }
    }
    expect(room.isOver()).toBe(true);
    const outcome = room.getOutcome();
    expect(outcome.roundsPlayed).toBe(cfg.rounds);
    expect(outcome.endedByDepletion).toBe(false);

    const payouts = room.computePayouts(cfg.playerIds);
    const sum = [...payouts.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 8);
    room.cancelTimer();
  });
});
