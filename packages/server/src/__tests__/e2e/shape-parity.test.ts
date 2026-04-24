/**
 * E2E Suite — backend-to-backend shape parity.
 *
 * The contract guarantee for agents: the same tool call returns the same
 * shape regardless of which backend is answering. This suite drives each
 * public method against both backends with identical inputs and asserts
 * that the returned objects have the same top-level keys and compatible
 * value types. Numeric values may differ (different payoff matrices), but
 * the shape must be bit-compatible so agents parse the response the same
 * way.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { agent, makeManager, playToCompletion, startGameWithAgents, STRATS } from './helpers.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

/** Return the set of top-level keys on an object (null/undefined-safe). */
function keys(o: unknown): string[] {
  return o && typeof o === 'object' ? Object.keys(o as Record<string, unknown>).sort() : [];
}

function typesOf(o: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    out[k] = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  }
  return out;
}

function expectSameKeys(a: any, b: any, label: string) {
  expect(keys(a), `${label}: legacy keys`).toEqual(keys(b));
}

function expectCompatibleValueTypes(a: any, b: any, label: string) {
  const ta = typesOf(a);
  const tb = typesOf(b);
  for (const k of Object.keys(ta)) {
    // Allow legacy to have a value where plugin has null (or vice versa);
    // everything else must match.
    if (ta[k] === tb[k]) continue;
    if ((ta[k] === 'null' && tb[k] !== 'undefined') || (tb[k] === 'null' && ta[k] !== 'undefined')) {
      continue;
    }
    throw new Error(
      `${label}: key "${k}" type mismatch — legacy=${ta[k]} plugin=${tb[k]}`,
    );
  }
}

describe('shape parity: legacy vs plugin', () => {
  let legacy: ClassicsManager;
  let plugin: ClassicsManager;

  afterEach(() => {
    legacy?.shutdown();
    plugin?.shutdown();
  });

  it('list_classics: same catalog shape', () => {
    legacy = makeManager('legacy');
    plugin = makeManager('plugin');
    const L = agent(legacy, 'a').call('list_classics');
    const P = agent(plugin, 'a').call('list_classics');
    expectSameKeys(L, P, 'list_classics');
    expect(keys((L as any).game_types[0])).toEqual(keys((P as any).game_types[0]));
  });

  it('join_classic response: same keys', () => {
    legacy = makeManager('legacy');
    plugin = makeManager('plugin');
    const L = agent(legacy, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 2 },
    });
    const P = agent(plugin, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 2 },
    });
    expectSameKeys(L, P, 'join_classic-create');

    // Join-existing response
    const L2 = agent(legacy, 'b').call('join_classic', { game_id: (L as any).game_id });
    const P2 = agent(plugin, 'b').call('join_classic', { game_id: (P as any).game_id });
    expectSameKeys(L2, P2, 'join_classic-join');
  });

  it('get_classic_state: same shape across all 3 game types', () => {
    for (const type of ['prisoners_dilemma', 'stag_hunt', 'tragedy_of_commons'] as const) {
      const l = makeManager('legacy');
      const p = makeManager('plugin');
      try {
        const la = agent(l, 'a');
        const lb = agent(l, 'b');
        const pa = agent(p, 'a');
        const pb = agent(p, 'b');
        const lg = startGameWithAgents(l, type, [la, lb], { rounds: 2 });
        const pg = startGameWithAgents(p, type, [pa, pb], { rounds: 2 });
        const lState = la.state(lg.gameId);
        const pState = pa.state(pg.gameId);
        expectSameKeys(lState, pState, `get_classic_state[${type}]`);
        expectCompatibleValueTypes(lState, pState, `get_classic_state[${type}]`);
      } finally {
        l.shutdown();
        p.shutdown();
      }
    }
  });

  it('submit_choice response: same keys when round resolves', () => {
    legacy = makeManager('legacy');
    plugin = makeManager('plugin');

    const la = agent(legacy, 'a');
    const lb = agent(legacy, 'b');
    const pa = agent(plugin, 'a');
    const pb = agent(plugin, 'b');

    const lg = startGameWithAgents(legacy, 'prisoners_dilemma', [la, lb], { rounds: 2 });
    const pg = startGameWithAgents(plugin, 'prisoners_dilemma', [pa, pb], { rounds: 2 });

    la.submit(lg.gameId, 'cooperate');
    const lRes = lb.submit(lg.gameId, 'cooperate');
    pa.submit(pg.gameId, 'cooperate');
    const pRes = pb.submit(pg.gameId, 'cooperate');

    expectSameKeys(lRes, pRes, 'submit_choice-resolved');
    expectSameKeys(lRes.result, pRes.result, 'submit_choice.result');
  });

  it('history entries share the same shape', () => {
    legacy = makeManager('legacy');
    plugin = makeManager('plugin');
    const la = agent(legacy, 'a');
    const lb = agent(legacy, 'b');
    const pa = agent(plugin, 'a');
    const pb = agent(plugin, 'b');
    const lg = startGameWithAgents(legacy, 'prisoners_dilemma', [la, lb], { rounds: 3 });
    const pg = startGameWithAgents(plugin, 'prisoners_dilemma', [pa, pb], { rounds: 3 });

    playToCompletion(legacy, lg.gameId, [la, lb], {
      a: STRATS.alwaysCooperate,
      b: STRATS.alwaysDefect,
    });
    playToCompletion(plugin, pg.gameId, [pa, pb], {
      a: STRATS.alwaysCooperate,
      b: STRATS.alwaysDefect,
    });

    const lState = la.state(lg.gameId);
    const pState = pa.state(pg.gameId);
    expect(lState.history.length).toBe(pState.history.length);
    for (let i = 0; i < lState.history.length; i++) {
      expectSameKeys(lState.history[i], pState.history[i], `history[${i}]`);
      expectSameKeys(lState.history[i].choices, pState.history[i].choices, `history[${i}].choices`);
      expectSameKeys(lState.history[i].payoffs, pState.history[i].payoffs, `history[${i}].payoffs`);
    }
  });

  it('messages shape parity when allow_communication', () => {
    legacy = makeManager('legacy');
    plugin = makeManager('plugin');
    const la = agent(legacy, 'a');
    const lb = agent(legacy, 'b');
    const pa = agent(plugin, 'a');
    const pb = agent(plugin, 'b');
    const lg = startGameWithAgents(legacy, 'prisoners_dilemma', [la, lb], {
      rounds: 2,
      allow_communication: true,
    });
    const pg = startGameWithAgents(plugin, 'prisoners_dilemma', [pa, pb], {
      rounds: 2,
      allow_communication: true,
    });
    la.call('classic_send_message', { game_id: lg.gameId, content: 'hi legacy' });
    pa.call('classic_send_message', { game_id: pg.gameId, content: 'hi plugin' });
    const lmsgs = lb.call('classic_get_messages', { game_id: lg.gameId }) as any[];
    const pmsgs = pb.call('classic_get_messages', { game_id: pg.gameId }) as any[];
    expect(lmsgs.length).toBe(pmsgs.length);
    expectSameKeys(lmsgs[0], pmsgs[0], 'message');
  });
});
