#!/usr/bin/env node
/**
 * Parameter Tuning Script
 * Runs N headless games with the engine directly (no server needed)
 * and reports outcome distribution, strategy viability, and timing.
 *
 * Usage: node scripts/tune-parameters.mjs [--games=20] [--speed=sprint]
 */

// Dynamic import of engine (TypeScript source via tsx)
const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace('--', '').split('='))
);
const NUM_GAMES = parseInt(args.games ?? '20', 10);
const SPEED = args.speed ?? 'sprint';

async function main() {
  // Import engine
  const { createInitialState, tick, createDefaultConfig, TIME_SPEED_PRESETS } = await import('../packages/engine/src/index.ts');

  console.log(`\n=== PARAMETER TUNING — ${NUM_GAMES} games at ${SPEED} speed ===\n`);

  const outcomes = { aligned_agi: 0, misaligned_agi: 0, timeout: 0, nationalization_takeover: 0, stable_world: 0 };
  const gameLengths = [];
  const peakCapabilities = [];
  const finalAlignments = [];
  const eventCounts = [];
  const winningCompanies = [];

  for (let g = 0; g < NUM_GAMES; g++) {
    const seed = 1000 + g;
    const config = createDefaultConfig({ time_speed: SPEED, seed });
    let state = createInitialState(`tune-${g}`, config);
    state.phase = 'running';

    const timeConfig = TIME_SPEED_PRESETS[SPEED];
    let totalEvents = 0;

    // Simple bot strategy: randomized per game
    const companySafety = {};
    for (const c of config.companies) {
      companySafety[c.id] = 0.1 + Math.random() * 0.6; // 10%-70% safety
    }

    for (let t = 1; t <= timeConfig.total_ticks; t++) {
      // Generate bot actions
      const actions = [];

      for (const c of config.companies) {
        // Adjust safety based on alignment gap + base personality
        const company = state.companies[c.id];
        if (!company) continue;
        const gap = company.capability_level - company.alignment_score;
        let safety = companySafety[c.id];
        if (gap > 20) safety = Math.min(0.9, safety + 0.3);
        else if (gap > 10) safety = Math.min(0.8, safety + 0.1);

        actions.push({ type: 'set_safety_allocation', role_id: c.id, value: safety });

        // Invest in compute
        if (company.capital_reserves > 10 && t % 5 === 0) {
          actions.push({ type: 'invest_compute', role_id: c.id, amount: 3 });
        }
      }

      for (const gov of config.governments) {
        actions.push({
          type: 'set_regulation_level',
          role_id: gov.id,
          value: 0.1 + t * 0.002,
        });
      }

      const result = tick({
        current_state: state,
        player_actions: actions,
        tick_number: t,
      });

      state = result.new_state;
      totalEvents += result.events.filter(e => e.type === 'world_event').length;

      if (state.phase === 'ended') break;
    }

    // Record results
    const outcome = state.outcome ?? 'timeout';
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    gameLengths.push(state.world.tick_count);
    eventCounts.push(totalEvents);

    const companies = Object.values(state.companies);
    const maxCap = Math.max(...companies.map(c => c.capability_level));
    const avgAlign = companies.reduce((s, c) => s + c.alignment_score, 0) / companies.length;
    peakCapabilities.push(maxCap);
    finalAlignments.push(avgAlign);

    if (state.outcome === 'aligned_agi' || state.outcome === 'misaligned_agi') {
      const leader = Object.entries(state.companies).sort((a, b) => b[1].capability_level - a[1].capability_level)[0];
      winningCompanies.push(leader[0]);
    }

    if ((g + 1) % 5 === 0) {
      process.stdout.write(`  Completed ${g + 1}/${NUM_GAMES} games...\r`);
    }
  }

  console.log(`\n\n--- OUTCOME DISTRIBUTION ---`);
  for (const [outcome, count] of Object.entries(outcomes)) {
    const pct = ((count / NUM_GAMES) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / NUM_GAMES * 40));
    console.log(`  ${outcome.padEnd(25)} ${String(count).padStart(3)} (${pct}%) ${bar}`);
  }

  console.log(`\n--- GAME LENGTH ---`);
  const avgLength = gameLengths.reduce((s, v) => s + v, 0) / gameLengths.length;
  const minLength = Math.min(...gameLengths);
  const maxLength = Math.max(...gameLengths);
  console.log(`  Average: ${avgLength.toFixed(0)} ticks`);
  console.log(`  Range: ${minLength} - ${maxLength} ticks`);

  console.log(`\n--- CAPABILITY ---`);
  const avgPeak = peakCapabilities.reduce((s, v) => s + v, 0) / peakCapabilities.length;
  console.log(`  Average peak capability: ${avgPeak.toFixed(1)}`);
  console.log(`  Games reaching AGI (95+): ${peakCapabilities.filter(c => c >= 95).length}/${NUM_GAMES}`);

  console.log(`\n--- ALIGNMENT ---`);
  const avgFinalAlign = finalAlignments.reduce((s, v) => s + v, 0) / finalAlignments.length;
  console.log(`  Average final alignment: ${avgFinalAlign.toFixed(1)}`);
  console.log(`  Games with alignment > 60: ${finalAlignments.filter(a => a > 60).length}/${NUM_GAMES}`);
  console.log(`  Games with alignment < 40: ${finalAlignments.filter(a => a < 40).length}/${NUM_GAMES}`);

  console.log(`\n--- EVENTS ---`);
  const avgEvents = eventCounts.reduce((s, v) => s + v, 0) / eventCounts.length;
  console.log(`  Average events per game: ${avgEvents.toFixed(1)}`);

  if (winningCompanies.length > 0) {
    console.log(`\n--- AGI LEADERS ---`);
    const counts = {};
    for (const c of winningCompanies) counts[c] = (counts[c] ?? 0) + 1;
    for (const [company, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${company}: ${count} times`);
    }
  }

  // Health checks
  console.log(`\n--- TUNING HEALTH ---`);
  const alignedPct = (outcomes.aligned_agi ?? 0) / NUM_GAMES;
  const misalignedPct = (outcomes.misaligned_agi ?? 0) / NUM_GAMES;
  const timeoutPct = (outcomes.timeout ?? 0) / NUM_GAMES;

  if (alignedPct > 0.8) console.log('  ⚠ Too many aligned AGI outcomes — game may be too easy');
  else if (alignedPct < 0.1) console.log('  ⚠ Too few aligned AGI outcomes — safety may be too costly');
  else console.log('  ✓ Aligned AGI rate is reasonable');

  if (misalignedPct > 0.3) console.log('  ⚠ High misalignment rate — safety mechanisms may be insufficient');
  else console.log('  ✓ Misalignment rate is acceptable');

  if (timeoutPct > 0.5) console.log('  ⚠ Too many timeouts — capability growth may be too slow');
  else if (timeoutPct < 0.05) console.log('  ⚠ Too few timeouts — games may resolve too quickly');
  else console.log('  ✓ Timeout rate is reasonable');

  if (avgEvents < 3) console.log('  ⚠ Too few events — increase event_frequency_base');
  else if (avgEvents > 30) console.log('  ⚠ Too many events — decrease event_frequency_base');
  else console.log('  ✓ Event frequency is reasonable');

  console.log(`\n=== TUNING COMPLETE ===\n`);
}

main().catch(console.error);
