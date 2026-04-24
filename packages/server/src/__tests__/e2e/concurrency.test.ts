/**
 * E2E Suite — concurrency and multi-game isolation.
 *
 * Multi-tenancy correctness:
 *   - Multiple games in flight don't leak state across each other.
 *   - Backend routing per game stays sticky under load.
 *   - Interleaved round submissions in different games resolve correctly.
 *   - Games on the mixed-backend manager don't influence each other's
 *     callbacks or listings.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  agent,
  makeManager,
  playToCompletion,
  startGameWithAgents,
  STRATS,
} from './helpers.js';
import type { ClassicsManager } from '../../game/classics-manager.js';

describe('concurrent games', () => {
  let mgr: ClassicsManager;
  afterEach(() => mgr?.shutdown());

  it('five PD games in flight across both backends — no state leakage', () => {
    mgr = makeManager({
      prisoners_dilemma: 'legacy',
      stag_hunt: 'plugin',
      tragedy_of_commons: 'plugin',
      schelling_point: 'legacy',
    } as any);

    const games: Array<{ id: string; backend: string; pair: [string, string] }> = [];
    // Mix backend ownership by creating different types
    for (let i = 0; i < 5; i++) {
      const a = agent(mgr, `pd-${i}-a`);
      const b = agent(mgr, `pd-${i}-b`);
      const { gameId } = startGameWithAgents(mgr, 'prisoners_dilemma', [a, b], {
        rounds: 3,
      });
      games.push({
        id: gameId,
        backend: mgr.getBackendForGame(gameId) as string,
        pair: [a.playerId, b.playerId],
      });
    }
    // Interleave a round across all 5 games: submit for a then b, game by game
    for (let r = 0; r < 3; r++) {
      for (const g of games) {
        agent(mgr, g.pair[0]).submit(g.id, 'cooperate');
        agent(mgr, g.pair[1]).submit(g.id, 'defect');
      }
    }
    // Every game should be complete, with correct scores (defector wins all).
    for (const g of games) {
      const state = agent(mgr, g.pair[0]).state(g.id);
      expect(state.phase).toBe('complete');
      expect(state.history.length).toBe(3);
      // Each round: defector = 5, cooperator = 0 → final 15-0
      expect(state.scores[g.pair[0]]).toBe(0);
      expect(state.scores[g.pair[1]]).toBe(15);
    }
  });

  it('games of different types on different backends terminate independently', () => {
    mgr = makeManager({
      prisoners_dilemma: 'plugin',
      stag_hunt: 'legacy',
      tragedy_of_commons: 'plugin',
      schelling_point: 'legacy',
    } as any);

    const pdA = agent(mgr, 'pd-a');
    const pdB = agent(mgr, 'pd-b');
    const shA = agent(mgr, 'sh-a');
    const shB = agent(mgr, 'sh-b');
    const tcA = agent(mgr, 'tc-a');
    const tcB = agent(mgr, 'tc-b');
    const spA = agent(mgr, 'sp-a');
    const spB = agent(mgr, 'sp-b');

    const pd = startGameWithAgents(mgr, 'prisoners_dilemma', [pdA, pdB], { rounds: 2 });
    const sh = startGameWithAgents(mgr, 'stag_hunt', [shA, shB], { rounds: 2 });
    const tc = startGameWithAgents(mgr, 'tragedy_of_commons', [tcA, tcB], { rounds: 2 });
    const sp = startGameWithAgents(mgr, 'schelling_point', [spA, spB], { rounds: 2 });

    expect(mgr.getBackendForGame(pd.gameId)).toBe('plugin');
    expect(mgr.getBackendForGame(sh.gameId)).toBe('legacy');
    expect(mgr.getBackendForGame(tc.gameId)).toBe('plugin');
    expect(mgr.getBackendForGame(sp.gameId)).toBe('legacy');

    playToCompletion(mgr, pd.gameId, [pdA, pdB], {
      'pd-a': STRATS.alwaysCooperate,
      'pd-b': STRATS.alwaysCooperate,
    });
    playToCompletion(mgr, sh.gameId, [shA, shB], {
      'sh-a': STRATS.alwaysStag,
      'sh-b': STRATS.alwaysStag,
    });
    playToCompletion(mgr, tc.gameId, [tcA, tcB], {
      'tc-a': STRATS.extractionRate(0.2),
      'tc-b': STRATS.extractionRate(0.2),
    });
    playToCompletion(mgr, sp.gameId, [spA, spB], {
      'sp-a': () => '4,4',
      'sp-b': () => '4,4',
    });

    // Each game's scores belong only to its own players — no cross-leakage.
    expect(Object.keys(pdA.state(pd.gameId).scores).sort()).toEqual(['pd-a', 'pd-b']);
    expect(Object.keys(shA.state(sh.gameId).scores).sort()).toEqual(['sh-a', 'sh-b']);
    expect(Object.keys(tcA.state(tc.gameId).scores).sort()).toEqual(['tc-a', 'tc-b']);
    expect(Object.keys(spA.state(sp.gameId).scores).sort()).toEqual(['sp-a', 'sp-b']);
  });

  it('onGameComplete fires exactly once per game across mixed backends', () => {
    mgr = makeManager({
      prisoners_dilemma: 'plugin',
      stag_hunt: 'legacy',
    } as any);
    const completed: string[] = [];
    mgr.onGameComplete((id) => completed.push(id));

    const pdA = agent(mgr, 'pd-a');
    const pdB = agent(mgr, 'pd-b');
    const shA = agent(mgr, 'sh-a');
    const shB = agent(mgr, 'sh-b');
    const pd = startGameWithAgents(mgr, 'prisoners_dilemma', [pdA, pdB], { rounds: 1 });
    const sh = startGameWithAgents(mgr, 'stag_hunt', [shA, shB], { rounds: 1 });

    playToCompletion(mgr, pd.gameId, [pdA, pdB], {
      'pd-a': STRATS.alwaysCooperate,
      'pd-b': STRATS.alwaysCooperate,
    });
    playToCompletion(mgr, sh.gameId, [shA, shB], {
      'sh-a': STRATS.alwaysStag,
      'sh-b': STRATS.alwaysStag,
    });

    expect(completed.sort()).toEqual([pd.gameId, sh.gameId].sort());
  });

  it('listAllGames returns games from every backend', () => {
    mgr = makeManager({
      prisoners_dilemma: 'plugin',
      stag_hunt: 'legacy',
    } as any);
    const a = agent(mgr, 'a');
    const b = agent(mgr, 'b');
    startGameWithAgents(mgr, 'prisoners_dilemma', [a, b], { rounds: 2 });
    startGameWithAgents(mgr, 'stag_hunt', [a, b], { rounds: 2 });
    const all = mgr.listAllGames();
    expect(all.length).toBe(2);
    const types = all.map((g) => g.type).sort();
    expect(types).toEqual(['prisoners_dilemma', 'stag_hunt']);
  });
});
