import { describe, it, expect } from 'vitest';
import { GameRoom } from '@coordination-games/engine';

import { StagHuntPlugin } from '../plugin.js';
import { DEFAULT_SH_CONFIG, type SHConfig } from '../types.js';
import { applyAction, createInitialState, validateAction } from '../game.js';

function mkConfig(overrides: Partial<SHConfig> = {}): SHConfig {
  return {
    ...DEFAULT_SH_CONFIG,
    playerIds: ['a', 'b', 'c'],
    rounds: 3,
    communication: false,
    ...overrides,
  };
}

describe('StagHunt plugin', () => {
  it('creates initial state', () => {
    const s = createInitialState(mkConfig());
    expect(s.phase).toBe('waiting');
    expect(s.players.length).toBe(3);
  });

  it('game_start with communication=false jumps to decision phase', () => {
    const s0 = createInitialState(mkConfig({ communication: false }));
    const { state: s1, deadline } = applyAction(s0, null, { type: 'game_start' });
    expect(s1.phase).toBe('playing');
    expect(s1.roundPhase).toBe('decision');
    expect(deadline?.action.type).toBe('round_timeout');
  });

  it('game_start with communication=true routes through communication', () => {
    const s0 = createInitialState(mkConfig({ communication: true }));
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    expect(s1.roundPhase).toBe('communication');

    const { state: s2 } = applyAction(s1, 'a', {
      type: 'send_message',
      message: 'stag plz',
    });
    expect(s2.pendingMessages.length).toBe(1);

    // submit_choice is rejected during communication
    expect(validateAction(s2, 'a', { type: 'submit_choice', choice: 'stag' })).toBe(false);

    // end_communication -> decision
    const { state: s3 } = applyAction(s2, null, { type: 'end_communication' });
    expect(s3.roundPhase).toBe('decision');
    expect(validateAction(s3, 'a', { type: 'submit_choice', choice: 'stag' })).toBe(true);
  });

  it('all-stag payout is split evenly', () => {
    const cfg = mkConfig({ rounds: 1 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    for (const id of cfg.playerIds) {
      ({ state: s } = applyAction(s, id, { type: 'submit_choice', choice: 'stag' }));
    }
    expect(s.phase).toBe('finished');
    for (const p of s.players) {
      expect(p.score).toBeCloseTo(cfg.stagPayoff / cfg.playerIds.length, 10);
    }
  });

  it('one defector ruins stag for all', () => {
    const cfg = mkConfig({ rounds: 1 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    ({ state: s } = applyAction(s, 'a', { type: 'submit_choice', choice: 'stag' }));
    ({ state: s } = applyAction(s, 'b', { type: 'submit_choice', choice: 'stag' }));
    ({ state: s } = applyAction(s, 'c', { type: 'submit_choice', choice: 'hare' }));
    expect(s.phase).toBe('finished');
    expect(s.players.find((p) => p.id === 'a')!.score).toBe(0);
    expect(s.players.find((p) => p.id === 'b')!.score).toBe(0);
    expect(s.players.find((p) => p.id === 'c')!.score).toBe(cfg.harePayoff);
  });

  it('timeout fills defaults', () => {
    const cfg = mkConfig({ rounds: 1, timeoutDefault: 'hare' });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    ({ state: s } = applyAction(s, null, { type: 'round_timeout' }));
    expect(s.phase).toBe('finished');
    for (const p of s.players) {
      expect(p.score).toBe(cfg.harePayoff);
      expect(p.hareChoices).toBe(1);
    }
  });

  it('message length is validated', () => {
    const cfg = mkConfig({ communication: true, maxMessageLength: 10 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    expect(validateAction(s, 'a', { type: 'send_message', message: '' })).toBe(false);
    expect(validateAction(s, 'a', { type: 'send_message', message: 'xxxxxxxxxxx' })).toBe(false);
    expect(validateAction(s, 'a', { type: 'send_message', message: 'ok' })).toBe(true);
  });

  it('runs through GameRoom end-to-end (all stag)', async () => {
    const cfg = mkConfig({ rounds: 4, communication: false });
    const room = GameRoom.create(StagHuntPlugin, cfg, 'test_sh', cfg.playerIds);
    await room.handleAction(null, { type: 'game_start' });
    for (let r = 1; r <= cfg.rounds; r++) {
      for (const id of cfg.playerIds) {
        await room.handleAction(id, { type: 'submit_choice', choice: 'stag' });
      }
    }
    expect(room.isOver()).toBe(true);
    const outcome = room.getOutcome();
    expect(outcome.stagSuccessCount).toBe(cfg.rounds);
    const payouts = room.computePayouts(cfg.playerIds);
    const sum = [...payouts.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 10);
    room.cancelTimer();
  });
});
