import { describe, it, expect } from 'vitest';
import { GameRoom } from '@coordination-games/engine';

import { PrisonersDilemmaPlugin } from '../plugin.js';
import { DEFAULT_PD_CONFIG, type PDConfig } from '../types.js';
import { createInitialState, validateAction, applyAction } from '../game.js';

function mkConfig(overrides: Partial<PDConfig> = {}): PDConfig {
  return { ...DEFAULT_PD_CONFIG, playerIds: ['alice', 'bob'], rounds: 3, ...overrides };
}

describe('PrisonersDilemma plugin', () => {
  it('initial state reflects config', () => {
    const s = createInitialState(mkConfig());
    expect(s.phase).toBe('waiting');
    expect(s.round).toBe(0);
    expect(s.players.map((p) => p.id)).toEqual(['alice', 'bob']);
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });

  it('game_start requires null playerId and waiting phase', () => {
    const s = createInitialState(mkConfig());
    expect(validateAction(s, null, { type: 'game_start' })).toBe(true);
    expect(validateAction(s, 'alice', { type: 'game_start' } as any)).toBe(false);
  });

  it('submit_choice requires valid choice value', () => {
    const s0 = createInitialState(mkConfig());
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    expect(validateAction(s1, 'alice', { type: 'submit_choice', choice: 'cooperate' })).toBe(true);
    expect(validateAction(s1, 'alice', { type: 'submit_choice', choice: 'maybe' as any })).toBe(false);
  });

  it('double submit is rejected', () => {
    const s0 = createInitialState(mkConfig());
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    const { state: s2 } = applyAction(s1, 'alice', { type: 'submit_choice', choice: 'cooperate' });
    expect(validateAction(s2, 'alice', { type: 'submit_choice', choice: 'defect' })).toBe(false);
  });

  it('round resolves when both players submit', () => {
    const s0 = createInitialState(mkConfig({ rounds: 5 }));
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    const { state: s2 } = applyAction(s1, 'alice', { type: 'submit_choice', choice: 'cooperate' });
    const { state: s3, deadline } = applyAction(s2, 'bob', { type: 'submit_choice', choice: 'cooperate' });

    expect(s3.round).toBe(2);
    expect(s3.history.length).toBe(1);
    expect(s3.history[0].payoffs.alice).toBe(DEFAULT_PD_CONFIG.payoffs.R);
    expect(s3.history[0].payoffs.bob).toBe(DEFAULT_PD_CONFIG.payoffs.R);
    expect(s3.pendingChoices).toEqual({});
    // Deadline renewed for next round
    expect(deadline?.action.type).toBe('round_timeout');
  });

  it('defect > cooperate payoff in a single round', () => {
    const s0 = createInitialState(mkConfig({ rounds: 1 }));
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    const { state: s2 } = applyAction(s1, 'alice', { type: 'submit_choice', choice: 'defect' });
    const { state: s3 } = applyAction(s2, 'bob', { type: 'submit_choice', choice: 'cooperate' });

    expect(s3.phase).toBe('finished');
    expect(s3.players.find((p) => p.id === 'alice')!.score).toBe(DEFAULT_PD_CONFIG.payoffs.T);
    expect(s3.players.find((p) => p.id === 'bob')!.score).toBe(DEFAULT_PD_CONFIG.payoffs.S);
  });

  it('round_timeout fills defaults for absent players', () => {
    const s0 = createInitialState(mkConfig({ rounds: 1, timeoutDefault: 'defect' }));
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    const { state: s2 } = applyAction(s1, null, { type: 'round_timeout' });
    expect(s2.phase).toBe('finished');
    expect(s2.players[0].score).toBe(DEFAULT_PD_CONFIG.payoffs.P);
    expect(s2.players[1].score).toBe(DEFAULT_PD_CONFIG.payoffs.P);
  });

  it('isOver flips to true at configured round limit', () => {
    const cfg = mkConfig({ rounds: 2 });
    let s = createInitialState(cfg);
    ({ state: s } = applyAction(s, null, { type: 'game_start' }));
    for (let i = 0; i < cfg.rounds; i++) {
      ({ state: s } = applyAction(s, 'alice', { type: 'submit_choice', choice: 'cooperate' }));
      ({ state: s } = applyAction(s, 'bob', { type: 'submit_choice', choice: 'cooperate' }));
    }
    expect(PrisonersDilemmaPlugin.isOver(s)).toBe(true);
  });

  it('computePayouts is zero-sum and respects entry cost bound', () => {
    const s0 = createInitialState(mkConfig({ rounds: 1 }));
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    const { state: s2 } = applyAction(s1, 'alice', { type: 'submit_choice', choice: 'defect' });
    const { state: s3 } = applyAction(s2, 'bob', { type: 'submit_choice', choice: 'cooperate' });
    const outcome = PrisonersDilemmaPlugin.getOutcome(s3);
    const payouts = PrisonersDilemmaPlugin.computePayouts(outcome, ['alice', 'bob'], 1);
    const sum = [...payouts.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 10);
    for (const v of payouts.values()) expect(v).toBeGreaterThanOrEqual(-1);
  });

  it('getPlayersNeedingAction returns non-submitters', () => {
    const s0 = createInitialState(mkConfig());
    const { state: s1 } = applyAction(s0, null, { type: 'game_start' });
    expect(PrisonersDilemmaPlugin.getPlayersNeedingAction!(s1).sort()).toEqual(['alice', 'bob']);
    const { state: s2 } = applyAction(s1, 'alice', { type: 'submit_choice', choice: 'cooperate' });
    expect(PrisonersDilemmaPlugin.getPlayersNeedingAction!(s2)).toEqual(['bob']);
  });

  it('runs through GameRoom end-to-end', async () => {
    const cfg = mkConfig({ rounds: 4, turnTimerSeconds: 60 });
    const room = GameRoom.create(PrisonersDilemmaPlugin, cfg, 'test_game', cfg.playerIds);

    await room.handleAction(null, { type: 'game_start' });
    for (let r = 1; r <= cfg.rounds; r++) {
      await room.handleAction('alice', { type: 'submit_choice', choice: 'defect' });
      await room.handleAction('bob', { type: 'submit_choice', choice: 'defect' });
    }
    expect(room.isOver()).toBe(true);
    const outcome = room.getOutcome();
    expect(outcome.rankings.length).toBe(2);
    expect(outcome.rounds).toBe(cfg.rounds);
    expect(outcome.totalDefections).toBe(cfg.rounds * 2);
    room.cancelTimer();
  });
});
