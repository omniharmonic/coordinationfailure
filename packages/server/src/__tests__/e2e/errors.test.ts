/**
 * E2E Suite — adversarial / error path coverage.
 *
 * Enumerates every error branch on both backends. What an agent sees when
 * it misuses the API is part of the contract; regressions in error
 * messages silently break agent self-correction loops.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { agent, BACKENDS, makeManager } from './helpers.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

describe.each(BACKENDS)('[%s] error paths', (backend) => {
  let mgr: ClassicsManager;
  afterEach(() => mgr?.shutdown());

  it('join_classic with unknown game_id throws', () => {
    mgr = makeManager(backend);
    expect(() =>
      agent(mgr, 'a').call('join_classic', { game_id: 'nonexistent_id' }),
    ).toThrow(/not found/);
  });

  it('submit_choice on unknown game_id throws', () => {
    mgr = makeManager(backend);
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id: 'nope', choice: 'cooperate' }),
    ).toThrow(/not found/);
  });

  it('submit_choice by a non-participant throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'outsider').call('submit_choice', { game_id, choice: 'cooperate' }),
    ).toThrow(/not in this game/);
  });

  it('submit_choice before the game has enough players fails (phase !== playing)', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    // Only alice has joined, game still in waiting
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'cooperate' }),
    ).toThrow(/not in playing phase|waiting/);
  });

  it('submit_choice with an invalid PD choice throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'maybe' }),
    ).toThrow(/Invalid choice/);
  });

  it('submit_choice with an invalid SH choice throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'stag_hunt',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'buffalo' }),
    ).toThrow(/Invalid choice/);
  });

  it('submit_choice with out-of-range TC rate throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'tragedy_of_commons',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: '2.5' }),
    ).toThrow(/between 0.0 and 1.0/);
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: '-0.5' }),
    ).toThrow(/between 0.0 and 1.0/);
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'not-a-number' }),
    ).toThrow(/between 0.0 and 1.0/);
  });

  it('submitting twice in the same round throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    agent(mgr, 'a').call('submit_choice', { game_id, choice: 'cooperate' });
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'defect' }),
    ).toThrow(/already submitted/);
  });

  it('submit_choice after game is complete throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 1 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    agent(mgr, 'a').call('submit_choice', { game_id, choice: 'cooperate' });
    agent(mgr, 'b').call('submit_choice', { game_id, choice: 'cooperate' });
    expect(() =>
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'defect' }),
    ).toThrow(/not in playing phase|complete|already complete/i);
  });

  it('classic_send_message on non-chat game throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 }, // allow_communication defaults false
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'a').call('classic_send_message', { game_id, content: 'hi' }),
    ).toThrow(/not enabled/);
  });

  it('classic_send_message by non-participant throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3, allow_communication: true },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'outsider').call('classic_send_message', {
        game_id,
        content: 'hi',
      }),
    ).toThrow(/not in this game/);
  });

  it('classic_get_messages by non-participant throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3, allow_communication: true },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'outsider').call('classic_get_messages', { game_id }),
    ).toThrow(/not in this game/);
  });

  it('joining a full game throws', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma', // min=max=2
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });
    expect(() =>
      agent(mgr, 'c').call('join_classic', { game_id }),
    ).toThrow(/full|already started/);
  });

  it('get_classic_state on unknown game_id throws', () => {
    mgr = makeManager(backend);
    expect(() => agent(mgr, 'a').call('get_classic_state', { game_id: 'nope' })).toThrow(
      /not found/,
    );
  });

  it('re-joining the same lobby is a no-op (returns existing game)', () => {
    mgr = makeManager(backend);
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    const first = agent(mgr, 'a').call('join_classic', { game_id }) as any;
    expect(first.game_id).toBe(game_id);
  });
});
