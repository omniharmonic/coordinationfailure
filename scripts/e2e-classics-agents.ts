#!/usr/bin/env npx tsx
/**
 * E2E agent-loop harness.
 *
 * Simulates what a production MCP agent actually experiences: it
 * dispatches real classics tools through the real dispatcher, with no
 * backdoor into ClassicsManager. One run exercises:
 *
 *   1. Legacy backend — every classic game type with a handful of strategies.
 *   2. Plugin backend — same, proving plugin-backed playability.
 *   3. Mixed backend — per-type routing with all four game types.
 *   4. Concurrent games — 10 parallel PD games on plugin backend.
 *
 * Runs synchronously (plugin applyAction is sync) and prints a summary
 * report; exits 1 if any scenario fails an assertion.
 */

import { ClassicsManager } from '../packages/server/src/game/classics-manager.ts';
import { dispatchClassicsTool } from '../packages/server/src/mcp/classics-tool-dispatcher.ts';
import type { ClassicStateView } from '../packages/server/src/game/classics-shared.ts';

interface AgentProxy {
  id: string;
  call(tool: string, params?: any): any;
  state(gameId: string): ClassicStateView;
}

function bot(mgr: ClassicsManager, id: string): AgentProxy {
  const call = (tool: string, params: any = {}) =>
    dispatchClassicsTool({ tool, params, playerId: id, classicsManager: mgr });
  return { id, call, state: (gameId) => call('get_classic_state', { game_id: gameId }) };
}

function assertOk(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`E2E assertion failed: ${msg}`);
}

function play(
  mgr: ClassicsManager,
  gameId: string,
  agents: AgentProxy[],
  choose: Record<string, (s: ClassicStateView) => string>,
  maxIters = 500,
): ClassicStateView {
  let i = 0;
  while (i++ < maxIters) {
    const s0 = agents[0].state(gameId);
    if (s0.phase === 'complete') return s0;
    for (const a of agents) {
      const s = a.state(gameId);
      if (s.phase === 'complete') return s;
      if (s.has_submitted) continue;
      a.call('submit_choice', { game_id: gameId, choice: choose[a.id](s) });
    }
  }
  throw new Error(`${gameId}: did not finish within ${maxIters} iterations`);
}

const strategies = {
  coop: (_: ClassicStateView) => 'cooperate',
  defect: (_: ClassicStateView) => 'defect',
  stag: (_: ClassicStateView) => 'stag',
  hare: (_: ClassicStateView) => 'hare',
  rate: (r: number) => (_: ClassicStateView) => r.toFixed(2),
  schelling: (_: ClassicStateView) => '3,3',
  tft:
    (me: string) =>
    (s: ClassicStateView) => {
      if (s.history.length === 0) return 'cooperate';
      const last = s.history[s.history.length - 1];
      const opp = Object.keys(last.choices).find((k) => k !== me)!;
      return last.choices[opp];
    },
};

function runScenario(label: string, mgr: ClassicsManager) {
  console.log(`\n── ${label} ──`);

  // PD
  {
    const a = bot(mgr, `${label}-pd-a`);
    const b = bot(mgr, `${label}-pd-b`);
    const g = a.call('join_classic', { game_type: 'prisoners_dilemma', config: { rounds: 6 } });
    b.call('join_classic', { game_id: g.game_id });
    const final = play(mgr, g.game_id, [a, b], { [a.id]: strategies.tft(a.id), [b.id]: strategies.defect });
    assertOk(final.phase === 'complete', 'PD did not complete');
    assertOk(final.history.length === 6, 'PD history length');
    console.log(
      `  PD [${mgr.getBackendForGame(g.game_id)}] rounds=${final.history.length} scores=${JSON.stringify(final.scores)}`,
    );
  }

  // Stag Hunt
  {
    const a = bot(mgr, `${label}-sh-a`);
    const b = bot(mgr, `${label}-sh-b`);
    const g = a.call('join_classic', { game_type: 'stag_hunt', config: { rounds: 4 } });
    b.call('join_classic', { game_id: g.game_id });
    const final = play(mgr, g.game_id, [a, b], { [a.id]: strategies.stag, [b.id]: strategies.stag });
    assertOk(final.phase === 'complete', 'SH did not complete');
    console.log(
      `  SH [${mgr.getBackendForGame(g.game_id)}] rounds=${final.history.length} scores=${JSON.stringify(final.scores)}`,
    );
  }

  // TC
  {
    const a = bot(mgr, `${label}-tc-a`);
    const b = bot(mgr, `${label}-tc-b`);
    const g = a.call('join_classic', { game_type: 'tragedy_of_commons', config: { rounds: 5 } });
    b.call('join_classic', { game_id: g.game_id });
    const final = play(mgr, g.game_id, [a, b], { [a.id]: strategies.rate(0.15), [b.id]: strategies.rate(0.15) });
    assertOk(final.phase === 'complete', 'TC did not complete');
    assertOk(!final.ended_by_depletion, 'TC depleted on sustainable rate');
    console.log(
      `  TC [${mgr.getBackendForGame(g.game_id)}] rounds=${final.history.length} resource=${final.resource_level?.toFixed(2)} scores=${JSON.stringify(final.scores)}`,
    );
  }

  // Schelling (legacy-only — only run if backend routes it to legacy)
  if (mgr.getRoutingSnapshot().schelling_point === 'legacy') {
    const a = bot(mgr, `${label}-sp-a`);
    const b = bot(mgr, `${label}-sp-b`);
    const g = a.call('join_classic', { game_type: 'schelling_point', config: { rounds: 3 } });
    b.call('join_classic', { game_id: g.game_id });
    const final = play(mgr, g.game_id, [a, b], { [a.id]: strategies.schelling, [b.id]: strategies.schelling });
    assertOk(final.phase === 'complete', 'SP did not complete');
    console.log(
      `  SP [${mgr.getBackendForGame(g.game_id)}] rounds=${final.history.length} scores=${JSON.stringify(final.scores)}`,
    );
  }
}

async function main() {
  console.log('E2E agent-loop harness — classics playable via MCP dispatcher');
  console.log('='.repeat(72));

  // Scenario 1: legacy everywhere
  {
    const mgr = new ClassicsManager({ routing: 'legacy', envOverride: null, disableCleanup: true });
    runScenario('legacy', mgr);
    mgr.shutdown();
  }

  // Scenario 2: plugin everywhere (Schelling still legacy because of fallback)
  {
    const mgr = new ClassicsManager({ routing: 'plugin', envOverride: null, disableCleanup: true });
    runScenario('plugin', mgr);
    mgr.shutdown();
  }

  // Scenario 3: per-type mix
  {
    const mgr = new ClassicsManager({
      routing: {
        prisoners_dilemma: 'plugin',
        stag_hunt: 'legacy',
        tragedy_of_commons: 'plugin',
        schelling_point: 'legacy',
      },
      envOverride: null,
      disableCleanup: true,
    });
    runScenario('mixed', mgr);
    mgr.shutdown();
  }

  // Scenario 4: concurrency stress — 10 parallel PD games on plugin backend
  {
    console.log('\n── concurrency: 10 parallel PD games (plugin) ──');
    const mgr = new ClassicsManager({ routing: 'plugin', envOverride: null, disableCleanup: true });
    const games: Array<{ id: string; agents: AgentProxy[] }> = [];
    for (let i = 0; i < 10; i++) {
      const a = bot(mgr, `conc-${i}-a`);
      const b = bot(mgr, `conc-${i}-b`);
      const g = a.call('join_classic', { game_type: 'prisoners_dilemma', config: { rounds: 4 } });
      b.call('join_classic', { game_id: g.game_id });
      games.push({ id: g.game_id, agents: [a, b] });
    }
    // Interleave rounds across all games
    for (let r = 0; r < 4; r++) {
      for (const g of games) {
        g.agents[0].call('submit_choice', { game_id: g.id, choice: r % 2 === 0 ? 'cooperate' : 'defect' });
        g.agents[1].call('submit_choice', { game_id: g.id, choice: r % 2 === 0 ? 'defect' : 'cooperate' });
      }
    }
    for (const g of games) {
      const s = g.agents[0].state(g.id);
      assertOk(s.phase === 'complete', `concurrency: game ${g.id} not complete`);
    }
    console.log(`  10/10 games complete, total rounds played = ${4 * 10}`);
    mgr.shutdown();
  }

  console.log('\n' + '='.repeat(72));
  console.log('E2E agent-loop: ALL SCENARIOS PASS');
}

main().catch((err) => {
  console.error('\n✗ FAIL');
  console.error(err);
  process.exit(1);
});
