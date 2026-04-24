/**
 * E2E Suite — Full game lifecycles through the MCP dispatcher.
 *
 * For each supported backend × each supported game type, play the full
 * game join→loop→complete via the real dispatch path. Asserts:
 *
 *   - Every join returns the right lobby/playing transition
 *   - Round counter advances exactly once per complete-submission cycle
 *   - History length equals rounds played
 *   - Final phase is 'complete'
 *   - No NaN / infinite scores
 *   - Backend ownership stays consistent across the game
 *   - Callbacks fire exactly once per game
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  agent,
  BACKENDS,
  makeManager,
  playToCompletion,
  SHARED_GAME_TYPES,
  startGameWithAgents,
  STRATS,
  type McpAgent,
} from './helpers.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

interface Ctx {
  mgr: ClassicsManager;
}

describe.each(BACKENDS)('[%s] lifecycle — PD', (backend) => {
  const ctx: Ctx = { mgr: makeManager(backend) };
  afterEach(() => ctx.mgr.shutdown());

  it('runs 10-round PD with both-cooperate strategies to completion', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'alice');
    const b = agent(ctx.mgr, 'bob');
    const { gameId } = startGameWithAgents(ctx.mgr, 'prisoners_dilemma', [a, b], {
      rounds: 10,
    });

    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      alice: STRATS.alwaysCooperate,
      bob: STRATS.alwaysCooperate,
    });

    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(10);
    expect(Number.isFinite(final.scores.alice)).toBe(true);
    expect(Number.isFinite(final.scores.bob)).toBe(true);
    // Cooperate-cooperate pays R=3 each in both backends.
    expect(final.scores.alice).toBe(30);
    expect(final.scores.bob).toBe(30);
  });

  it('runs PD with tit-for-tat vs always-defect to completion', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'tft');
    const b = agent(ctx.mgr, 'defector');
    const { gameId } = startGameWithAgents(ctx.mgr, 'prisoners_dilemma', [a, b], {
      rounds: 10,
    });

    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      tft: STRATS.titForTat('tft'),
      defector: STRATS.alwaysDefect,
    });

    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(10);
    // TFT cooperates once, then defects for 9 rounds.
    // Defector scores 5 in round 1 (vs C), 1 in rounds 2-10 (vs D) = 14
    // TFT scores 0 in round 1, 1 per round for rounds 2-10 = 9
    expect(final.scores.defector).toBe(14);
    expect(final.scores.tft).toBe(9);
  });

  it('tracks backend ownership through the whole game', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'prisoners_dilemma', [a, b], {
      rounds: 3,
    });
    expect(ctx.mgr.getBackendForGame(gameId)).toBe(backend);

    playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.alwaysDefect,
      b: STRATS.alwaysDefect,
    });
    // Ownership is sticky even after the game is done.
    expect(ctx.mgr.getBackendForGame(gameId)).toBe(backend);
  });

  it('fires onGameComplete exactly once', () => {
    ctx.mgr = makeManager(backend);
    const calls: string[] = [];
    ctx.mgr.onGameComplete((id) => calls.push(id));

    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'prisoners_dilemma', [a, b], {
      rounds: 2,
    });
    playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.alwaysCooperate,
      b: STRATS.alwaysCooperate,
    });

    expect(calls).toEqual([gameId]);
  });
});

describe.each(BACKENDS)('[%s] lifecycle — stag hunt', (backend) => {
  const ctx: Ctx = { mgr: makeManager(backend) };
  afterEach(() => ctx.mgr.shutdown());

  it('runs all-stag to completion', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'stag_hunt', [a, b], {
      rounds: 5,
    });
    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.alwaysStag,
      b: STRATS.alwaysStag,
    });
    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(5);
    expect(final.scores.a).toBeGreaterThan(0);
    expect(final.scores.b).toBeGreaterThan(0);
    expect(Number.isFinite(final.scores.a)).toBe(true);
  });

  it('runs mixed stag/hare to completion without crashing', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'stag_hunt', [a, b], {
      rounds: 5,
    });
    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.alwaysStag,
      b: STRATS.alwaysHare,
    });
    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(5);
  });
});

describe.each(BACKENDS)('[%s] lifecycle — tragedy of the commons', (backend) => {
  const ctx: Ctx = { mgr: makeManager(backend) };
  afterEach(() => ctx.mgr.shutdown());

  it('runs sustainable extraction to round limit', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'tragedy_of_commons', [a, b], {
      rounds: 5,
    });
    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.extractionRate(0.15),
      b: STRATS.extractionRate(0.15),
    });
    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(5);
    expect(final.resource_level).toBeGreaterThan(0);
    expect(final.ended_by_depletion).toBe(false);
  });

  it('greedy extraction depletes the commons (may end early)', () => {
    ctx.mgr = makeManager(backend);
    const a = agent(ctx.mgr, 'a');
    const b = agent(ctx.mgr, 'b');
    const { gameId } = startGameWithAgents(ctx.mgr, 'tragedy_of_commons', [a, b], {
      rounds: 20,
    });
    const final = playToCompletion(ctx.mgr, gameId, [a, b], {
      a: STRATS.extractionRate(1.0),
      b: STRATS.extractionRate(1.0),
    });
    expect(final.phase).toBe('complete');
    // Either hit depletion or rounds — both are valid terminations.
    expect(
      final.ended_by_depletion === true || final.history.length === 20,
    ).toBe(true);
  });
});

// Schelling Point is legacy-only; test it on the legacy backend directly.
describe('[legacy] lifecycle — schelling point', () => {
  it('runs schelling point to completion', () => {
    const mgr = makeManager('legacy');
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    const { gameId } = startGameWithAgents(mgr, 'schelling_point', [a, b], {
      rounds: 3,
    });
    const final = playToCompletion(mgr, gameId, [a, b], {
      a: () => '3,3',
      b: () => '3,3',
    });
    expect(final.phase).toBe('complete');
    expect(final.history.length).toBe(3);
    // Same cell + all-same bonus on both sides.
    expect(final.scores.a).toBeGreaterThan(0);
    mgr.shutdown();
  });
});
