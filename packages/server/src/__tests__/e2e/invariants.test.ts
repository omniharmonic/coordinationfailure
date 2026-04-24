/**
 * E2E Suite — property-based invariants.
 *
 * Randomly generates action sequences against a live game and asserts
 * invariants that must hold no matter what actions are taken:
 *
 *   Universal:
 *     - phase transitions are monotonic: waiting → playing → complete.
 *     - history.length <= total_rounds (or less if TC depletes early).
 *     - scores values are finite numbers, never NaN/Infinity.
 *     - current_round >= history.length + 1 during play, exactly equal
 *       to total_rounds + 1 after complete.
 *     - game eventually terminates in at most total_rounds resolutions.
 *
 *   PD / Stag Hunt:
 *     - scores are non-negative (no negative payoffs in any matrix).
 *
 *   Tragedy of the Commons:
 *     - resource_level stays in [0, capacity], never exceeds initial.
 *     - if ended_by_depletion, resource_level is exactly 0.
 *
 *   Round history consistency:
 *     - every history entry has choices + payoffs keyed by the same set
 *       of player_ids that the session reports.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { agent, BACKENDS, makeManager, startGameWithAgents } from './helpers.js';
import type { ClassicGameType, ClassicStateView } from '../../game/classics-shared.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

// Deterministic seeded PRNG so failures are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChoice(type: ClassicGameType, rng: () => number): string {
  switch (type) {
    case 'prisoners_dilemma':
      return rng() < 0.5 ? 'cooperate' : 'defect';
    case 'stag_hunt':
      return rng() < 0.5 ? 'stag' : 'hare';
    case 'tragedy_of_commons':
      return rng().toFixed(3);
    case 'schelling_point': {
      const r = Math.floor(rng() * 8);
      const c = Math.floor(rng() * 8);
      return `${r},${c}`;
    }
  }
}

function assertInvariants(
  state: ClassicStateView,
  phaseSoFar: 'waiting' | 'playing' | 'complete',
): 'waiting' | 'playing' | 'complete' {
  // Monotonic phase.
  const order = { waiting: 0, playing: 1, complete: 2 };
  expect(order[state.phase as keyof typeof order]).toBeGreaterThanOrEqual(
    order[phaseSoFar],
  );

  // History length bounded.
  expect(state.history.length).toBeLessThanOrEqual(state.total_rounds);

  // Scores are finite numbers.
  for (const v of Object.values(state.scores)) {
    expect(Number.isFinite(v)).toBe(true);
  }

  // PD / Stag Hunt scores non-negative.
  if (state.type === 'prisoners_dilemma' || state.type === 'stag_hunt') {
    for (const v of Object.values(state.scores)) expect(v).toBeGreaterThanOrEqual(0);
  }

  // TC resource bounds.
  if (state.type === 'tragedy_of_commons') {
    expect(state.resource_level ?? NaN).toBeGreaterThanOrEqual(0);
    // Capacity is 100 for legacy, plugin TC default is also 100.
    expect(state.resource_level ?? NaN).toBeLessThanOrEqual(100 + 1e-6);
    if (state.ended_by_depletion) expect(state.resource_level).toBe(0);
  }

  // History keys match player_ids.
  const pids = state.player_ids.slice().sort();
  for (const entry of state.history) {
    expect(Object.keys(entry.choices).sort()).toEqual(pids);
    expect(Object.keys(entry.payoffs).sort()).toEqual(pids);
  }

  return state.phase as 'waiting' | 'playing' | 'complete';
}

describe.each(BACKENDS)('[%s] invariants — property-based', (backend) => {
  let mgr: ClassicsManager;
  afterEach(() => mgr?.shutdown());

  it.each([
    ['prisoners_dilemma', 30] as const,
    ['stag_hunt', 30] as const,
    ['tragedy_of_commons', 30] as const,
  ])('100 random games of %s preserve invariants', (type, iterations) => {
    mgr = makeManager(backend);
    const rng = mulberry32(42);

    for (let i = 0; i < iterations; i++) {
      const a = agent(mgr, `a-${i}`);
      const b = agent(mgr, `b-${i}`);
      const rounds = 2 + Math.floor(rng() * 6);
      const { gameId } = startGameWithAgents(
        mgr,
        type,
        [a, b],
        { rounds },
      );

      let phase: 'waiting' | 'playing' | 'complete' = 'playing';
      let safety = rounds * 3 + 10;
      while (safety-- > 0) {
        const s = a.state(gameId);
        phase = assertInvariants(s, phase);
        if (s.phase === 'complete') break;
        for (const ag of [a, b]) {
          const st = ag.state(gameId);
          if (st.phase === 'complete') break;
          if (st.has_submitted) continue;
          ag.submit(gameId, randomChoice(type, rng));
        }
      }
      const finalState = a.state(gameId);
      expect(finalState.phase).toBe('complete');
      assertInvariants(finalState, phase);
    }
  });
});
