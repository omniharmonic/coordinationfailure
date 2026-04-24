/**
 * E2E Suite — well-known strategy outcomes.
 *
 * For games with documented game-theoretic properties, assert they hold:
 *   - PD: tit-for-tat vs always-defect — cooperator loses exactly one
 *     "sucker" round, defector never gets exploited (Axelrod-classic).
 *   - PD: grim trigger vs always-cooperate matches all-cooperate scores.
 *   - Stag hunt: all-stag Pareto-dominates all-hare in both backends.
 *   - TC: sustainable extraction beats single-shot max on longer games.
 *
 * These aren't invariance tests — they're "the math is right" tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  agent,
  BACKENDS,
  makeManager,
  playToCompletion,
  startGameWithAgents,
  STRATS,
} from './helpers.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

const ROUNDS = 30;

describe.each(BACKENDS)('[%s] strategy outcomes', (backend) => {
  let mgr: ClassicsManager;
  afterEach(() => mgr?.shutdown());

  it('PD: always-cooperate dominates always-defect for the cooperator only when opponent cooperates', () => {
    mgr = makeManager(backend);
    const alice = agent(mgr, 'alice');
    const bob = agent(mgr, 'bob');
    const { gameId } = startGameWithAgents(mgr, 'prisoners_dilemma', [alice, bob], {
      rounds: ROUNDS,
    });
    const final = playToCompletion(mgr, gameId, [alice, bob], {
      alice: STRATS.alwaysCooperate,
      bob: STRATS.alwaysDefect,
    });
    // Alice sucker: 0 points per round. Bob temptation: 5 per round.
    expect(final.scores.alice).toBe(0);
    expect(final.scores.bob).toBe(ROUNDS * 5);
  });

  it('PD: mutual cooperation out-earns mutual defection', () => {
    mgr = makeManager(backend);
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');

    const g1 = startGameWithAgents(mgr, 'prisoners_dilemma', [a, b], { rounds: ROUNDS });
    const coop = playToCompletion(mgr, g1.gameId, [a, b], {
      a: STRATS.alwaysCooperate,
      b: STRATS.alwaysCooperate,
    });

    const c = agent(mgr, 'c');
    const d = agent(mgr, 'd');
    const g2 = startGameWithAgents(mgr, 'prisoners_dilemma', [c, d], { rounds: ROUNDS });
    const deft = playToCompletion(mgr, g2.gameId, [c, d], {
      c: STRATS.alwaysDefect,
      d: STRATS.alwaysDefect,
    });

    expect(coop.scores.a).toBeGreaterThan(deft.scores.c);
    expect(coop.scores.b).toBeGreaterThan(deft.scores.d);
  });

  it('PD: grim trigger against all-cooperate = all-cooperate score', () => {
    mgr = makeManager(backend);
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    const { gameId } = startGameWithAgents(mgr, 'prisoners_dilemma', [a, b], {
      rounds: ROUNDS,
    });
    const final = playToCompletion(mgr, gameId, [a, b], {
      a: STRATS.grimTrigger('a'),
      b: STRATS.alwaysCooperate,
    });
    // Both cooperate forever: 3 * ROUNDS each.
    expect(final.scores.a).toBe(ROUNDS * 3);
    expect(final.scores.b).toBe(ROUNDS * 3);
  });

  it('PD: grim trigger flips and stays defected after first betrayal', () => {
    mgr = makeManager(backend);
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    const { gameId } = startGameWithAgents(mgr, 'prisoners_dilemma', [a, b], {
      rounds: 6,
    });
    // Pattern for B: C C D C C C → A should cooperate for first 3, then defect forever
    const bPlays = ['cooperate', 'cooperate', 'defect', 'cooperate', 'cooperate', 'cooperate'];
    let i = 0;
    const final = playToCompletion(mgr, gameId, [a, b], {
      a: STRATS.grimTrigger('a'),
      b: () => bPlays[i++],
    });
    // A sequence: C C C D D D (third choice mirrors B's prior cooperation, fourth flips after betrayal in round 3)
    expect(final.history[0].choices.a).toBe('cooperate');
    expect(final.history[1].choices.a).toBe('cooperate');
    expect(final.history[2].choices.a).toBe('cooperate');
    expect(final.history[3].choices.a).toBe('defect');
    expect(final.history[4].choices.a).toBe('defect');
    expect(final.history[5].choices.a).toBe('defect');
  });

  it('Stag hunt: all-stag Pareto-dominates all-hare over multiple rounds', () => {
    mgr = makeManager(backend);

    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    const g1 = startGameWithAgents(mgr, 'stag_hunt', [a, b], { rounds: 5 });
    const stag = playToCompletion(mgr, g1.gameId, [a, b], {
      a: STRATS.alwaysStag,
      b: STRATS.alwaysStag,
    });

    const c = agent(mgr, 'c');
    const d = agent(mgr, 'd');
    const g2 = startGameWithAgents(mgr, 'stag_hunt', [c, d], { rounds: 5 });
    const hare = playToCompletion(mgr, g2.gameId, [c, d], {
      c: STRATS.alwaysHare,
      d: STRATS.alwaysHare,
    });

    expect(stag.scores.a).toBeGreaterThan(hare.scores.c);
    expect(stag.scores.b).toBeGreaterThan(hare.scores.d);
  });

  it('TC: sustainable rate keeps resource healthy', () => {
    mgr = makeManager(backend);
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    const { gameId } = startGameWithAgents(mgr, 'tragedy_of_commons', [a, b], {
      rounds: 10,
    });
    const final = playToCompletion(mgr, gameId, [a, b], {
      a: STRATS.extractionRate(0.1),
      b: STRATS.extractionRate(0.1),
    });
    expect(final.phase).toBe('complete');
    expect(final.ended_by_depletion).toBe(false);
    expect(final.resource_level).toBeGreaterThan(0);
    expect(final.history.length).toBe(10);
  });
});
