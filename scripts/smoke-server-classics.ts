#!/usr/bin/env npx tsx
/**
 * Smoke test: boot the server's ClassicsManager orchestrator in every
 * routing mode and prove it can round-trip a game through each backend.
 *
 * Run via `tsx`:
 *   npx tsx scripts/smoke-server-classics.mjs
 * or the npm script wired in packages/server/package.json (if added).
 */

import { ClassicsManager } from '../packages/server/src/game/classics-manager.ts';

function runScenario(label, mgr, type, choiceA, choiceB) {
  const g = mgr.createClassicGame(type, { rounds: 2 }, 'alice');
  mgr.joinClassicGame(g.id, 'bob');
  mgr.submitChoice(g.id, 'alice', choiceA);
  mgr.submitChoice(g.id, 'bob', choiceB);
  mgr.submitChoice(g.id, 'alice', choiceA);
  const final = mgr.submitChoice(g.id, 'bob', choiceB);
  const state = mgr.getClassicState(g.id, 'alice');
  console.log(
    `  [${label}] ${type.padEnd(20)} backend=${mgr.getBackendForGame(g.id)} phase=${state.phase} rounds=${state.history.length} scores=${JSON.stringify(state.scores)}`,
  );
  return final;
}

console.log('=== CLASSICS_BACKEND=legacy (default) ===');
{
  const mgr = new ClassicsManager({ envOverride: 'legacy', disableCleanup: true });
  runScenario('legacy', mgr, 'prisoners_dilemma', 'cooperate', 'defect');
  runScenario('legacy', mgr, 'stag_hunt', 'stag', 'stag');
  runScenario('legacy', mgr, 'tragedy_of_commons', '0.3', '0.3');
  mgr.shutdown();
}

console.log('\n=== CLASSICS_BACKEND=plugin ===');
{
  const mgr = new ClassicsManager({ envOverride: 'plugin', disableCleanup: true });
  runScenario('plugin', mgr, 'prisoners_dilemma', 'cooperate', 'defect');
  runScenario('plugin', mgr, 'stag_hunt', 'stag', 'stag');
  runScenario('plugin', mgr, 'tragedy_of_commons', '0.3', '0.3');
  mgr.shutdown();
}

console.log('\n=== per-type map (PD plugin, others legacy, Schelling legacy) ===');
{
  const mgr = new ClassicsManager({
    envOverride:
      '{"prisoners_dilemma":"plugin","stag_hunt":"legacy","tragedy_of_commons":"legacy"}',
    disableCleanup: true,
  });
  runScenario('mixed', mgr, 'prisoners_dilemma', 'cooperate', 'defect');
  runScenario('mixed', mgr, 'stag_hunt', 'stag', 'stag');
  runScenario('mixed', mgr, 'tragedy_of_commons', '0.3', '0.3');
  // Schelling still works on legacy even in plugin mode.
  const sp = mgr.createClassicGame('schelling_point', { rounds: 1 }, 'a');
  mgr.joinClassicGame(sp.id, 'b');
  mgr.submitChoice(sp.id, 'a', '3,3');
  mgr.submitChoice(sp.id, 'b', '3,3');
  const spState = mgr.getClassicState(sp.id, 'a');
  console.log(
    `  [mixed] ${'schelling_point'.padEnd(20)} backend=${mgr.getBackendForGame(sp.id)} phase=${spState.phase}`,
  );
  mgr.shutdown();
}

console.log('\nSmoke test: all routing modes boot + round-trip successfully.');
