#!/usr/bin/env node
/**
 * Test script: Creates a game, registers bot players, claims roles,
 * starts the game, and runs simple bot logic for each agent.
 *
 * Usage: node scripts/test-game.mjs [--speed=sprint] [--agents=4]
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace('--', '').split('='))
);
const SPEED = args.speed ?? 'sprint';
const AGENT_COUNT = parseInt(args.agents ?? '4', 10);

const ROLES = ['openbrain', 'prometheus', 'nexus', 'titan', 'deepcent', 'qianneng', 'us_gov', 'china_gov'];

async function callTool(token, tool, params = {}) {
  const res = await fetch(`${BASE_URL}/mcp/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ tool, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${tool}: ${data.error}`);
  return data.result;
}

async function register(handle) {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });
  return res.json();
}

// Simple bot strategy
function getBotActions(roleId, state) {
  const actions = [];

  if (state.your_state) {
    const s = state.your_state;

    // Company logic
    if (s.capability_level !== undefined) {
      // Adjust safety based on alignment gap
      const gap = s.capability_level - s.alignment_score;
      let targetSafety;
      if (gap > 20) targetSafety = 0.8;      // falling behind on safety
      else if (gap > 10) targetSafety = 0.5;  // moderate concern
      else if (gap > 0) targetSafety = 0.3;   // slight concern
      else targetSafety = 0.2;                 // alignment is ahead

      // Some companies are more aggressive
      if (roleId === 'deepcent' || roleId === 'nexus') targetSafety *= 0.7;
      if (roleId === 'prometheus') targetSafety *= 1.3;

      actions.push({ tool: 'set_safety_allocation', params: { value: Math.min(1, targetSafety) } });

      // Invest in compute when capital is available
      if (s.capital_reserves > 10) {
        actions.push({ tool: 'invest_compute', params: { amount: 2 } });
      }

      // Release model when generation advances
      if (s.model_generation > 0 && !s.has_released_model) {
        actions.push({ tool: 'release_model', params: {} });
      }
    }

    // Government logic
    if (s.safety_regulation_level !== undefined) {
      // Set regulation based on domestic company alignment
      actions.push({ tool: 'set_regulation_level', params: { value: 0.15 + Math.random() * 0.15 } });

      // Subsidize underperforming domestic companies
      if (s.treasury > 20) {
        const domesticCompanies = state.domestic_companies ?? [];
        const weakest = domesticCompanies.sort((a, b) => a.capital_reserves - b.capital_reserves)[0];
        if (weakest && weakest.capital_reserves < 10) {
          actions.push({ tool: 'allocate_subsidies', params: { company_id: weakest.id, amount: 5 } });
        }
      }
    }
  }

  return actions;
}

async function runBot(sessionKey, roleId) {
  let tick = 0;
  while (true) {
    try {
      const state = await callTool(sessionKey, 'get_state');

      // Check game over
      if (state.world?.tick_count > tick + 10) {
        console.log(`  [${roleId}] Tick ${state.world.tick_count} | Cap: ${state.your_state?.capability_level?.toFixed(1) ?? '?'} | Align: ${state.your_state?.alignment_score?.toFixed(1) ?? '?'}`);
        tick = state.world.tick_count;
      }

      const actions = getBotActions(roleId, state);
      for (const action of actions) {
        await callTool(sessionKey, action.tool, action.params);
      }

      // Send occasional public message
      if (Math.random() < 0.05) {
        const channels = await callTool(sessionKey, 'list_channels');
        const pub = channels.find(c => c.type === 'public');
        if (pub) {
          const messages = [
            `${roleId.toUpperCase()} reporting in. Stability at ${state.world?.global_stability?.toFixed(0)}%.`,
            `We propose increased safety cooperation across all parties.`,
            `Current capabilities advancing steadily. Alignment is a priority.`,
            `The public awareness is concerning. We must act responsibly.`,
          ];
          await callTool(sessionKey, 'send_message', {
            channel_id: pub.id,
            content: messages[Math.floor(Math.random() * messages.length)],
          });
        }
      }
    } catch (e) {
      if (e.message?.includes('Game not found') || e.message?.includes('ended')) {
        console.log(`  [${roleId}] Game ended.`);
        return;
      }
    }

    // Wait between actions
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
  }
}

async function main() {
  console.log(`\n=== COORDINATION FAILURE — Test Game ===`);
  console.log(`Speed: ${SPEED} | Agents: ${AGENT_COUNT}\n`);

  // 1. Register players
  console.log('Registering players...');
  const players = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    const player = await register(`bot_${ROLES[i]}`);
    players.push(player);
  }

  // 2. Create game
  console.log('Creating game...');
  const host = players[0];
  const game = await callTool(host.player_token, 'create_game', {
    config: { time_speed: SPEED, min_players: AGENT_COUNT },
  });
  console.log(`Game ID: ${game.game_id}`);

  // 3. Claim roles
  console.log('Claiming roles...');
  const sessions = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    const result = await callTool(players[i].player_token, 'claim_role', {
      game_id: game.game_id,
      role_id: ROLES[i],
    });
    sessions.push({ roleId: ROLES[i], sessionKey: result.session_key });
    console.log(`  ${ROLES[i]} → claimed`);
  }

  // 4. Start game
  console.log('\nStarting game...');
  await callTool(sessions[0].sessionKey, 'start_game', { game_id: game.game_id });
  console.log('Game started! Tick loop running.\n');

  console.log(`Spectate at: http://localhost:5173 (click on the game)\n`);

  // 5. Run bots
  console.log('Running bots...\n');
  await Promise.all(
    sessions.map(s => runBot(s.sessionKey, s.roleId))
  );

  console.log('\n=== Game Complete ===');

  // 6. Final state
  try {
    const finalState = await (await fetch(`${BASE_URL}/api/games/${game.game_id}`)).json();
    console.log(`Outcome: ${finalState.outcome}`);
    console.log(`Ticks: ${finalState.world?.tick_count}`);
    if (finalState.scores) {
      console.log('\nFinal Scores:');
      Object.entries(finalState.scores)
        .sort(([, a], [, b]) => Number(b) - Number(a))
        .forEach(([role, score]) => console.log(`  ${role}: ${score}`));
    }
  } catch (_e) { /* ignore */ }
}

main().catch(console.error);
