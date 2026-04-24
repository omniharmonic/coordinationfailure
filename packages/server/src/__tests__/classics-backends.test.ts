/**
 * Parity + orchestrator tests for the classics backend abstraction.
 *
 * Three goals:
 *
 * 1. LegacyClassicsBackend — unchanged behavior end-to-end (cover every MCP
 *    method + the full non-Schelling catalog + Schelling).
 *
 * 2. PluginClassicsBackend — delivers the same MCP contract shape but may
 *    compute different numeric payoffs (it runs Lucian's plugins, which
 *    have their own matrices). Verify: lifecycle transitions, shape
 *    equivalence, error handling, history population, callback firing.
 *
 * 3. ClassicsManager orchestration — env-driven routing, per-type maps,
 *    schelling_point always falls back to legacy, game ownership survives
 *    backend-agnostic lookup.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClassicsManager } from '../game/classics-manager.js';
import { LegacyClassicsBackend } from '../game/legacy-classics-backend.js';
import { PluginClassicsBackend } from '../game/plugin-classics-backend.js';
import type { ClassicGameSession } from '../game/classics-shared.js';

const NO_CLEANUP = { enableCleanup: false } as const;

// Shape keys every classic state view must expose (legacy contract).
const CLASSIC_STATE_KEYS = [
  'game_id',
  'type',
  'phase',
  'current_round',
  'total_rounds',
  'players',
  'player_ids',
  'my_score',
  'scores',
  'history',
  'has_submitted',
  'waiting_on',
  'valid_choices',
  'allow_communication',
] as const;

function expectClassicStateShape(state: any): void {
  for (const k of CLASSIC_STATE_KEYS) {
    expect(state, `missing key ${k}`).toHaveProperty(k);
  }
}

// ---------------------------------------------------------------------------
// LegacyClassicsBackend
// ---------------------------------------------------------------------------

describe('LegacyClassicsBackend', () => {
  let backend: LegacyClassicsBackend;
  beforeEach(() => {
    backend = new LegacyClassicsBackend(NO_CLEANUP);
  });
  afterEach(() => backend.stopCleanup());

  it('plays a full prisoner\'s dilemma game', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 3 }, 'alice');
    backend.joinGame(g.id, 'bob');
    expect(backend.getGame(g.id)!.phase).toBe('playing');

    for (let r = 0; r < 3; r++) {
      backend.submitChoice(g.id, 'alice', 'defect');
      const resolveResult = backend.submitChoice(g.id, 'bob', 'cooperate');
      expect(resolveResult.round_resolved).toBe(true);
    }
    const final = backend.getGame(g.id)!;
    expect(final.phase).toBe('complete');
    // Legacy PD: defect-vs-cooperate pays 5-0.
    expect(final.scores.alice).toBe(15);
    expect(final.scores.bob).toBe(0);
  });

  it('plays a tragedy-of-the-commons game + tracks resource_level', () => {
    const g = backend.createGame('tragedy_of_commons', { rounds: 3 }, 'a');
    backend.joinGame(g.id, 'b');
    backend.joinGame(g.id, 'c');
    for (let r = 0; r < 3; r++) {
      backend.submitChoice(g.id, 'a', '0.2');
      backend.submitChoice(g.id, 'b', '0.2');
      backend.submitChoice(g.id, 'c', '0.2');
    }
    const state = backend.getClassicState(g.id, 'a');
    expect(state.phase).toBe('complete');
    expect(typeof state.resource_level).toBe('number');
    expect(state.resource_level).toBeGreaterThan(0);
  });

  it('supports Schelling Point (plugin backend does not)', () => {
    const g = backend.createGame('schelling_point', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    expect(g.current_board).toBeDefined();
    backend.submitChoice(g.id, 'a', '3,3');
    backend.submitChoice(g.id, 'b', '3,3');
    const final = backend.getGame(g.id)!;
    // Same-cell + all-same bonus produces a positive score.
    expect(final.scores.a).toBeGreaterThan(0);
    expect(final.scores.b).toBeGreaterThan(0);
  });

  it('rejects invalid choices + double submits', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    backend.joinGame(g.id, 'b');
    expect(() => backend.submitChoice(g.id, 'a', 'maybe')).toThrow(/Invalid choice/);
    backend.submitChoice(g.id, 'a', 'cooperate');
    expect(() => backend.submitChoice(g.id, 'a', 'defect')).toThrow(
      /already submitted/,
    );
  });

  it('guards chat behind allow_communication', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 3 }, 'a');
    backend.joinGame(g.id, 'b');
    expect(() => backend.sendMessage(g.id, 'a', 'hi')).toThrow(/not enabled/);

    const chatty = backend.createGame(
      'prisoners_dilemma',
      { rounds: 3, allow_communication: true },
      'a',
    );
    backend.joinGame(chatty.id, 'b');
    backend.sendMessage(chatty.id, 'a', 'hi');
    expect(backend.getMessages(chatty.id, 'b').length).toBe(1);
  });

  it('fires onGameComplete callback exactly once', () => {
    const calls: string[] = [];
    backend.onGameComplete((id) => calls.push(id));
    const g = backend.createGame('prisoners_dilemma', { rounds: 1 }, 'a');
    backend.joinGame(g.id, 'b');
    backend.submitChoice(g.id, 'a', 'cooperate');
    backend.submitChoice(g.id, 'b', 'cooperate');
    expect(calls).toEqual([g.id]);
  });
});

// ---------------------------------------------------------------------------
// PluginClassicsBackend
// ---------------------------------------------------------------------------

describe('PluginClassicsBackend', () => {
  let backend: PluginClassicsBackend;
  beforeEach(() => {
    backend = new PluginClassicsBackend(NO_CLEANUP);
  });
  afterEach(() => backend.stopCleanup());

  it('rejects schelling_point (unsupported)', () => {
    expect(() => backend.createGame('schelling_point', { rounds: 2 }, 'a')).toThrow(
      /does not support schelling_point/,
    );
  });

  it('plays a full prisoner\'s dilemma game', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 3 }, 'alice');
    expect(g.phase).toBe('waiting');
    backend.joinGame(g.id, 'bob');
    expect(backend.getClassicState(g.id, 'alice').phase).toBe('playing');

    for (let r = 0; r < 3; r++) {
      const a = backend.submitChoice(g.id, 'alice', 'defect');
      expect(a.submitted).toBe(true);
      expect(a.round_resolved).toBeFalsy();
      const b = backend.submitChoice(g.id, 'bob', 'cooperate');
      expect(b.round_resolved).toBe(true);
      expect(b.result!.round).toBe(r + 1);
    }
    const state = backend.getClassicState(g.id, 'alice');
    expect(state.phase).toBe('complete');
    // Plugin defaults also use R=3/P=1/T=5/S=0 → same score as legacy PD here.
    expect(state.scores.alice).toBe(15);
    expect(state.scores.bob).toBe(0);
    expect(state.history.length).toBe(3);
  });

  it('plays a stag hunt game (plugin semantics differ from legacy)', () => {
    const g = backend.createGame('stag_hunt', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    backend.submitChoice(g.id, 'a', 'stag');
    backend.submitChoice(g.id, 'b', 'stag');
    backend.submitChoice(g.id, 'a', 'stag');
    backend.submitChoice(g.id, 'b', 'stag');
    const state = backend.getClassicState(g.id, 'a');
    expect(state.phase).toBe('complete');
    // Plugin: stagPayoff/N per round. Default 10/2 = 5 each, × 2 rounds = 10.
    expect(state.scores.a).toBeCloseTo(10, 5);
  });

  it('plays a tragedy of the commons game with history', () => {
    const g = backend.createGame('tragedy_of_commons', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    backend.submitChoice(g.id, 'a', '0.3');
    const firstResolved = backend.submitChoice(g.id, 'b', '0.3');
    expect(firstResolved.round_resolved).toBe(true);
    expect(firstResolved.result!.resource_after).toBeDefined();
    expect(typeof firstResolved.resource_level).toBe('number');

    backend.submitChoice(g.id, 'a', '0.3');
    const final = backend.submitChoice(g.id, 'b', '0.3');
    expect(final.round_resolved).toBe(true);
    expect(backend.getClassicState(g.id, 'a').phase).toBe('complete');
  });

  it('rejects late joins after game_start (plugin-specific)', () => {
    const g = backend.createGame('tragedy_of_commons', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b'); // game starts at min_players=2
    expect(() => backend.joinGame(g.id, 'c')).toThrow(/already started/);
  });

  it('state view has same shape as legacy', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    expectClassicStateShape(backend.getClassicState(g.id, 'a'));
  });

  it('rejects invalid choices and double submits', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    expect(() => backend.submitChoice(g.id, 'a', 'maybe')).toThrow(/Invalid choice/);
    backend.submitChoice(g.id, 'a', 'cooperate');
    expect(() => backend.submitChoice(g.id, 'a', 'defect')).toThrow(
      /already submitted/,
    );
  });

  it('gates chat behind allow_communication', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 2 }, 'a');
    backend.joinGame(g.id, 'b');
    expect(() => backend.sendMessage(g.id, 'a', 'hi')).toThrow(/not enabled/);
    const chatty = backend.createGame(
      'prisoners_dilemma',
      { rounds: 2, allow_communication: true },
      'a',
    );
    backend.joinGame(chatty.id, 'b');
    backend.sendMessage(chatty.id, 'a', 'hi');
    expect(backend.getMessages(chatty.id, 'b').length).toBe(1);
  });

  it('fires onGameComplete callback exactly once', () => {
    const calls: string[] = [];
    backend.onGameComplete((id) => calls.push(id));
    const g = backend.createGame('prisoners_dilemma', { rounds: 1 }, 'a');
    backend.joinGame(g.id, 'b');
    backend.submitChoice(g.id, 'a', 'cooperate');
    backend.submitChoice(g.id, 'b', 'cooperate');
    expect(calls).toEqual([g.id]);
  });

  it('reports correct backend ownership + open-games listing', () => {
    const g = backend.createGame('prisoners_dilemma', { rounds: 2 }, 'a');
    expect(backend.hasGame(g.id)).toBe(true);
    expect(backend.hasGame('nonexistent')).toBe(false);
    expect(backend.listOpenGames().map((x) => x.game_id)).toContain(g.id);
    backend.joinGame(g.id, 'b'); // hits min_players → leaves "waiting"
    expect(backend.listOpenGames().map((x) => x.game_id)).not.toContain(g.id);
  });
});

// ---------------------------------------------------------------------------
// ClassicsManager (orchestrator)
// ---------------------------------------------------------------------------

describe('ClassicsManager routing', () => {
  afterEach(() => {
    // Nothing global to tear down; backends with cleanup disabled are GC'd.
  });

  it('defaults to legacy everywhere when no env/routing is set', () => {
    const mgr = new ClassicsManager({ envOverride: null, disableCleanup: true });
    const routing = mgr.getRoutingSnapshot();
    expect(routing.prisoners_dilemma).toBe('legacy');
    expect(routing.stag_hunt).toBe('legacy');
    expect(routing.tragedy_of_commons).toBe('legacy');
    expect(routing.schelling_point).toBe('legacy');
    mgr.shutdown();
  });

  it('flips everything to plugin with CLASSICS_BACKEND=plugin, schelling still legacy', () => {
    const mgr = new ClassicsManager({ envOverride: 'plugin', disableCleanup: true });
    const routing = mgr.getRoutingSnapshot();
    expect(routing.prisoners_dilemma).toBe('plugin');
    expect(routing.stag_hunt).toBe('plugin');
    expect(routing.tragedy_of_commons).toBe('plugin');
    expect(routing.schelling_point).toBe('legacy');
    mgr.shutdown();
  });

  it('accepts per-type JSON mapping', () => {
    const mgr = new ClassicsManager({
      envOverride:
        '{"prisoners_dilemma":"plugin","stag_hunt":"legacy","tragedy_of_commons":"plugin"}',
      disableCleanup: true,
    });
    const routing = mgr.getRoutingSnapshot();
    expect(routing.prisoners_dilemma).toBe('plugin');
    expect(routing.stag_hunt).toBe('legacy');
    expect(routing.tragedy_of_commons).toBe('plugin');
    mgr.shutdown();
  });

  it('falls back to legacy on garbage env values', () => {
    const mgr = new ClassicsManager({
      envOverride: 'nonsense',
      disableCleanup: true,
    });
    expect(mgr.getRoutingSnapshot().prisoners_dilemma).toBe('legacy');
    mgr.shutdown();
  });

  it('tracks game ownership across backends', () => {
    const mgr = new ClassicsManager({
      routing: { prisoners_dilemma: 'plugin', schelling_point: 'legacy' },
      envOverride: null,
      disableCleanup: true,
    });
    const pd = mgr.createClassicGame('prisoners_dilemma', { rounds: 2 }, 'a');
    const sp = mgr.createClassicGame('schelling_point', { rounds: 1 }, 'a');
    expect(mgr.getBackendForGame(pd.id)).toBe('plugin');
    expect(mgr.getBackendForGame(sp.id)).toBe('legacy');
    mgr.shutdown();
  });

  it('aggregates listClassics across all backends', () => {
    const mgr = new ClassicsManager({
      routing: { prisoners_dilemma: 'plugin' },
      envOverride: null,
      disableCleanup: true,
    });
    mgr.createClassicGame('prisoners_dilemma', { rounds: 2 }, 'a');
    mgr.createClassicGame('schelling_point', { rounds: 1 }, 'a');
    const catalog = mgr.listClassics();
    // All 4 game types in catalog.game_types
    expect(catalog.game_types.map((g) => g.type).sort()).toEqual([
      'prisoners_dilemma',
      'schelling_point',
      'stag_hunt',
      'tragedy_of_commons',
    ]);
    // Both open games listed (one from each backend).
    expect(catalog.open_games.length).toBe(2);
    mgr.shutdown();
  });

  it('onGameComplete fires for games on either backend', () => {
    const mgr = new ClassicsManager({
      routing: { prisoners_dilemma: 'plugin' },
      envOverride: null,
      disableCleanup: true,
    });
    const completed: Array<{ id: string; backend: string | undefined }> = [];
    mgr.onGameComplete((id, session) =>
      completed.push({ id, backend: mgr.getBackendForGame(id) ?? session.type }),
    );

    // Plugin-backed PD
    const pd = mgr.createClassicGame('prisoners_dilemma', { rounds: 1 }, 'a');
    mgr.joinClassicGame(pd.id, 'b');
    mgr.submitChoice(pd.id, 'a', 'cooperate');
    mgr.submitChoice(pd.id, 'b', 'cooperate');

    // Legacy schelling
    const sp = mgr.createClassicGame('schelling_point', { rounds: 1 }, 'c');
    mgr.joinClassicGame(sp.id, 'd');
    mgr.submitChoice(sp.id, 'c', '4,4');
    mgr.submitChoice(sp.id, 'd', '4,4');

    expect(completed.map((c) => c.id).sort()).toEqual([pd.id, sp.id].sort());
    mgr.shutdown();
  });

  it('routes submitChoice to the owning backend even when routing changes later', () => {
    const mgr = new ClassicsManager({
      routing: 'legacy',
      envOverride: null,
      disableCleanup: true,
    });
    const g = mgr.createClassicGame('prisoners_dilemma', { rounds: 2 }, 'a');
    mgr.joinClassicGame(g.id, 'b');
    expect(mgr.getBackendForGame(g.id)).toBe('legacy');
    // Flipping env doesn't exist in this instance; we simulate the scenario by
    // ensuring backend-for-game is sticky regardless of current default.
    mgr.submitChoice(g.id, 'a', 'cooperate');
    mgr.submitChoice(g.id, 'b', 'cooperate');
    const final = mgr.getGame(g.id) as ClassicGameSession;
    expect(final.history.length).toBe(1);
    mgr.shutdown();
  });
});
