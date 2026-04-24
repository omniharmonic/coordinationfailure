#!/usr/bin/env node
/**
 * Run every Classic game inside Lucian's coordination-games engine
 * using GameRoom. Uses simple deterministic bot strategies. Prints
 * outcomes, payouts (must be zero-sum), and a few invariant checks.
 *
 * Usage: node scripts/run-classics.mjs
 */

import { GameRoom } from '@coordination-games/engine';
import {
  PrisonersDilemmaPlugin,
  DEFAULT_PD_CONFIG,
} from '@coordination-failure/game-prisoners-dilemma';
import {
  StagHuntPlugin,
  DEFAULT_SH_CONFIG,
} from '@coordination-failure/game-stag-hunt';
import {
  TragedyCommonsPlugin,
  DEFAULT_TC_CONFIG,
} from '@coordination-failure/game-tragedy-commons';

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

// Tit-for-tat: cooperate first, then mirror opponent's last move.
function titForTat(history, me) {
  if (history.length === 0) return 'cooperate';
  const last = history[history.length - 1];
  const opponentId = Object.keys(last.choices).find((k) => k !== me);
  return last.choices[opponentId];
}

const alwaysDefect = () => 'defect';
const alwaysCooperate = () => 'cooperate';

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

async function runPrisonersDilemma(label, rounds, stratA, stratB) {
  const cfg = {
    ...DEFAULT_PD_CONFIG,
    playerIds: ['alice', 'bob'],
    rounds,
    turnTimerSeconds: 120,
  };
  const room = GameRoom.create(PrisonersDilemmaPlugin, cfg, `pd_${label}`, cfg.playerIds);
  await room.handleAction(null, { type: 'game_start' });

  while (!room.isOver()) {
    const view = room.getVisibleState('alice');
    const history = view.history ?? [];
    const a = stratA(history, 'alice');
    const b = stratB(history, 'bob');
    await room.handleAction('alice', { type: 'submit_choice', choice: a });
    await room.handleAction('bob', { type: 'submit_choice', choice: b });
  }

  const outcome = room.getOutcome();
  const payouts = room.computePayouts(cfg.playerIds);
  room.cancelTimer();
  return { plugin: 'prisoners-dilemma', label, outcome, payouts };
}

async function runStagHunt(label, rounds, playerIds, pickers) {
  const cfg = {
    ...DEFAULT_SH_CONFIG,
    playerIds,
    rounds,
    communication: false,
    turnTimerSeconds: 120,
  };
  const room = GameRoom.create(StagHuntPlugin, cfg, `sh_${label}`, cfg.playerIds);
  await room.handleAction(null, { type: 'game_start' });

  while (!room.isOver()) {
    for (const id of playerIds) {
      if (room.isOver()) break;
      const choice = pickers[id](room.getVisibleState(id));
      await room.handleAction(id, { type: 'submit_choice', choice });
    }
  }
  const outcome = room.getOutcome();
  const payouts = room.computePayouts(cfg.playerIds);
  room.cancelTimer();
  return { plugin: 'stag-hunt', label, outcome, payouts };
}

async function runTragedyCommons(label, rounds, playerIds, ratePickers) {
  const cfg = {
    ...DEFAULT_TC_CONFIG,
    playerIds,
    rounds,
    turnTimerSeconds: 120,
  };
  const room = GameRoom.create(TragedyCommonsPlugin, cfg, `tc_${label}`, cfg.playerIds);
  await room.handleAction(null, { type: 'game_start' });

  while (!room.isOver()) {
    for (const id of playerIds) {
      if (room.isOver()) break;
      const view = room.getVisibleState(id);
      const rate = ratePickers[id](view);
      await room.handleAction(id, { type: 'set_extraction', rate });
    }
  }
  const outcome = room.getOutcome();
  const payouts = room.computePayouts(cfg.playerIds);
  room.cancelTimer();
  return { plugin: 'tragedy-commons', label, outcome, payouts };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmt(n, decimals = 3) {
  return typeof n === 'number' ? n.toFixed(decimals) : String(n);
}

function checkZeroSum(payouts, label) {
  const sum = [...payouts.values()].reduce((a, b) => a + b, 0);
  const ok = Math.abs(sum) < 1e-6;
  return { ok, sum, label };
}

function printResult(r) {
  console.log(`\n--- [${r.plugin}] ${r.label} ---`);
  console.log('outcome.rankings:');
  for (const rank of r.outcome.rankings) {
    console.log(`  ${rank.id.padEnd(8)} score=${fmt(rank.score)} ${JSON.stringify(
      Object.fromEntries(
        Object.entries(rank).filter(([k]) => !['id', 'score'].includes(k)),
      ),
    )}`);
  }
  console.log('payouts:');
  for (const [id, delta] of r.payouts) {
    console.log(`  ${id.padEnd(8)} ${delta >= 0 ? '+' : ''}${fmt(delta, 4)}`);
  }
  const { ok, sum } = checkZeroSum(r.payouts, r.label);
  console.log(`zero-sum: ${ok ? 'OK' : 'FAIL'} (sum=${fmt(sum, 10)})`);
  return ok;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(72));
  console.log('Coordination Failure → Coordination Games engine integration test');
  console.log('='.repeat(72));

  const results = [];

  // PD scenarios
  results.push(await runPrisonersDilemma('AllC-vs-AllC', 10, alwaysCooperate, alwaysCooperate));
  results.push(await runPrisonersDilemma('AllD-vs-AllD', 10, alwaysDefect, alwaysDefect));
  results.push(await runPrisonersDilemma('TitForTat-vs-AllD', 10, titForTat, alwaysDefect));

  // Stag hunt scenarios
  const threePlayers = ['a', 'b', 'c'];
  const allStag = Object.fromEntries(threePlayers.map((id) => [id, () => 'stag']));
  const allHare = Object.fromEntries(threePlayers.map((id) => [id, () => 'hare']));
  const oneDefector = {
    a: () => 'stag',
    b: () => 'stag',
    c: () => 'hare',
  };
  results.push(await runStagHunt('AllStag', 5, threePlayers, allStag));
  results.push(await runStagHunt('AllHare', 5, threePlayers, allHare));
  results.push(await runStagHunt('OneDefector', 5, threePlayers, oneDefector));

  // Tragedy of the Commons scenarios
  const tcPlayers = ['a', 'b', 'c'];
  const sustainable = Object.fromEntries(tcPlayers.map((id) => [id, () => 0.25]));
  const greedy = Object.fromEntries(tcPlayers.map((id) => [id, () => 0.9]));
  const mixed = {
    a: () => 0.2,
    b: () => 0.4,
    c: () => 0.6,
  };
  results.push(await runTragedyCommons('Sustainable', 6, tcPlayers, sustainable));
  results.push(await runTragedyCommons('Greedy-Collapse', 20, tcPlayers, greedy));
  results.push(await runTragedyCommons('Mixed', 6, tcPlayers, mixed));

  // Report
  let allZeroSum = true;
  for (const r of results) {
    const ok = printResult(r);
    allZeroSum = allZeroSum && ok;
  }

  console.log('\n' + '='.repeat(72));
  console.log(`Summary: ${results.length} games played across 3 classics`);
  console.log(`Zero-sum invariant: ${allZeroSum ? 'ALL PASS' : 'FAIL — see above'}`);
  console.log('='.repeat(72));

  if (!allZeroSum) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
