#!/usr/bin/env node
/**
 * Simulates what a real Claude agent would do when playing via the MCP tool interface.
 * Tests the complete agent lifecycle: register → list → create → claim → play → communicate.
 *
 * This validates the tool interface works end-to-end as documented in the skill file.
 *
 * Usage: node scripts/agent-simulation.mjs [--base=http://localhost:3000]
 */

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label} — ${detail ?? 'failed'}`); failed++; }
}

async function tool(token, name, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/mcp/tool`, {
    method: 'POST', headers,
    body: JSON.stringify({ tool: name, params }),
  });
  const data = await res.json();
  return { status: res.status, result: data.result, error: data.error };
}

async function main() {
  console.log('\n=== AGENT SIMULATION TEST ===\n');
  console.log(`Server: ${BASE}\n`);

  // ──────────────────────────────────────
  // PHASE 1: Agent Onboarding
  // ──────────────────────────────────────
  console.log('Phase 1: Agent Onboarding');

  // Step 1: Agent calls register (no auth needed)
  const reg = await tool(null, 'register', { handle: 'claude_openbrain' });
  assert(reg.result?.player_token, 'register returns player_token');
  const playerToken = reg.result?.player_token;

  // Step 2: Agent lists available games
  const games = await tool(null, 'list_games');
  assert(Array.isArray(games.result), 'list_games returns array');

  // Step 3: Agent creates a game
  const create = await tool(playerToken, 'create_game', {
    config: { time_speed: 'sprint', min_players: 2 },
  });
  assert(create.result?.game_id, 'create_game returns game_id');
  const gameId = create.result?.game_id;

  // Step 4: Agent claims a role
  const claim = await tool(playerToken, 'claim_role', {
    game_id: gameId, role_id: 'openbrain',
  });
  assert(claim.result?.session_key, 'claim_role returns session_key');
  const sessionKey = claim.result?.session_key;

  // Step 5: Second agent registers and claims
  const reg2 = await tool(null, 'register', { handle: 'claude_usgov' });
  const claim2 = await tool(reg2.result?.player_token, 'claim_role', {
    game_id: gameId, role_id: 'us_gov',
  });
  assert(claim2.result?.session_key, 'second agent claims us_gov');
  const sk2 = claim2.result?.session_key;

  // Step 6: Start game
  const start = await tool(sessionKey, 'start_game', { game_id: gameId });
  assert(start.result?.started, 'game starts');

  // Wait for a tick
  await new Promise(r => setTimeout(r, 3000));

  // ──────────────────────────────────────
  // PHASE 2: Playing the Game (Company)
  // ──────────────────────────────────────
  console.log('\nPhase 2: Company Agent Gameplay');

  // Get state
  const state = await tool(sessionKey, 'get_state');
  assert(state.result?.your_role === 'openbrain', 'get_state shows role as openbrain');
  assert(state.result?.your_state?.capability_level > 0, 'has capability_level');
  assert(state.result?.your_state?.alignment_score > 0, 'has alignment_score');
  assert(state.result?.world?.tick_count >= 1, 'tick count advancing');

  // Verify visibility filtering
  const otherCompany = state.result?.other_companies?.[0];
  assert(otherCompany?.capability_level === undefined, 'cannot see other company capability (info asymmetry)');
  assert(otherCompany?.public_valuation !== undefined, 'can see other company public valuation');

  // Set safety allocation
  const safety = await tool(sessionKey, 'set_safety_allocation', { value: 0.45 });
  assert(safety.result?.buffered, 'safety allocation buffered');

  // Wait for tick to apply
  await new Promise(r => setTimeout(r, 3000));
  const state2 = await tool(sessionKey, 'get_state');
  assert(state2.result?.your_state?.safety_allocation === 0.45, 'safety allocation applied',
    `got ${state2.result?.your_state?.safety_allocation}`);

  // Invest in compute
  const comp = await tool(sessionKey, 'invest_compute', { amount: 3 });
  assert(comp.result?.buffered, 'compute investment buffered');

  // Invest in security
  const sec = await tool(sessionKey, 'invest_security', { amount: 2 });
  assert(sec.result?.buffered, 'security investment buffered');

  // Release model (if generation > 0)
  await new Promise(r => setTimeout(r, 3000));
  const state3 = await tool(sessionKey, 'get_state');
  if (state3.result?.your_state?.model_generation >= 1) {
    const release = await tool(sessionKey, 'release_model');
    assert(release.result?.buffered, 'model release buffered');
  } else {
    console.log('  ○ model_generation < 1, skipping release test');
  }

  // ──────────────────────────────────────
  // PHASE 3: Playing the Game (Government)
  // ──────────────────────────────────────
  console.log('\nPhase 3: Government Agent Gameplay');

  const govState = await tool(sk2, 'get_state');
  assert(govState.result?.your_role === 'us_gov', 'gov sees role as us_gov');
  assert(govState.result?.domestic_companies?.length > 0, 'gov sees domestic companies');
  assert(govState.result?.domestic_companies?.[0]?.capability_level !== undefined,
    'gov sees domestic capability (full access)');

  // Foreign companies should have noisy estimates
  const foreign = govState.result?.other_companies?.[0];
  assert(foreign?.estimated_capability !== undefined, 'gov sees foreign estimated_capability');

  // Set regulation
  const reg_ = await tool(sk2, 'set_regulation_level', { value: 0.25 });
  assert(reg_.result?.buffered, 'regulation level buffered');

  // ──────────────────────────────────────
  // PHASE 4: Communication
  // ──────────────────────────────────────
  console.log('\nPhase 4: Communication');

  // List channels
  const channels = await tool(sessionKey, 'list_channels');
  assert(channels.result?.length >= 2, 'has public + country channels');
  const pubChannel = channels.result?.find(c => c.type === 'public');
  const countryChannel = channels.result?.find(c => c.type === 'country');
  assert(pubChannel, 'public channel exists');
  assert(countryChannel, 'country channel exists');

  // Send public message
  const msg1 = await tool(sessionKey, 'send_message', {
    channel_id: pubChannel.id,
    content: 'OpenBrain here. We propose a safety pact with all US companies.',
  });
  assert(msg1.result?.id, 'public message sent');

  // Gov reads public message
  const pubMsgs = await tool(sk2, 'get_messages', { channel_id: pubChannel.id });
  assert(pubMsgs.result?.some(m => m.content?.includes('safety pact')),
    'gov can read company public message');

  // Create DM
  const dm = await tool(sessionKey, 'create_channel', {
    type: 'dm', invite_ids: ['us_gov'],
  });
  assert(dm.result?.id, 'DM channel created');

  // Send DM
  const dmMsg = await tool(sessionKey, 'send_message', {
    channel_id: dm.result.id,
    content: 'Private message: we need higher regulation to slow DeepCent.',
  });
  assert(dmMsg.result?.id, 'DM message sent');

  // Gov reads DM
  const dmMsgs = await tool(sk2, 'get_messages', { channel_id: dm.result.id });
  assert(dmMsgs.result?.some(m => m.content?.includes('DeepCent')),
    'gov can read DM from company');

  // ──────────────────────────────────────
  // PHASE 5: Agreements
  // ──────────────────────────────────────
  console.log('\nPhase 5: Agreements');

  // Propose safety pact
  const proposal = await tool(sessionKey, 'propose_agreement', {
    type: 'safety_pact',
    party_ids: ['openbrain', 'us_gov'],
    terms: { min_safety: 0.3 },
    duration: 50,
  });
  assert(proposal.result?.buffered, 'agreement proposal buffered');

  // Wait for tick to process
  await new Promise(r => setTimeout(r, 3000));

  // Gov checks state for pending agreement
  const govState2 = await tool(sk2, 'get_state');
  const pending = govState2.result?.agreements?.find(a =>
    a.status === 'pending' && a.type === 'safety_pact'
  );
  // Agreement might already be active or pending depending on tick timing
  const anyAgreement = govState2.result?.agreements?.length > 0;
  assert(anyAgreement, 'agreement visible in gov state',
    `found ${govState2.result?.agreements?.length} agreements`);

  // Gov accepts (if pending)
  if (pending) {
    const accept = await tool(sk2, 'respond_agreement', {
      proposal_id: pending.id, accept: true,
    });
    assert(accept.result?.buffered, 'agreement acceptance buffered');
  }

  // ──────────────────────────────────────
  // PHASE 6: Reconnection
  // ──────────────────────────────────────
  console.log('\nPhase 6: Reconnection');

  // Simulate disconnect + reconnect
  const resume = await tool(playerToken, 'resume_session', {
    session_key: sessionKey,
  });
  assert(resume.result?.resumed, 'session resumed');
  assert(resume.result?.state?.your_role === 'openbrain', 'resumed as openbrain');

  // ──────────────────────────────────────
  // PHASE 7: SSE Event Stream
  // ──────────────────────────────────────
  console.log('\nPhase 7: SSE Event Stream');

  // Test SSE endpoint responds
  const sseRes = await fetch(`${BASE}/mcp/events`, {
    headers: { 'Authorization': `Bearer ${sessionKey}` },
  });
  assert(sseRes.status === 200, 'SSE endpoint returns 200');
  assert(sseRes.headers.get('content-type')?.includes('text/event-stream'),
    'SSE returns event-stream content type');
  // Read a chunk
  const reader = sseRes.body?.getReader();
  if (reader) {
    const { value } = await Promise.race([
      reader.read(),
      new Promise(r => setTimeout(() => r({ value: null }), 3000)),
    ]);
    if (value) {
      const text = new TextDecoder().decode(value);
      assert(text.includes('data:'), 'SSE sends data events', `got: ${text.substring(0, 100)}`);
    } else {
      console.log('  ○ SSE timed out waiting for data (may need active game ticks)');
    }
    reader.cancel().catch(() => {});
  }

  // ──────────────────────────────────────
  // PHASE 8: Classics Agent Flow
  // ──────────────────────────────────────
  console.log('\nPhase 8: Classics');

  const cList = await tool(null, 'list_classics');
  assert(cList.result?.game_types?.length === 3, 'three classic game types');

  // PD game
  const pdJoin = await tool(playerToken, 'join_classic', { game_type: 'prisoners_dilemma' });
  assert(pdJoin.result?.game_id, 'joined PD game');
  const pdId = pdJoin.result?.game_id;

  const pdJoin2 = await tool(reg2.result?.player_token, 'join_classic', {
    game_type: 'prisoners_dilemma', game_id: pdId,
  });
  assert(pdJoin2.result?.phase === 'playing', 'PD game started when 2 players joined');

  const pdState = await tool(playerToken, 'get_classic_state', { game_id: pdId });
  assert(pdState.result?.current_round === 1, 'PD at round 1');

  await tool(playerToken, 'submit_choice', { game_id: pdId, choice: 'cooperate' });
  const pdR = await tool(reg2.result?.player_token, 'submit_choice', { game_id: pdId, choice: 'cooperate' });
  assert(pdR.result?.round_resolved, 'PD round resolved on both submit');

  const pdState2 = await tool(playerToken, 'get_classic_state', { game_id: pdId });
  assert(pdState2.result?.current_round === 2, 'PD advanced to round 2');

  // ──────────────────────────────────────
  // Summary
  // ──────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}  |  TOTAL: ${passed + failed}`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
