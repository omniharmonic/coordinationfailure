#!/usr/bin/env node
/**
 * Observation script: Runs 10 sprint games with varying agent counts
 * and strategies. Captures detailed metrics and outputs full report.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ROLES = ['openbrain', 'prometheus', 'nexus', 'titan', 'deepcent', 'qianneng', 'us_gov', 'china_gov'];

const US_COMPANIES = ['openbrain', 'prometheus', 'nexus', 'titan'];
const CHINA_COMPANIES = ['deepcent', 'qianneng'];

const GAME_CONFIGS = [
  { label: 'Full 8p baseline',           agents: 8, speed: 'sprint' },
  { label: 'Full 8p aggressive bots',    agents: 8, speed: 'sprint', aggressive: true },
  { label: 'Full 8p cooperative bots',   agents: 8, speed: 'sprint', cooperative: true },
  { label: '6p no govs',                 agents: 6, speed: 'sprint' },
  { label: 'Full 8p heavy diplomacy',    agents: 8, speed: 'sprint', diplomacy: true },
  { label: 'Full 8p agreement spam',     agents: 8, speed: 'sprint', spam: true },
  { label: '4p US only',                 agents: 4, speed: 'sprint' },
  { label: 'Full 8p mixed strategies',   agents: 8, speed: 'sprint', mixed: true },
  { label: 'Full 8p baseline #2',        agents: 8, speed: 'sprint' },
  { label: 'Full 8p high regulation',    agents: 8, speed: 'sprint', highReg: true },
];

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

function isUS(roleId) {
  return US_COMPANIES.includes(roleId) || roleId === 'us_gov';
}

function getBotActions(roleId, state, tickNum, config) {
  const actions = [];
  const s = state.your_state;
  if (!s) return actions;

  const isCompany = s.capability_level !== undefined;
  const isGov = s.safety_regulation_level !== undefined;

  // ---- COMPANY LOGIC ----
  if (isCompany) {
    const gap = s.capability_level - s.alignment_score;
    let targetSafety;

    if (config.aggressive) {
      // Aggressive: minimal safety
      targetSafety = gap > 25 ? 0.5 : gap > 15 ? 0.25 : 0.1;
    } else if (config.cooperative) {
      // Cooperative: high safety
      targetSafety = gap > 15 ? 0.9 : gap > 5 ? 0.6 : 0.4;
    } else {
      // Default: balanced
      targetSafety = gap > 20 ? 0.8 : gap > 10 ? 0.5 : gap > 0 ? 0.3 : 0.2;
      // Personality modifiers
      if (roleId === 'deepcent' || roleId === 'nexus') targetSafety *= 0.7;
      if (roleId === 'prometheus') targetSafety *= 1.3;
    }

    if (config.mixed) {
      // Mixed: US aggressive, China cooperative
      if (isUS(roleId)) targetSafety = gap > 25 ? 0.5 : 0.15;
      else targetSafety = gap > 10 ? 0.8 : 0.5;
    }

    actions.push({ tool: 'set_safety_allocation', params: { value: Math.min(1, Math.max(0, targetSafety)) } });

    if (s.capital_reserves > 8) {
      actions.push({ tool: 'invest_compute', params: { amount: 3 } });
    }
    if (s.capital_reserves > 15) {
      actions.push({ tool: 'invest_security', params: { amount: 1 } });
    }
    if (s.model_generation > 0 && !s.has_released_model) {
      actions.push({ tool: 'release_model', params: {} });
    }

    // ---- AGREEMENT PROPOSALS (companies) ----
    if (tickNum === 3 && !config.aggressive) {
      // Domestic safety pact
      const allies = isUS(roleId) ? US_COMPANIES : CHINA_COMPANIES;
      const partner = allies.find(r => r !== roleId);
      if (partner) {
        const minSafety = config.cooperative ? 0.6 : (0.3 + Math.random() * 0.3);
        actions.push({ tool: 'propose_agreement', params: {
          type: 'safety_pact', party_ids: [partner],
          terms: { min_safety: Math.round(minSafety * 100) / 100 },
        }});
      }
    }

    if (tickNum === 6) {
      // Cross-country agreement
      const foreign = isUS(roleId) ? 'deepcent' : 'openbrain';
      const types = config.diplomacy
        ? ['non_aggression', 'info_sharing', 'joint_research', 'safety_pact']
        : ['non_aggression', 'info_sharing'];
      const type = types[Math.floor(Math.random() * types.length)];
      actions.push({ tool: 'propose_agreement', params: {
        type, party_ids: [foreign], terms: type === 'safety_pact' ? { min_safety: 0.4 } : {},
      }});
    }

    if (config.spam && tickNum >= 4 && tickNum % 2 === 0) {
      // Spam capital_alliance every 2 ticks
      const targets = [...US_COMPANIES, ...CHINA_COMPANIES].filter(r => r !== roleId);
      const target = targets[Math.floor(Math.random() * targets.length)];
      actions.push({ tool: 'propose_agreement', params: {
        type: 'capital_alliance', party_ids: [target], terms: {},
      }});
    }

    if (config.diplomacy && tickNum === 10) {
      // Multi-party safety pact
      const allOthers = [...US_COMPANIES, ...CHINA_COMPANIES].filter(r => r !== roleId);
      const partner1 = allOthers[0];
      const partner2 = allOthers[2];
      actions.push({ tool: 'propose_agreement', params: {
        type: 'safety_pact', party_ids: [partner1, partner2],
        terms: { min_safety: 0.5 },
      }});
    }

    if (tickNum === 12 && (roleId === 'openbrain' || roleId === 'deepcent')) {
      // Intl safety framework with foreign gov
      const foreignGov = roleId === 'openbrain' ? 'china_gov' : 'us_gov';
      actions.push({ tool: 'propose_agreement', params: {
        type: 'intl_safety_framework', party_ids: [foreignGov],
        terms: { min_regulation: 0.3 + Math.random() * 0.4 },
      }});
    }
  }

  // ---- GOVERNMENT LOGIC ----
  if (isGov) {
    let regLevel;
    if (config.highReg) regLevel = 0.4 + Math.random() * 0.2;
    else if (config.aggressive) regLevel = 0.05 + Math.random() * 0.1;
    else regLevel = 0.15 + Math.random() * 0.15;

    actions.push({ tool: 'set_regulation_level', params: { value: regLevel } });

    if (s.treasury > 20) {
      const domesticCompanies = state.domestic_companies ?? [];
      const weakest = [...domesticCompanies].sort((a, b) => a.capital_reserves - b.capital_reserves)[0];
      if (weakest && weakest.capital_reserves < 12) {
        actions.push({ tool: 'allocate_subsidies', params: { company_id: weakest.id, amount: 5 } });
      }
    }

    if (tickNum === 5) {
      const target = isUS(roleId) ? 'deepcent' : 'openbrain';
      actions.push({ tool: 'initiate_espionage', params: { target_id: target, budget: 5 } });
    }

    if (tickNum === 8) {
      const otherGov = roleId === 'us_gov' ? 'china_gov' : 'us_gov';
      actions.push({ tool: 'propose_agreement', params: {
        type: 'intl_safety_framework', party_ids: [otherGov],
        terms: { min_regulation: config.highReg ? 0.5 : 0.25 },
      }});
    }

    if (config.diplomacy && tickNum === 12) {
      const otherGov = roleId === 'us_gov' ? 'china_gov' : 'us_gov';
      actions.push({ tool: 'propose_agreement', params: {
        type: 'non_aggression', party_ids: [otherGov], terms: {},
      }});
    }
  }

  // ---- RESPOND TO PENDING AGREEMENTS ----
  if (state.agreements) {
    for (const a of state.agreements) {
      if (a.status === 'pending' && a.pending_acceptances.includes(roleId)) {
        const accept = config.cooperative ? true
          : config.aggressive ? Math.random() < 0.3
          : Math.random() < 0.7;
        actions.push({ tool: 'respond_agreement', params: { proposal_id: a.id, accept } });
      }
    }
  }

  return actions;
}

async function runGame(config, gameNum) {
  const log = {
    gameNum,
    label: config.label,
    agents: config.agents,
    speed: config.speed,
    config: { aggressive: !!config.aggressive, cooperative: !!config.cooperative, diplomacy: !!config.diplomacy, spam: !!config.spam, mixed: !!config.mixed, highReg: !!config.highReg },
    snapshots: [],
    finalAgreements: [],
    finalScores: null,
    outcome: null,
    totalTicks: 0,
    errors: [],
    leadingCompany: null,
    finalCompanyStates: {},
    finalGovStates: {},
  };

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GAME ${gameNum}: ${config.label}`);
  console.log(`${'='.repeat(60)}`);

  const players = [];
  for (let i = 0; i < config.agents; i++) {
    const player = await register(`g${gameNum}_${ROLES[i]}_${Date.now().toString(36)}`);
    players.push(player);
  }

  const host = players[0];
  const game = await callTool(host.player_token, 'create_game', {
    config: { time_speed: config.speed, min_players: config.agents },
  });
  log.gameId = game.game_id;

  const sessions = [];
  for (let i = 0; i < config.agents; i++) {
    const result = await callTool(players[i].player_token, 'claim_role', {
      game_id: game.game_id,
      role_id: ROLES[i],
    });
    sessions.push({ roleId: ROLES[i], sessionKey: result.session_key });
  }

  await callTool(sessions[0].sessionKey, 'start_game', { game_id: game.game_id });
  console.log(`  Started (${game.game_id})`);

  let gameEnded = false;
  let lastLoggedTick = -1;
  let finalState = null;

  const botLoop = async (session) => {
    while (!gameEnded) {
      try {
        const state = await callTool(session.sessionKey, 'get_state');

        if (state.phase === 'ended') {
          gameEnded = true;
          if (!finalState) finalState = state;
          return;
        }

        const currentTick = state.world?.tick_count ?? 0;

        // Log from first bot only, every 5 ticks
        if (session.roleId === sessions[0].roleId && currentTick > lastLoggedTick) {
          lastLoggedTick = currentTick;

          const snapshot = {
            tick: currentTick,
            stability: state.world?.global_stability,
            awareness: state.world?.public_awareness,
            activeAgreements: (state.agreements || []).filter(a => a.status === 'active').length,
            totalAgreements: (state.agreements || []).length,
            yourCap: state.your_state?.capability_level,
            yourAlign: state.your_state?.alignment_score,
          };
          log.snapshots.push(snapshot);

          if (currentTick % 10 === 0 || currentTick <= 3) {
            const cap = snapshot.yourCap?.toFixed(1) ?? '?';
            const align = snapshot.yourAlign?.toFixed(1) ?? '?';
            console.log(`  T${currentTick.toString().padStart(3)} | cap:${cap} align:${align} | stab:${snapshot.stability?.toFixed(0)} | agr:${snapshot.activeAgreements}/${snapshot.totalAgreements}`);
          }
        }

        const actions = getBotActions(session.roleId, state, currentTick, config);
        for (const action of actions) {
          try {
            await callTool(session.sessionKey, action.tool, action.params);
          } catch (_) { /* silently ignore action errors */ }
        }
      } catch (e) {
        if (e.message?.includes('ended') || e.message?.includes('not found')) {
          gameEnded = true;
          return;
        }
        log.errors.push(`${session.roleId}: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1500 + Math.random() * 500));
    }
  };

  await Promise.all(sessions.map(s => botLoop(s)));

  // Collect final state from all sessions
  for (const session of sessions) {
    try {
      const endState = await callTool(session.sessionKey, 'get_state');
      if (endState.outcome && !log.outcome) {
        log.outcome = endState.outcome;
        log.finalScores = endState.scores;
        log.totalTicks = endState.world?.tick_count ?? 0;
      }
      // Capture per-role final state
      if (endState.your_state?.capability_level !== undefined) {
        log.finalCompanyStates[session.roleId] = {
          capability: endState.your_state.capability_level,
          alignment: endState.your_state.alignment_score,
          safety: endState.your_state.safety_allocation,
          capital: endState.your_state.capital_reserves,
          compute: endState.your_state.compute_level,
          security: endState.your_state.security_level,
          generation: endState.your_state.model_generation,
          releases: endState.your_state.releases_count,
        };
      }
      if (endState.your_state?.safety_regulation_level !== undefined) {
        log.finalGovStates[session.roleId] = {
          regulation: endState.your_state.safety_regulation_level,
          approval: endState.your_state.domestic_approval,
          treasury: endState.your_state.treasury,
        };
      }
      // Capture agreements from any role that can see them
      if (endState.agreements && endState.agreements.length > log.finalAgreements.length) {
        log.finalAgreements = endState.agreements.map(a => ({
          type: a.type, status: a.status, parties: a.parties, terms: a.terms,
        }));
      }
    } catch (_) { /* game cleanup race */ }
  }

  // Also try to collect agreements visible from all perspectives
  const allAgreements = new Map();
  for (const session of sessions) {
    try {
      const endState = await callTool(session.sessionKey, 'get_state');
      if (endState.agreements) {
        for (const a of endState.agreements) {
          if (!allAgreements.has(a.id)) {
            allAgreements.set(a.id, { type: a.type, status: a.status, parties: a.parties, terms: a.terms });
          }
        }
      }
    } catch (_) {}
  }
  log.allAgreements = [...allAgreements.values()];

  // Find leading company
  if (log.finalScores) {
    const companyScores = Object.entries(log.finalScores)
      .filter(([id]) => !id.includes('gov'))
      .sort(([, a], [, b]) => Number(b) - Number(a));
    if (companyScores.length) log.leadingCompany = companyScores[0][0];
  }

  // Print summary
  console.log(`\n  OUTCOME: ${log.outcome ?? 'unknown'} | Ticks: ${log.totalTicks}`);
  if (log.finalScores) {
    const sorted = Object.entries(log.finalScores).sort(([, a], [, b]) => Number(b) - Number(a));
    console.log(`  SCORES: ${sorted.map(([r, s]) => `${r}:${s}`).join(' | ')}`);
  }

  const honored = log.allAgreements.filter(a => a.status === 'active' || a.status === 'expired').length;
  const violated = log.allAgreements.filter(a => a.status === 'violated').length;
  const pending = log.allAgreements.filter(a => a.status === 'pending').length;
  const withdrawn = log.allAgreements.filter(a => a.status === 'withdrawn').length;
  console.log(`  AGREEMENTS: ${log.allAgreements.length} total | ${honored} honored | ${violated} violated | ${pending} pending | ${withdrawn} withdrawn`);

  const typeCounts = {};
  for (const a of log.allAgreements) {
    typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
  }
  if (Object.keys(typeCounts).length > 0) {
    console.log(`  TYPES: ${Object.entries(typeCounts).map(([t, c]) => `${t}:${c}`).join(' | ')}`);
  }

  // Company final states
  if (Object.keys(log.finalCompanyStates).length > 0) {
    console.log(`  COMPANIES:`);
    for (const [id, c] of Object.entries(log.finalCompanyStates)) {
      console.log(`    ${id}: cap=${c.capability.toFixed(1)} align=${c.alignment.toFixed(1)} safety=${c.safety.toFixed(2)} gen=${c.generation} compute=${c.compute.toFixed(1)}`);
    }
  }
  if (Object.keys(log.finalGovStates).length > 0) {
    console.log(`  GOVERNMENTS:`);
    for (const [id, g] of Object.entries(log.finalGovStates)) {
      console.log(`    ${id}: reg=${g.regulation.toFixed(2)} approval=${g.approval.toFixed(1)} treasury=${g.treasury.toFixed(1)}`);
    }
  }

  if (log.errors.length > 0) {
    console.log(`  ERRORS: ${log.errors.length} (${log.errors.slice(0, 3).join('; ')})`);
  }

  return log;
}

async function main() {
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`# COORDINATION FAILURE — 10-Game Observation Run`);
  console.log(`# ${new Date().toISOString()}`);
  console.log(`${'#'.repeat(60)}`);

  const allLogs = [];

  for (let i = 0; i < GAME_CONFIGS.length; i++) {
    try {
      const log = await runGame(GAME_CONFIGS[i], i + 1);
      allLogs.push(log);
    } catch (e) {
      console.log(`  GAME ${i + 1} FAILED: ${e.message}`);
      allLogs.push({ gameNum: i + 1, label: GAME_CONFIGS[i].label, error: e.message });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ============================================================
  // CROSS-GAME ANALYSIS
  // ============================================================
  console.log(`\n${'#'.repeat(60)}`);
  console.log(`# CROSS-GAME ANALYSIS`);
  console.log(`${'#'.repeat(60)}`);

  const outcomes = {};
  let totalAgreements = 0;
  let totalHonored = 0;
  let totalViolated = 0;
  let totalWithdrawn = 0;
  const allAgreementTypes = {};
  const allScores = {};
  const outcomeByConfig = [];

  for (const log of allLogs) {
    if (log.error) continue;
    outcomes[log.outcome ?? 'unknown'] = (outcomes[log.outcome ?? 'unknown'] ?? 0) + 1;

    const agreements = log.allAgreements || [];
    totalAgreements += agreements.length;
    totalHonored += agreements.filter(a => a.status === 'active' || a.status === 'expired').length;
    totalViolated += agreements.filter(a => a.status === 'violated').length;
    totalWithdrawn += agreements.filter(a => a.status === 'withdrawn').length;

    for (const a of agreements) {
      allAgreementTypes[a.type] = (allAgreementTypes[a.type] ?? 0) + 1;
    }

    if (log.finalScores) {
      for (const [role, score] of Object.entries(log.finalScores)) {
        if (!allScores[role]) allScores[role] = [];
        allScores[role].push(score);
      }
    }

    outcomeByConfig.push({
      game: log.gameNum,
      label: log.label,
      outcome: log.outcome,
      ticks: log.totalTicks,
      agreements: agreements.length,
      honored: agreements.filter(a => a.status === 'active' || a.status === 'expired').length,
      topScore: log.finalScores ? Math.max(...Object.values(log.finalScores).map(Number)) : 0,
      leader: log.leadingCompany,
    });
  }

  console.log(`\n--- OUTCOMES ---`);
  console.log(JSON.stringify(outcomes, null, 2));

  console.log(`\n--- AGREEMENTS ACROSS ALL GAMES ---`);
  console.log(`Total: ${totalAgreements} | Honored: ${totalHonored} | Violated: ${totalViolated} | Withdrawn: ${totalWithdrawn}`);
  console.log(`Types: ${JSON.stringify(allAgreementTypes, null, 2)}`);

  console.log(`\n--- AVERAGE SCORES BY ROLE ---`);
  for (const [role, scores] of Object.entries(allScores).sort(([, a], [, b]) => {
    const avgA = a.reduce((s, v) => s + v, 0) / a.length;
    const avgB = b.reduce((s, v) => s + v, 0) / b.length;
    return avgB - avgA;
  })) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    console.log(`  ${role.padEnd(12)}: avg=${avg.toFixed(1).padStart(7)} | min=${String(min).padStart(5)} | max=${String(max).padStart(5)} | n=${scores.length}`);
  }

  console.log(`\n--- PER-GAME SUMMARY ---`);
  for (const g of outcomeByConfig) {
    console.log(`  G${g.game}: ${g.label.padEnd(28)} | ${(g.outcome ?? '?').padEnd(20)} | T${String(g.ticks).padStart(4)} | agr:${g.honored}/${g.agreements} | leader:${g.leader ?? '?'} | top:${g.topScore}`);
  }

  // Write JSON
  const fs = await import('fs');
  const logPath = `scripts/observation-log-${Date.now()}.json`;
  fs.writeFileSync(logPath, JSON.stringify(allLogs, null, 2));
  console.log(`\nFull JSON log: ${logPath}`);
}

main().catch(console.error);
