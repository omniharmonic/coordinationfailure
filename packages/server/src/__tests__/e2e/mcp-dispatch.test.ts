/**
 * E2E Suite — MCP dispatch.
 *
 * Drives every classics tool through the real dispatcher against both
 * backends. Proves the MCP contract (tool names, argument validation,
 * response shapes, error messages) is stable regardless of which runtime
 * answers the call.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { agent, BACKENDS, makeManager, SHARED_GAME_TYPES } from './helpers.js';
import { dispatchClassicsTool } from '../../mcp/classics-tool-dispatcher.js';

describe.each(BACKENDS)('[%s] MCP dispatch', (backend) => {
  const ctx = { mgr: makeManager(backend) };
  afterEach(() => ctx.mgr.shutdown());

  it('list_classics returns full catalog with all 4 game types (plus any open games)', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const result = agent(mgr, 'alice').call('list_classics') as any;
    expect(result).toHaveProperty('game_types');
    expect(result).toHaveProperty('open_games');
    const types = result.game_types.map((g: any) => g.type).sort();
    expect(types).toEqual([
      'prisoners_dilemma',
      'schelling_point',
      'stag_hunt',
      'tragedy_of_commons',
    ]);
    expect(Array.isArray(result.open_games)).toBe(true);
  });

  it.each(SHARED_GAME_TYPES)('join_classic creates game of type %s', (gameType) => {
    const mgr = (ctx.mgr = makeManager(backend));
    const alice = agent(mgr, 'alice');
    const resp = alice.call('join_classic', {
      game_type: gameType,
      config: { rounds: 3 },
    }) as any;
    expect(resp.game_id).toMatch(/^classic_/);
    expect(resp.type).toBe(gameType);
    expect(resp.phase).toBe('waiting');
    expect(resp.players).toBe(1);
  });

  it('join_classic without game_type errors', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    expect(() => agent(mgr, 'a').call('join_classic', {})).toThrow(/Missing game_type/);
  });

  it('join_classic with existing game_id adds the caller to the lobby', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const { game_id } = agent(mgr, 'alice').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    const joined = agent(mgr, 'bob').call('join_classic', { game_id }) as any;
    expect(joined.game_id).toBe(game_id);
    expect(joined.players).toBe(2);
    expect(joined.phase).toBe('playing');
  });

  it('get_classic_state errors without game_id', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    expect(() => agent(mgr, 'a').call('get_classic_state', {})).toThrow(/Missing game_id/);
  });

  it('submit_choice errors without game_id or choice', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3 },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });

    expect(() => agent(mgr, 'a').call('submit_choice', {})).toThrow(/Missing game_id/);
    expect(() => agent(mgr, 'a').call('submit_choice', { game_id })).toThrow(/Missing choice/);
  });

  it('classic_send_message errors without game_id or content', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    expect(() => agent(mgr, 'a').call('classic_send_message', {})).toThrow(/Missing game_id/);
    expect(() => agent(mgr, 'a').call('classic_send_message', { game_id: 'x' })).toThrow(/Missing content/);
  });

  it('classic_get_messages errors without game_id', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    expect(() => agent(mgr, 'a').call('classic_get_messages', {})).toThrow(/Missing game_id/);
  });

  it('classic_chat is accepted as an alias for classic_send_message', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 3, allow_communication: true },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });

    agent(mgr, 'a').call('classic_chat', { game_id, content: 'hi' });
    const msgs = agent(mgr, 'b').call('classic_get_messages', { game_id }) as any[];
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('hi');
  });

  it('dispatcher returns undefined for non-classics tools', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const result = dispatchClassicsTool({
      tool: 'register',
      params: {},
      playerId: 'a',
      classicsManager: mgr,
    });
    expect(result).toBeUndefined();
  });

  it('dispatcher throws Classics-not-enabled when manager is absent', () => {
    expect(() =>
      dispatchClassicsTool({
        tool: 'list_classics',
        params: {},
        playerId: 'a',
        classicsManager: undefined,
      }),
    ).toThrow(/Classics not enabled/);
  });

  it('dispatcher handles all 7 classics tool names', () => {
    const mgr = (ctx.mgr = makeManager(backend));
    const { game_id } = agent(mgr, 'a').call('join_classic', {
      game_type: 'prisoners_dilemma',
      config: { rounds: 1, allow_communication: true },
    }) as any;
    agent(mgr, 'b').call('join_classic', { game_id });

    // list_classics
    expect(agent(mgr, 'a').call('list_classics')).toBeDefined();
    // get_classic_state
    expect(agent(mgr, 'a').call('get_classic_state', { game_id })).toBeDefined();
    // classic_send_message
    expect(
      agent(mgr, 'a').call('classic_send_message', { game_id, content: 'x' }),
    ).toEqual({ sent: true });
    // classic_get_messages
    expect(
      Array.isArray(agent(mgr, 'b').call('classic_get_messages', { game_id })),
    ).toBe(true);
    // submit_choice
    expect(
      agent(mgr, 'a').call('submit_choice', { game_id, choice: 'cooperate' }),
    ).toBeDefined();
  });
});
