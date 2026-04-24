#!/usr/bin/env node
/**
 * Classics drift / invariant harness.
 *
 * Replicates the release-blocking invariants described in
 * docs/building-a-game.md from the coordination-games repo:
 *
 *   1. Every `gameTools` entry must be rejected when playerId === null.
 *   2. Every SYSTEM_ACTION_TYPES entry must be rejected when playerId !== null.
 *   3. Tool names must match the `type` discriminator on the corresponding action.
 *   4. Determinism: running the same scenario twice with the same seed must
 *      produce identical outcomes.
 *
 * This is a .mjs script (not a vitest file) so it runs against the built
 * plugin ESM bundles without pulling in workspace test harness config.
 */

import assert from 'node:assert/strict';
import { GameRoom } from '@coordination-games/engine';
import {
  PrisonersDilemmaPlugin,
  PRISONERS_DILEMMA_SYSTEM_ACTION_TYPES,
  DEFAULT_PD_CONFIG,
} from '@coordination-failure/game-prisoners-dilemma';
import {
  StagHuntPlugin,
  STAG_HUNT_SYSTEM_ACTION_TYPES,
  DEFAULT_SH_CONFIG,
} from '@coordination-failure/game-stag-hunt';
import {
  TragedyCommonsPlugin,
  TRAGEDY_COMMONS_SYSTEM_ACTION_TYPES,
  DEFAULT_TC_CONFIG,
} from '@coordination-failure/game-tragedy-commons';

// Sample arg payloads per tool — one that would normally be valid.
const TOOL_FIXTURES = {
  submit_choice: (gameType) =>
    gameType === 'stag-hunt' ? { choice: 'stag' } : { choice: 'cooperate' },
  set_extraction: () => ({ rate: 0.3 }),
  send_message: () => ({ message: 'hi' }),
};

function assertToolIsolation(plugin, systemActionTypes, initialState) {
  // Invariant 1: every game tool rejects playerId=null
  for (const tool of plugin.gameTools ?? []) {
    const args = TOOL_FIXTURES[tool.name](plugin.gameType);
    const action = { type: tool.name, ...args };
    const accepted = plugin.validateAction(initialState, null, action);
    assert.equal(
      accepted,
      false,
      `[${plugin.gameType}] game tool "${tool.name}" was accepted with playerId=null (privilege escalation risk)`,
    );
  }

  // Invariant 2: every system action rejects non-null playerId
  for (const type of systemActionTypes) {
    const accepted = plugin.validateAction(initialState, 'someone', { type });
    assert.equal(
      accepted,
      false,
      `[${plugin.gameType}] system action "${type}" was accepted with non-null playerId (spoofing risk)`,
    );
  }

  // Invariant 3: no overlap
  const toolNames = new Set((plugin.gameTools ?? []).map((t) => t.name));
  for (const type of systemActionTypes) {
    assert.ok(
      !toolNames.has(type),
      `[${plugin.gameType}] action type "${type}" appears both in gameTools and SYSTEM_ACTION_TYPES`,
    );
  }
}

async function runGame(plugin, config, playerIds, actions) {
  const room = GameRoom.create(plugin, config, 'drift_' + plugin.gameType, playerIds);
  await room.handleAction(null, { type: 'game_start' });
  for (const act of actions) {
    await room.handleAction(act.playerId ?? null, act.action);
    if (room.isOver()) break;
  }
  // If game never finished naturally, force-close with a timeout.
  while (!room.isOver()) {
    await room.handleAction(null, { type: 'round_timeout' });
  }
  const outcome = room.getOutcome();
  room.cancelTimer();
  return outcome;
}

async function checkDeterminism(plugin, config, playerIds, actions) {
  const a = await runGame(plugin, config, playerIds, actions);
  const b = await runGame(plugin, config, playerIds, actions);
  assert.deepEqual(
    a,
    b,
    `[${plugin.gameType}] outcomes diverge across identical runs — plugin not deterministic`,
  );
}

async function main() {
  console.log('Classics drift / invariant checks');
  console.log('='.repeat(72));

  // --- PD ---
  assertToolIsolation(
    PrisonersDilemmaPlugin,
    PRISONERS_DILEMMA_SYSTEM_ACTION_TYPES,
    PrisonersDilemmaPlugin.createInitialState({
      ...DEFAULT_PD_CONFIG,
      playerIds: ['alice', 'bob'],
    }),
  );
  await checkDeterminism(
    PrisonersDilemmaPlugin,
    { ...DEFAULT_PD_CONFIG, playerIds: ['alice', 'bob'], rounds: 4 },
    ['alice', 'bob'],
    [
      { playerId: 'alice', action: { type: 'submit_choice', choice: 'cooperate' } },
      { playerId: 'bob', action: { type: 'submit_choice', choice: 'defect' } },
      { playerId: 'alice', action: { type: 'submit_choice', choice: 'defect' } },
      { playerId: 'bob', action: { type: 'submit_choice', choice: 'defect' } },
      { playerId: 'alice', action: { type: 'submit_choice', choice: 'cooperate' } },
      { playerId: 'bob', action: { type: 'submit_choice', choice: 'cooperate' } },
      { playerId: 'alice', action: { type: 'submit_choice', choice: 'defect' } },
      { playerId: 'bob', action: { type: 'submit_choice', choice: 'cooperate' } },
    ],
  );
  console.log('✓ prisoners-dilemma: isolation + determinism');

  // --- Stag Hunt ---
  assertToolIsolation(
    StagHuntPlugin,
    STAG_HUNT_SYSTEM_ACTION_TYPES,
    StagHuntPlugin.createInitialState({
      ...DEFAULT_SH_CONFIG,
      playerIds: ['a', 'b', 'c'],
    }),
  );
  await checkDeterminism(
    StagHuntPlugin,
    { ...DEFAULT_SH_CONFIG, playerIds: ['a', 'b', 'c'], rounds: 3, communication: false },
    ['a', 'b', 'c'],
    [
      { playerId: 'a', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'b', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'c', action: { type: 'submit_choice', choice: 'hare' } },
      { playerId: 'a', action: { type: 'submit_choice', choice: 'hare' } },
      { playerId: 'b', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'c', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'a', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'b', action: { type: 'submit_choice', choice: 'stag' } },
      { playerId: 'c', action: { type: 'submit_choice', choice: 'stag' } },
    ],
  );
  console.log('✓ stag-hunt: isolation + determinism');

  // --- Tragedy of the Commons ---
  assertToolIsolation(
    TragedyCommonsPlugin,
    TRAGEDY_COMMONS_SYSTEM_ACTION_TYPES,
    TragedyCommonsPlugin.createInitialState({
      ...DEFAULT_TC_CONFIG,
      playerIds: ['a', 'b', 'c'],
    }),
  );
  await checkDeterminism(
    TragedyCommonsPlugin,
    { ...DEFAULT_TC_CONFIG, playerIds: ['a', 'b', 'c'], rounds: 4 },
    ['a', 'b', 'c'],
    [
      { playerId: 'a', action: { type: 'set_extraction', rate: 0.2 } },
      { playerId: 'b', action: { type: 'set_extraction', rate: 0.3 } },
      { playerId: 'c', action: { type: 'set_extraction', rate: 0.1 } },
      { playerId: 'a', action: { type: 'set_extraction', rate: 0.25 } },
      { playerId: 'b', action: { type: 'set_extraction', rate: 0.25 } },
      { playerId: 'c', action: { type: 'set_extraction', rate: 0.25 } },
      { playerId: 'a', action: { type: 'set_extraction', rate: 0.15 } },
      { playerId: 'b', action: { type: 'set_extraction', rate: 0.15 } },
      { playerId: 'c', action: { type: 'set_extraction', rate: 0.15 } },
      { playerId: 'a', action: { type: 'set_extraction', rate: 0.4 } },
      { playerId: 'b', action: { type: 'set_extraction', rate: 0.4 } },
      { playerId: 'c', action: { type: 'set_extraction', rate: 0.4 } },
    ],
  );
  console.log('✓ tragedy-commons: isolation + determinism');

  console.log('='.repeat(72));
  console.log('All drift + determinism checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
