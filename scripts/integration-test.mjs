#!/usr/bin/env node
/**
 * Comprehensive integration test — exercises every API endpoint and MCP tool,
 * validates responses, and reports pass/fail for each.
 */

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} — ${detail ?? 'assertion failed'}`);
    failed++;
  }
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function tool(token, toolName, params = {}) {
  const res = await fetch(`${BASE}/mcp/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ tool: toolName, params }),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log('\n=== COORDINATION FAILURE — Integration Tests ===\n');

  // ─── Health ───
  console.log('Health:');
  const health = await api('GET', '/health');
  assert(health.status === 200, 'GET /health returns 200');
  assert(health.data.status === 'ok', 'health status is ok');

  // ─── Registration ───
  console.log('\nRegistration:');
  const reg1 = await api('POST', '/api/register', { handle: 'alice' });
  assert(reg1.status === 200, 'POST /api/register returns 200');
  assert(reg1.data.player_token, 'returns player_token');
  assert(reg1.data.player_id, 'returns player_id');
  assert(reg1.data.handle === 'alice', 'handle is alice');
  const token1 = reg1.data.player_token;

  const reg2 = await api('POST', '/api/register', { handle: 'bob' });
  const token2 = reg2.data.player_token;
  assert(token2 && token2 !== token1, 'second player gets different token');

  // ─── List games (empty) ───
  console.log('\nList games (empty):');
  const list0 = await api('GET', '/api/games');
  assert(list0.status === 200, 'GET /api/games returns 200');
  assert(Array.isArray(list0.data), 'returns array');
  assert(list0.data.length === 0, 'no games initially');

  // ─── Unauthenticated tool call ───
  console.log('\nAuth:');
  // Public tools (register, list_games, list_classics) work without auth
  const publicCall = await fetch(`${BASE}/mcp/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'list_games', params: {} }),
  });
  assert(publicCall.status === 200, 'public tools work without auth');

  // Non-public tools require auth
  const noAuth = await fetch(`${BASE}/mcp/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'create_game', params: {} }),
  });
  assert(noAuth.status === 401, 'protected tools return 401 without auth');

  // ─── Tool listing ───
  console.log('\nTool listing:');
  const tools = await api('GET', '/mcp/tools');
  assert(tools.status === 200, 'GET /mcp/tools returns 200');
  assert(tools.data.tools.length >= 20, `lists ${tools.data.tools.length} tools (expected 20+)`);

  // ─── list_games via tool ───
  console.log('\nlist_games tool:');
  const lg = await tool(token1, 'list_games');
  assert(lg.status === 200, 'list_games returns 200');
  assert(Array.isArray(lg.data.result), 'returns array');

  // ─── create_game ───
  console.log('\ncreate_game:');
  const cg = await tool(token1, 'create_game', { config: { time_speed: 'sprint' } });
  assert(cg.status === 200, 'create_game returns 200');
  assert(cg.data.result?.game_id, 'returns game_id');
  const gameId = cg.data.result.game_id;

  // ─── Game in list ───
  const lg2 = await tool(token1, 'list_games');
  assert(lg2.data.result.length === 1, 'game appears in list');
  assert(lg2.data.result[0].phase === 'lobby', 'game phase is lobby');

  // ─── Game detail (lobby) ───
  console.log('\nGame detail (lobby):');
  const gd = await api('GET', `/api/games/${gameId}`);
  assert(gd.status === 200, 'GET /api/games/:id returns 200');
  assert(gd.data.phase === 'lobby', 'phase is lobby');
  assert(gd.data.available_roles.length === 8, '8 roles available');

  // ─── claim_role ───
  console.log('\nclaim_role:');
  const cr1 = await tool(token1, 'claim_role', { game_id: gameId, role_id: 'openbrain' });
  assert(cr1.status === 200, 'claim_role returns 200');
  assert(cr1.data.result?.session_key, 'returns session_key');
  assert(cr1.data.result?.role_id === 'openbrain', 'role_id is openbrain');
  const sk1 = cr1.data.result.session_key;

  // ─── Duplicate role claim fails ───
  const cr1dup = await tool(token2, 'claim_role', { game_id: gameId, role_id: 'openbrain' });
  assert(cr1dup.status === 400, 'duplicate claim returns 400', `got ${cr1dup.status}`);

  // ─── Invalid role fails ───
  const crBad = await tool(token2, 'claim_role', { game_id: gameId, role_id: 'nonexistent' });
  assert(crBad.status === 400, 'invalid role returns 400');

  // ─── Second player claims ───
  const cr2 = await tool(token2, 'claim_role', { game_id: gameId, role_id: 'us_gov' });
  assert(cr2.status === 200, 'second player claims us_gov');
  const sk2 = cr2.data.result.session_key;

  // ─── start_game with too few players ───
  // (min_players defaults to 2, so this should work now with 2 players)

  // ─── start_game ───
  console.log('\nstart_game:');
  const sg = await tool(sk1, 'start_game', { game_id: gameId });
  assert(sg.status === 200, 'start_game returns 200');
  assert(sg.data.result?.started === true, 'game started');

  // ─── Game detail (running) ───
  const gd2 = await api('GET', `/api/games/${gameId}`);
  assert(gd2.status === 200, 'game detail returns 200');
  assert(gd2.data.phase === 'running', 'phase is running');
  assert(gd2.data.companies?.openbrain, 'openbrain company exists');
  assert(gd2.data.governments?.us_gov, 'us_gov government exists');

  // Wait a tick
  await new Promise(r => setTimeout(r, 2500));

  // ─── get_state (company) ───
  console.log('\nget_state (company):');
  const gs1 = await tool(sk1, 'get_state');
  assert(gs1.status === 200, 'get_state returns 200');
  assert(gs1.data.result?.your_role === 'openbrain', 'role is openbrain');
  assert(gs1.data.result?.your_state?.capability_level > 0, 'has capability_level');
  assert(gs1.data.result?.your_state?.alignment_score > 0, 'has alignment_score');
  assert(gs1.data.result?.world?.tick_count >= 1, 'tick count >= 1');
  // Verify visibility filtering — should NOT see other companies' capability
  const otherCompany = gs1.data.result?.other_companies?.[0];
  assert(otherCompany, 'sees other companies');
  assert(otherCompany.capability_level === undefined, 'other company capability is hidden', `got ${otherCompany.capability_level}`);
  assert(otherCompany.public_valuation !== undefined, 'other company valuation is visible');

  // ─── get_state (government) ───
  console.log('\nget_state (government):');
  const gs2 = await tool(sk2, 'get_state');
  assert(gs2.status === 200, 'get_state returns 200');
  assert(gs2.data.result?.your_role === 'us_gov', 'role is us_gov');
  assert(gs2.data.result?.domestic_companies?.length > 0, 'sees domestic companies');
  // Domestic companies should have full capability visible
  const domestic = gs2.data.result?.domestic_companies?.[0];
  assert(domestic?.capability_level !== undefined, 'domestic company capability visible');
  // Foreign companies should have noisy estimates
  const foreign = gs2.data.result?.other_companies?.[0];
  assert(foreign?.estimated_capability !== undefined, 'foreign company has estimated_capability');

  // ─── set_safety_allocation ───
  console.log('\nActions:');
  const ssa = await tool(sk1, 'set_safety_allocation', { value: 0.7 });
  assert(ssa.status === 200, 'set_safety_allocation returns 200');
  assert(ssa.data.result?.buffered === true, 'action buffered');

  // Wait for next tick to apply
  await new Promise(r => setTimeout(r, 2500));
  const gs1b = await tool(sk1, 'get_state');
  assert(gs1b.data.result?.your_state?.safety_allocation === 0.7, 'safety_allocation updated to 0.7', `got ${gs1b.data.result?.your_state?.safety_allocation}`);

  // ─── set_regulation_level (gov) ───
  const srl = await tool(sk2, 'set_regulation_level', { value: 0.4 });
  assert(srl.status === 200, 'set_regulation_level returns 200');

  // ─── invest_compute ───
  const ic = await tool(sk1, 'invest_compute', { amount: 5 });
  assert(ic.status === 200, 'invest_compute returns 200');

  // ─── invest_security ───
  const is_ = await tool(sk1, 'invest_security', { amount: 3 });
  assert(is_.status === 200, 'invest_security returns 200');

  // ─── release_model ───
  const rm = await tool(sk1, 'release_model');
  assert(rm.status === 200, 'release_model returns 200');

  // Wait for tick
  await new Promise(r => setTimeout(r, 2500));
  const gs1c = await tool(sk1, 'get_state');
  assert(gs1c.data.result?.your_state?.releases_count >= 1, 'model released', `releases_count=${gs1c.data.result?.your_state?.releases_count}`);

  // ─── Communication ───
  console.log('\nCommunication:');
  const lc = await tool(sk1, 'list_channels');
  assert(lc.status === 200, 'list_channels returns 200');
  assert(lc.data.result?.length >= 2, 'has at least 2 channels (public + country)');
  const publicCh = lc.data.result.find(c => c.type === 'public');
  assert(publicCh, 'public channel exists');

  // Send message
  const sm = await tool(sk1, 'send_message', { channel_id: publicCh.id, content: 'Testing comms!' });
  assert(sm.status === 200, 'send_message returns 200');
  assert(sm.data.result?.id, 'message has id');
  assert(sm.data.result?.from === 'openbrain', 'message from is openbrain');

  // Get messages
  const gm = await tool(sk1, 'get_messages', { channel_id: publicCh.id });
  assert(gm.status === 200, 'get_messages returns 200');
  assert(gm.data.result?.length >= 1, 'has messages');
  assert(gm.data.result.some(m => m.content === 'Testing comms!'), 'our message appears');

  // Create DM
  const cc = await tool(sk1, 'create_channel', { type: 'dm', invite_ids: ['us_gov'] });
  assert(cc.status === 200, 'create_channel returns 200');
  assert(cc.data.result?.id, 'channel has id');
  assert(cc.data.result?.type === 'dm', 'channel type is dm');

  // Send DM
  const dmId = cc.data.result.id;
  const dm = await tool(sk1, 'send_message', { channel_id: dmId, content: 'Private DM to gov' });
  assert(dm.status === 200, 'send DM returns 200');

  // Gov can read DM
  const dmRead = await tool(sk2, 'get_messages', { channel_id: dmId });
  assert(dmRead.status === 200, 'gov can read DM');
  assert(dmRead.data.result?.some(m => m.content === 'Private DM to gov'), 'DM content visible to gov');

  // ─── Agreements ───
  console.log('\nAgreements:');
  const pa = await tool(sk1, 'propose_agreement', {
    type: 'safety_pact',
    party_ids: ['openbrain', 'us_gov'],
    terms: { min_safety: 0.3 },
    duration: 100,
  });
  assert(pa.status === 200, 'propose_agreement returns 200');

  // ─── start-with-bots endpoint ───
  console.log('\nStart with bots:');
  const cg2 = await tool(token1, 'create_game', { config: { time_speed: 'sprint' } });
  const gameId2 = cg2.data.result.game_id;
  const swb = await api('POST', `/api/games/${gameId2}/start-with-bots`, { fill_all: true });
  assert(swb.status === 200, 'start-with-bots returns 200');
  assert(swb.data.started === true, 'game started');
  assert(swb.data.bots?.length === 8, '8 bots assigned');

  await new Promise(r => setTimeout(r, 3000));

  const gd3 = await api('GET', `/api/games/${gameId2}`);
  assert(gd3.data.phase === 'running', 'bot game is running');
  assert(gd3.data.world?.tick_count >= 1, 'bot game has ticked');
  // Verify serialization
  const govSubs = gd3.data.governments?.us_gov?.subsidies_allocated;
  assert(typeof govSubs === 'object' && !(govSubs instanceof Array), 'subsidies_allocated is plain object');

  // ─── resume_session ───
  console.log('\nResume session:');
  const rs = await tool(token1, 'resume_session', { session_key: sk1 });
  assert(rs.status === 200, 'resume_session returns 200');
  assert(rs.data.result?.resumed === true, 'session resumed');
  assert(rs.data.result?.state?.your_role === 'openbrain', 'resumed as openbrain');

  // ─── Invalid session key ───
  const rsb = await tool(token1, 'resume_session', { session_key: 'invalid-key-12345' });
  assert(rsb.status === 400, 'invalid session key returns 400');

  // ─── 404 game ───
  console.log('\nEdge cases:');
  const gd404 = await api('GET', '/api/games/nonexistent-id');
  assert(gd404.status === 404, 'nonexistent game returns 404');

  // ─── Unknown tool ───
  const ut = await tool(token1, 'nonexistent_tool');
  assert(ut.status === 400, 'unknown tool returns 400');

  // ═══ Summary ═══
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}  |  TOTAL: ${passed + failed}`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
