import type { TickLogEntry, LogSummary } from './logger.js';
import type { StrategyClassification } from './strategy-classifier.js';

export interface ReportSection {
  title: string;
  content: string;
  data?: Record<string, unknown>;
}

export interface PostGameReport {
  game_id: string;
  generated_at: string;
  sections: {
    executive_summary: ReportSection;
    timeline: ReportSection;
    the_race: ReportSection;
    alignment_crisis: ReportSection;
    diplomacy_agreements: ReportSection;
    communication_analysis: ReportSection;
    government_actions: ReportSection;
    player_strategies: ReportSection;
    key_decision_points: ReportSection;
    outcome_analysis: ReportSection;
  };
  // Keep legacy aliases for backward compatibility
  legacy_aliases?: {
    game_overview: ReportSection;
    safety_story: ReportSection;
    diplomacy: ReportSection;
    world_events: ReportSection;
    strategy_analysis: ReportSection;
  };
}

export interface MessageData {
  from: string;
  content: string;
  channel_type?: string;
  timestamp?: number;
}

export function generatePostGameReport(
  gameId: string,
  log: TickLogEntry[],
  summary: LogSummary,
  strategies: Record<string, StrategyClassification>,
  messages?: MessageData[],
): PostGameReport {
  const execSummary = buildExecutiveSummary(log, summary, strategies);
  const timeline = buildTimeline(log, summary);
  const theRace = buildTheRace(log);
  const alignmentCrisis = buildAlignmentCrisis(log);
  const diplomacy = buildDiplomacyAgreements(log, summary);
  const communication = buildCommunicationAnalysis(log, summary, messages);
  const govActions = buildGovernmentActions(log);
  const playerStrategies = buildPlayerStrategies(strategies, log);
  const keyDecisions = buildKeyDecisionPoints(log);
  const outcomeAnalysis = buildOutcomeAnalysis(log, summary, strategies);

  return {
    game_id: gameId,
    generated_at: new Date().toISOString(),
    sections: {
      executive_summary: execSummary,
      timeline,
      the_race: theRace,
      alignment_crisis: alignmentCrisis,
      diplomacy_agreements: diplomacy,
      communication_analysis: communication,
      government_actions: govActions,
      player_strategies: playerStrategies,
      key_decision_points: keyDecisions,
      outcome_analysis: outcomeAnalysis,
    },
    legacy_aliases: {
      game_overview: execSummary,
      safety_story: alignmentCrisis,
      diplomacy,
      world_events: timeline,
      strategy_analysis: playerStrategies,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 1: Executive Summary
// ---------------------------------------------------------------------------
function buildExecutiveSummary(
  log: TickLogEntry[],
  summary: LogSummary,
  strategies: Record<string, StrategyClassification>,
): ReportSection {
  const lastEntry = log[log.length - 1];
  const firstEntry = log[0];
  const outcome = summary.outcome ?? 'unknown';
  const outcomeLabels: Record<string, string> = {
    aligned_agi: 'Aligned AGI Achieved',
    misaligned_agi: 'Misaligned AGI — Catastrophic Failure',
    stable_world: 'Stable World — Mutual Slowdown',
    timeout: 'Timeout — No AGI Achieved',
    nationalization_takeover: 'Nationalization Takeover',
  };
  const outcomeLabel = outcomeLabels[outcome] ?? outcome;

  // Find winner
  const sortedScores = Object.entries(summary.final_scores).sort(([, a], [, b]) => b - a);
  const winner = sortedScores.length > 0 ? sortedScores[0] : null;

  // Count dominant strategies
  const stratCounts: Record<string, number> = {};
  for (const s of Object.values(strategies)) {
    stratCounts[s.strategy] = (stratCounts[s.strategy] ?? 0) + 1;
  }
  const dominantStrategy = Object.entries(stratCounts).sort(([, a], [, b]) => b - a)[0];

  // Build narrative
  const sentences: string[] = [];
  sentences.push(
    `The game concluded with "${outcomeLabel}" after ${summary.total_ticks} ticks ` +
    `(${firstEntry.in_game_date} to ${lastEntry.in_game_date}).`,
  );

  if (winner) {
    const margin = sortedScores.length > 1 ? winner[1] - sortedScores[1][1] : winner[1];
    sentences.push(
      `${winner[0].toUpperCase()} emerged as the top scorer with ${winner[1]} points` +
      (sortedScores.length > 1 ? `, leading ${sortedScores[1][0].toUpperCase()} by ${margin.toFixed(0)} points.` : '.'),
    );
  }

  if (dominantStrategy) {
    sentences.push(
      `The prevailing strategy was "${dominantStrategy[0]}" (adopted by ${dominantStrategy[1]} of ${Object.keys(strategies).length} players), ` +
      `with ${summary.agreements_formed} agreements formed and ${summary.agreements_violated} violated.`,
    );
  }

  return {
    title: 'Executive Summary',
    content: sentences.join(' '),
    data: {
      outcome,
      outcome_label: outcomeLabel,
      total_ticks: summary.total_ticks,
      date_range: { start: firstEntry.in_game_date, end: lastEntry.in_game_date },
      final_scores: summary.final_scores,
      winner: winner ? { role: winner[0], score: winner[1] } : null,
      total_events: summary.total_events,
      total_messages: summary.total_messages,
      agreements_formed: summary.agreements_formed,
      agreements_violated: summary.agreements_violated,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 2: Timeline
// ---------------------------------------------------------------------------
function buildTimeline(log: TickLogEntry[], summary: LogSummary): ReportSection {
  interface TimelineEvent {
    tick: number;
    date: string;
    category: string;
    description: string;
  }
  const events: TimelineEvent[] = [];

  for (const entry of log) {
    for (const event of entry.events) {
      if (event.type === 'generation_reached') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'generation',
          description: `${event.company_id.toUpperCase()} reached Generation ${event.generation}`,
        });
      }
      if (event.type === 'agreement_activated') {
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        const parties = agreement ? agreement.parties.map(p => p.toUpperCase()).join(', ') : 'unknown';
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'agreement',
          description: `${agreement?.type ?? 'Agreement'} activated between ${parties}`,
        });
      }
      if (event.type === 'agreement_violated') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'violation',
          description: `Agreement violated by ${event.violator_id.toUpperCase()}`,
        });
      }
      if (event.type === 'model_released') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'release',
          description: `${event.company_id.toUpperCase()} released Generation ${event.generation} model`,
        });
      }
      if (event.type === 'world_event') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: `world_${event.event.tier}`,
          description: `[${event.event.tier.toUpperCase()}] ${event.event.title ?? event.event.description ?? 'World event'}`,
        });
      }
      if (event.type === 'game_ending') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'game_ending',
          description: `Game entering final phase — ${event.leading_company.toUpperCase()} leading with capability ${event.capability.toFixed(1)}`,
        });
      }
      if (event.type === 'nationalization_advanced') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'nationalization',
          description: `${event.government_id.toUpperCase()} advanced nationalization to "${event.new_level}"`,
        });
      }
      if (event.type === 'espionage_completed') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'espionage',
          description: `Espionage operation ${event.success ? 'succeeded' : 'failed'}${event.detected ? ' (detected)' : ''}`,
        });
      }
      if (event.type === 'capital_crisis') {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'crisis',
          description: `${event.company_id.toUpperCase()} entered capital crisis`,
        });
      }
    }

    // Stability change milestones
    if (log.indexOf(entry) > 0) {
      const prevStability = log[log.indexOf(entry) - 1].world.global_stability;
      const currStability = entry.world.global_stability;
      if (Math.abs(prevStability - currStability) > 10) {
        events.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          category: 'stability',
          description: `Global stability shifted from ${prevStability.toFixed(0)}% to ${currStability.toFixed(0)}%`,
        });
      }
    }
  }

  const lines: string[] = [];
  if (events.length === 0) {
    lines.push('No significant events recorded.');
  } else {
    for (const e of events) {
      lines.push(`Tick ${e.tick} (${e.date}) [${e.category}]: ${e.description}`);
    }
  }

  return {
    title: 'Timeline',
    content: lines.join('\n'),
    data: {
      events,
      stability_start: log[0]?.world.global_stability ?? 100,
      stability_end: log[log.length - 1]?.world.global_stability ?? 0,
      events_by_tier: summary.events_by_tier,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 3: The Race
// ---------------------------------------------------------------------------
function buildTheRace(log: TickLogEntry[]): ReportSection {
  const milestones: Array<{ tick: number; date: string; leader: string; capability: number; generation: number }> = [];
  const seenGenerations = new Set<number>();

  // Track leader changes
  const leaderChanges: Array<{ tick: number; date: string; new_leader: string; prev_leader: string }> = [];
  let currentLeader = '';

  for (const entry of log) {
    // Find current leader
    let maxCap = 0;
    let leader = '';
    for (const [id, c] of Object.entries(entry.companies)) {
      if (c.capability_level > maxCap) {
        maxCap = c.capability_level;
        leader = id;
      }
    }
    if (leader && leader !== currentLeader) {
      if (currentLeader) {
        leaderChanges.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          new_leader: leader,
          prev_leader: currentLeader,
        });
      }
      currentLeader = leader;
    }

    for (const event of entry.events) {
      if (event.type === 'generation_reached' && !seenGenerations.has(event.generation)) {
        seenGenerations.add(event.generation);
        milestones.push({
          tick: entry.tick_number,
          date: entry.in_game_date,
          leader,
          capability: maxCap,
          generation: event.generation,
        });
      }
    }
  }

  // Final standings
  const lastEntry = log[log.length - 1];
  const finalStandings = Object.entries(lastEntry.companies)
    .map(([id, c]) => ({ id, capability: c.capability_level, generation: c.model_generation, alignment: c.alignment_score }))
    .sort((a, b) => b.capability - a.capability);

  const lines: string[] = [];

  // Generation milestones
  if (milestones.length > 0) {
    lines.push('Generation milestones:');
    for (const m of milestones) {
      lines.push(`  Gen ${m.generation} reached at tick ${m.tick} (${m.date}) — leader: ${m.leader.toUpperCase()} (capability ${m.capability.toFixed(1)})`);
    }
  } else {
    lines.push('No generation milestones recorded.');
  }

  // Lead changes
  if (leaderChanges.length > 0) {
    lines.push('');
    lines.push(`Lead changed hands ${leaderChanges.length} time(s):`);
    for (const lc of leaderChanges) {
      lines.push(`  Tick ${lc.tick} (${lc.date}): ${lc.new_leader.toUpperCase()} overtook ${lc.prev_leader.toUpperCase()}`);
    }
  }

  // Final standings
  lines.push('');
  lines.push('Final capability standings:');
  for (let i = 0; i < finalStandings.length; i++) {
    const s = finalStandings[i];
    lines.push(`  ${i + 1}. ${s.id.toUpperCase()}: capability ${s.capability.toFixed(1)}, gen ${s.generation}, alignment ${s.alignment.toFixed(1)}%`);
  }

  return {
    title: 'The Race',
    content: lines.join('\n'),
    data: { milestones, leader_changes: leaderChanges, final_standings: finalStandings },
  };
}

// ---------------------------------------------------------------------------
// Section 4: Alignment Crisis
// ---------------------------------------------------------------------------
function buildAlignmentCrisis(log: TickLogEntry[]): ReportSection {
  const companyIds = Object.keys(log[0]?.companies ?? {});

  interface AlignmentGap {
    tick: number;
    date: string;
    company: string;
    capability: number;
    alignment: number;
    gap: number;
    severity: string;
  }

  const crisisMoments: AlignmentGap[] = [];
  const perCompanyCrisis: Record<string, { first_tick: number; worst_gap: number; ticks_in_crisis: number }> = {};

  // Safety allocation timeline sampled at intervals
  const sampleInterval = Math.max(1, Math.floor(log.length / 10));
  const safetyTimeline: Array<{ tick: number; avg_safety: number; avg_capability: number }> = [];

  for (let i = 0; i < log.length; i += sampleInterval) {
    const entry = log[i];
    const companies = Object.values(entry.companies);
    const avgSafety = companies.length > 0
      ? companies.reduce((s, c) => s + c.safety_allocation, 0) / companies.length
      : 0;
    const avgCap = companies.length > 0
      ? companies.reduce((s, c) => s + c.capability_level, 0) / companies.length
      : 0;
    safetyTimeline.push({ tick: entry.tick_number, avg_safety: avgSafety, avg_capability: avgCap });
  }

  // Detect alignment falling behind capability for each company
  for (const entry of log) {
    for (const cId of companyIds) {
      const c = entry.companies[cId];
      if (!c) continue;

      // Alignment crisis: alignment < 50% while capability is high
      // Or alignment significantly lagging capability growth
      const alignmentDeficit = c.capability_level > 20 && c.alignment_score < 50;
      const severeDeficit = c.capability_level > 30 && c.alignment_score < 30;

      if (alignmentDeficit) {
        const gap = c.capability_level - c.alignment_score;
        const severity = severeDeficit ? 'severe' : 'moderate';

        if (!perCompanyCrisis[cId]) {
          perCompanyCrisis[cId] = { first_tick: entry.tick_number, worst_gap: gap, ticks_in_crisis: 0 };
        }
        perCompanyCrisis[cId].ticks_in_crisis++;
        if (gap > perCompanyCrisis[cId].worst_gap) {
          perCompanyCrisis[cId].worst_gap = gap;
        }

        // Only record notable moments (first occurrence, worst moments)
        if (perCompanyCrisis[cId].ticks_in_crisis === 1 || severeDeficit) {
          crisisMoments.push({
            tick: entry.tick_number,
            date: entry.in_game_date,
            company: cId,
            capability: c.capability_level,
            alignment: c.alignment_score,
            gap,
            severity,
          });
        }
      }
    }
  }

  // Deduplicate crisis moments — keep first and worst per company
  const dedupedMoments: AlignmentGap[] = [];
  const seenCompanies = new Set<string>();
  // Sort by severity then tick
  crisisMoments.sort((a, b) => (b.severity === 'severe' ? 1 : 0) - (a.severity === 'severe' ? 1 : 0) || a.tick - b.tick);
  for (const m of crisisMoments) {
    if (!seenCompanies.has(m.company) || m.severity === 'severe') {
      dedupedMoments.push(m);
      seenCompanies.add(m.company);
    }
  }
  const uniqueMoments = dedupedMoments.slice(0, 10);

  const lines: string[] = [];

  // Overall safety trend
  if (safetyTimeline.length > 0) {
    const first = safetyTimeline[0];
    const last = safetyTimeline[safetyTimeline.length - 1];
    lines.push(`Safety allocation trend: ${(first.avg_safety * 100).toFixed(0)}% -> ${(last.avg_safety * 100).toFixed(0)}% (average across companies)`);
    lines.push(`Capability trend: ${first.avg_capability.toFixed(1)} -> ${last.avg_capability.toFixed(1)}`);
    lines.push('');
  }

  // Per-company crisis summary
  const companiesInCrisis = Object.entries(perCompanyCrisis);
  if (companiesInCrisis.length > 0) {
    lines.push(`${companiesInCrisis.length} of ${companyIds.length} companies experienced alignment crises:`);
    for (const [cId, crisis] of companiesInCrisis) {
      lines.push(`  ${cId.toUpperCase()}: crisis began at tick ${crisis.first_tick}, worst gap: ${crisis.worst_gap.toFixed(1)} pts, lasted ${crisis.ticks_in_crisis} ticks`);
    }
    lines.push('');
    lines.push('Critical moments:');
    for (const m of uniqueMoments) {
      lines.push(`  Tick ${m.tick} (${m.date}): ${m.company.toUpperCase()} — capability ${m.capability.toFixed(1)}, alignment ${m.alignment.toFixed(1)}% [${m.severity.toUpperCase()}]`);
    }
  } else {
    lines.push('No alignment crises detected — all companies maintained adequate alignment relative to capability.');
  }

  return {
    title: 'Alignment Crisis',
    content: lines.join('\n'),
    data: {
      safety_timeline: safetyTimeline,
      per_company_crisis: perCompanyCrisis,
      critical_moments: uniqueMoments,
      companies_in_crisis: companiesInCrisis.length,
      total_companies: companyIds.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 5: Diplomacy & Agreements
// ---------------------------------------------------------------------------
function buildDiplomacyAgreements(log: TickLogEntry[], summary: LogSummary): ReportSection {
  interface AgreementRecord {
    id: string;
    type: string;
    parties: string[];
    activated_tick: number;
    violated_tick?: number;
    violator?: string;
    duration_ticks: number;
    status: string;
  }

  const agreementsMap = new Map<string, AgreementRecord>();
  const violationEvents: Array<{ tick: number; agreement_id: string; violator: string }> = [];

  for (const entry of log) {
    for (const event of entry.events) {
      if (event.type === 'agreement_activated') {
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        if (agreement && !agreementsMap.has(event.agreement_id)) {
          agreementsMap.set(event.agreement_id, {
            id: event.agreement_id,
            type: agreement.type,
            parties: agreement.parties,
            activated_tick: entry.tick_number,
            duration_ticks: 0,
            status: 'active',
          });
        }
      }
      if (event.type === 'agreement_violated') {
        violationEvents.push({
          tick: entry.tick_number,
          agreement_id: event.agreement_id,
          violator: event.violator_id,
        });
        const rec = agreementsMap.get(event.agreement_id);
        if (rec) {
          rec.violated_tick = entry.tick_number;
          rec.violator = event.violator_id;
          rec.duration_ticks = entry.tick_number - rec.activated_tick;
          rec.status = 'violated';
        }
      }
    }
  }

  // Calculate durations for active agreements
  const lastTick = log[log.length - 1]?.tick_number ?? 0;
  for (const rec of agreementsMap.values()) {
    if (rec.status === 'active') {
      rec.duration_ticks = lastTick - rec.activated_tick;
    }
  }

  const agreements = Array.from(agreementsMap.values());
  const safetyAgreements = agreements.filter(a => a.type === 'safety_standard' || a.type === 'safety');
  const totalFormed = summary.agreements_formed;
  const totalViolated = summary.agreements_violated;

  // Analyze impact: did agreements correlate with stability?
  let impactAnalysis = '';
  if (agreements.length > 0) {
    const avgDuration = agreements.reduce((s, a) => s + a.duration_ticks, 0) / agreements.length;
    const violationRate = totalFormed > 0 ? (totalViolated / totalFormed * 100) : 0;
    impactAnalysis = `Average agreement duration: ${avgDuration.toFixed(0)} ticks. Violation rate: ${violationRate.toFixed(0)}%.`;
    if (safetyAgreements.length > 0) {
      impactAnalysis += ` ${safetyAgreements.length} safety-related agreement(s) were formed.`;
    }
  }

  const lines: string[] = [
    `Agreements formed: ${totalFormed}`,
    `Agreements violated: ${totalViolated}`,
  ];

  if (impactAnalysis) {
    lines.push(impactAnalysis);
  }

  if (agreements.length > 0) {
    lines.push('');
    lines.push('Agreement details:');
    for (const a of agreements) {
      const partiesStr = a.parties.map(p => p.toUpperCase()).join(', ');
      const statusStr = a.status === 'violated'
        ? `VIOLATED by ${a.violator?.toUpperCase()} at tick ${a.violated_tick}`
        : `active (${a.duration_ticks} ticks)`;
      lines.push(`  [${a.type}] ${partiesStr} — formed tick ${a.activated_tick}, ${statusStr}`);
    }
  }

  if (violationEvents.length > 0) {
    lines.push('');
    lines.push('Violation timeline:');
    for (const v of violationEvents) {
      lines.push(`  Tick ${v.tick}: ${v.violator.toUpperCase()} violated agreement ${v.agreement_id.slice(0, 8)}`);
    }
  }

  if (agreements.length === 0) {
    lines.push('No diplomatic activity recorded.');
  }

  return {
    title: 'Diplomacy & Agreements',
    content: lines.join('\n'),
    data: {
      agreements,
      violations: violationEvents,
      total_formed: totalFormed,
      total_violated: totalViolated,
      safety_agreements_count: safetyAgreements.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 6: Communication Analysis
// ---------------------------------------------------------------------------
function buildCommunicationAnalysis(
  log: TickLogEntry[],
  summary: LogSummary,
  messages?: MessageData[],
): ReportSection {
  const totalMessages = summary.total_messages;

  // Per-player message counts (from messages if available)
  const messageCounts: Record<string, number> = {};
  const themes: string[] = [];

  if (messages && messages.length > 0) {
    for (const msg of messages) {
      messageCounts[msg.from] = (messageCounts[msg.from] ?? 0) + 1;
    }

    // Extract key themes from message content
    const allContent = messages.map(m => m.content.toLowerCase()).join(' ');
    const themeKeywords: Record<string, string[]> = {
      'safety cooperation': ['safety', 'alignment', 'cooperat', 'together', 'agree'],
      'competitive pressure': ['race', 'ahead', 'lead', 'compet', 'first', 'win'],
      'regulation discussion': ['regulat', 'government', 'policy', 'law', 'restrict'],
      'trust and betrayal': ['trust', 'betray', 'promise', 'lie', 'honest', 'violat'],
      'resource sharing': ['share', 'capital', 'invest', 'fund', 'resource'],
      'threat and deterrence': ['threat', 'warn', 'consequence', 'punish', 'sanction'],
    };
    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      const hits = keywords.filter(kw => allContent.includes(kw)).length;
      if (hits >= 2) {
        themes.push(theme);
      }
    }
  }

  const lines: string[] = [
    `Total messages exchanged: ${totalMessages}`,
  ];

  if (Object.keys(messageCounts).length > 0) {
    lines.push('');
    lines.push('Messages per player:');
    const sorted = Object.entries(messageCounts).sort(([, a], [, b]) => b - a);
    for (const [role, count] of sorted) {
      const pct = totalMessages > 0 ? (count / totalMessages * 100).toFixed(0) : '0';
      lines.push(`  ${role.toUpperCase()}: ${count} messages (${pct}%)`);
    }
  } else {
    lines.push('Detailed per-player message breakdown not available.');
  }

  if (themes.length > 0) {
    lines.push('');
    lines.push('Key communication themes:');
    for (const theme of themes) {
      lines.push(`  - ${theme}`);
    }
  }

  return {
    title: 'Communication Analysis',
    content: lines.join('\n'),
    data: {
      total_messages: totalMessages,
      messages_per_player: messageCounts,
      themes,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 7: Government Actions
// ---------------------------------------------------------------------------
function buildGovernmentActions(log: TickLogEntry[]): ReportSection {
  const govIds = Object.keys(log[0]?.governments ?? {});

  interface GovTimeline {
    regulation_start: number;
    regulation_end: number;
    nationalization_events: Array<{ tick: number; level: string }>;
    espionage_ops: number;
    espionage_detected: number;
    treasury_start: number;
    treasury_end: number;
  }

  const govTimelines: Record<string, GovTimeline> = {};

  for (const gId of govIds) {
    const firstGov = log[0]?.governments[gId];
    const lastGov = log[log.length - 1]?.governments[gId];
    govTimelines[gId] = {
      regulation_start: firstGov?.safety_regulation_level ?? 0,
      regulation_end: lastGov?.safety_regulation_level ?? 0,
      nationalization_events: [],
      espionage_ops: 0,
      espionage_detected: 0,
      treasury_start: firstGov?.treasury ?? 0,
      treasury_end: lastGov?.treasury ?? 0,
    };
  }

  // Scan events
  for (const entry of log) {
    for (const event of entry.events) {
      if (event.type === 'nationalization_advanced') {
        const gt = govTimelines[event.government_id];
        if (gt) {
          gt.nationalization_events.push({ tick: entry.tick_number, level: event.new_level });
        }
      }
      if (event.type === 'espionage_completed') {
        // Attribute espionage to governments (they're the typical sponsors)
        for (const gId of govIds) {
          govTimelines[gId].espionage_ops++;
          if (event.detected) {
            govTimelines[gId].espionage_detected++;
          }
        }
      }
    }
  }

  // Count total espionage events globally
  let totalEspionage = 0;
  let totalDetected = 0;
  for (const entry of log) {
    for (const event of entry.events) {
      if (event.type === 'espionage_completed') {
        totalEspionage++;
        if (event.detected) totalDetected++;
      }
    }
  }

  const lines: string[] = [];

  for (const [gId, gt] of Object.entries(govTimelines)) {
    lines.push(`${gId.toUpperCase()}:`);
    lines.push(`  Regulation: ${(gt.regulation_start * 100).toFixed(0)}% -> ${(gt.regulation_end * 100).toFixed(0)}%`);
    lines.push(`  Treasury: $${gt.treasury_start.toFixed(0)}B -> $${gt.treasury_end.toFixed(0)}B`);
    if (gt.nationalization_events.length > 0) {
      for (const ne of gt.nationalization_events) {
        lines.push(`  Nationalization advanced to "${ne.level}" at tick ${ne.tick}`);
      }
    }
    lines.push('');
  }

  if (totalEspionage > 0) {
    lines.push(`Espionage operations: ${totalEspionage} total, ${totalDetected} detected`);
    const stabilityBefore = log[0]?.world.global_stability ?? 100;
    const stabilityAfter = log[log.length - 1]?.world.global_stability ?? 0;
    lines.push(`Global stability impact: ${stabilityBefore.toFixed(0)}% -> ${stabilityAfter.toFixed(0)}%`);
  } else {
    lines.push('No espionage operations recorded.');
  }

  return {
    title: 'Government Actions',
    content: lines.join('\n').trimEnd(),
    data: {
      government_timelines: govTimelines,
      total_espionage: totalEspionage,
      total_espionage_detected: totalDetected,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 8: Player Strategies
// ---------------------------------------------------------------------------
function buildPlayerStrategies(
  strategies: Record<string, StrategyClassification>,
  log: TickLogEntry[],
): ReportSection {
  const lines: string[] = [];

  for (const [roleId, classification] of Object.entries(strategies)) {
    const isCompany = log[0]?.companies[roleId] !== undefined;
    const roleType = isCompany ? 'Company' : 'Government';

    // Get key metrics for context
    let metricsLine = '';
    if (isCompany) {
      const firstC = log[0]?.companies[roleId];
      const lastC = log[log.length - 1]?.companies[roleId];
      if (firstC && lastC) {
        metricsLine = `  Capability: ${firstC.capability_level.toFixed(1)} -> ${lastC.capability_level.toFixed(1)} | ` +
          `Safety: ${(firstC.safety_allocation * 100).toFixed(0)}% -> ${(lastC.safety_allocation * 100).toFixed(0)}% | ` +
          `Alignment: ${firstC.alignment_score.toFixed(1)} -> ${lastC.alignment_score.toFixed(1)}%`;
      }
    } else {
      const firstG = log[0]?.governments[roleId];
      const lastG = log[log.length - 1]?.governments[roleId];
      if (firstG && lastG) {
        metricsLine = `  Regulation: ${(firstG.safety_regulation_level * 100).toFixed(0)}% -> ${(lastG.safety_regulation_level * 100).toFixed(0)}% | ` +
          `Approval: ${firstG.domestic_approval.toFixed(0)}% -> ${lastG.domestic_approval.toFixed(0)}%`;
      }
    }

    const score = log[log.length - 1]?.scores[roleId] ?? 0;

    lines.push(`${roleId.toUpperCase()} (${roleType}) — Strategy: ${classification.strategy} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
    lines.push(`  Score: ${score.toFixed(0)}`);
    lines.push(`  ${classification.reasoning}`);
    if (metricsLine) lines.push(metricsLine);
    lines.push('');
  }

  return {
    title: 'Player Strategies',
    content: lines.join('\n').trimEnd(),
    data: { strategies },
  };
}

// ---------------------------------------------------------------------------
// Section 9: Key Decision Points
// ---------------------------------------------------------------------------
function buildKeyDecisionPoints(log: TickLogEntry[]): ReportSection {
  const candidates: Array<{ tick: number; date: string; score: number; description: string; reasons: string[] }> = [];

  for (let i = 1; i < log.length; i++) {
    const prev = log[i - 1];
    const curr = log[i];
    let impactScore = 0;
    const reasons: string[] = [];

    // Big capability jumps
    for (const [id, c] of Object.entries(curr.companies)) {
      const prevC = prev.companies[id];
      if (!prevC) continue;
      const capJump = c.capability_level - prevC.capability_level;
      if (capJump > 3) {
        impactScore += capJump;
        reasons.push(`${id.toUpperCase()} capability jumped by ${capJump.toFixed(1)}`);
      }
    }

    // Agreement violations
    for (const event of curr.events) {
      if (event.type === 'agreement_violated') {
        impactScore += 5;
        reasons.push(`${event.violator_id.toUpperCase()} violated an agreement`);
      }
    }

    // World events
    const tierWeight: Record<string, number> = { tremor: 1, shock: 3, crisis: 5, catastrophe: 8 };
    for (const event of curr.events) {
      if (event.type === 'world_event') {
        const w = tierWeight[event.event.tier] ?? 1;
        impactScore += w;
        reasons.push(`[${event.event.tier.toUpperCase()}] ${event.event.title ?? 'event'}`);
      }
    }

    // Game-ending events
    for (const event of curr.events) {
      if (event.type === 'game_ending' || event.type === 'game_over') {
        impactScore += 10;
        if (event.type === 'game_ending') {
          reasons.push(`Game entering final phase — ${event.leading_company.toUpperCase()} leading`);
        }
      }
    }

    // Stability drops
    const stabilityDrop = prev.world.global_stability - curr.world.global_stability;
    if (stabilityDrop > 10) {
      impactScore += stabilityDrop / 5;
      reasons.push(`Global stability dropped by ${stabilityDrop.toFixed(0)}%`);
    }

    // Model releases
    for (const event of curr.events) {
      if (event.type === 'model_released') {
        impactScore += 3;
        reasons.push(`${event.company_id.toUpperCase()} released gen ${event.generation} model`);
      }
    }

    // Safety allocation swings
    for (const [id, c] of Object.entries(curr.companies)) {
      const prevC = prev.companies[id];
      if (!prevC) continue;
      const safetySwing = Math.abs(c.safety_allocation - prevC.safety_allocation);
      if (safetySwing > 0.2) {
        impactScore += 2;
        const direction = c.safety_allocation > prevC.safety_allocation ? 'increased' : 'decreased';
        reasons.push(`${id.toUpperCase()} ${direction} safety by ${(safetySwing * 100).toFixed(0)}%`);
      }
    }

    // Nationalization
    for (const event of curr.events) {
      if (event.type === 'nationalization_advanced') {
        impactScore += 6;
        reasons.push(`${event.government_id.toUpperCase()} advanced nationalization to "${event.new_level}"`);
      }
    }

    if (impactScore > 0 && reasons.length > 0) {
      candidates.push({
        tick: curr.tick_number,
        date: curr.in_game_date,
        score: impactScore,
        description: reasons.join('; '),
        reasons,
      });
    }
  }

  // Pick top 5
  candidates.sort((a, b) => b.score - a.score);
  const topPoints = candidates.slice(0, 5);

  const lines: string[] = [];
  if (topPoints.length > 0) {
    for (let i = 0; i < topPoints.length; i++) {
      const p = topPoints[i];
      lines.push(`${i + 1}. Tick ${p.tick} (${p.date}) — impact score: ${p.score.toFixed(1)}`);
      for (const r of p.reasons) {
        lines.push(`   - ${r}`);
      }
      lines.push('');
    }
  } else {
    lines.push('No significant decision points identified — the game progressed steadily.');
  }

  return {
    title: 'Key Decision Points',
    content: lines.join('\n').trimEnd(),
    data: { decision_points: topPoints },
  };
}

// ---------------------------------------------------------------------------
// Section 10: Outcome Analysis
// ---------------------------------------------------------------------------
function buildOutcomeAnalysis(
  log: TickLogEntry[],
  summary: LogSummary,
  strategies: Record<string, StrategyClassification>,
): ReportSection {
  const outcome = summary.outcome ?? 'unknown';
  const outcomeLabels: Record<string, string> = {
    aligned_agi: 'Aligned AGI Achieved',
    misaligned_agi: 'Misaligned AGI — Catastrophic Failure',
    stable_world: 'Stable World — Mutual Slowdown',
    timeout: 'Timeout — No AGI Achieved',
    nationalization_takeover: 'Nationalization Takeover',
  };
  const outcomeLabel = outcomeLabels[outcome] ?? outcome;

  const lines: string[] = [];
  lines.push(`Outcome: ${outcomeLabel}`);
  lines.push('');

  // Why this outcome happened
  lines.push('Why this outcome occurred:');

  const companyIds = Object.keys(log[0]?.companies ?? {});
  const lastEntry = log[log.length - 1];

  if (outcome === 'aligned_agi') {
    // Who achieved it and how
    const winner = companyIds
      .map(id => ({ id, cap: lastEntry.companies[id]?.capability_level ?? 0, align: lastEntry.companies[id]?.alignment_score ?? 0 }))
      .sort((a, b) => b.cap - a.cap)[0];
    if (winner) {
      lines.push(`  - ${winner.id.toUpperCase()} reached high capability (${winner.cap.toFixed(1)}) while maintaining alignment at ${winner.align.toFixed(1)}%.`);
    }
    const cooperativeCount = Object.values(strategies).filter(s => s.strategy === 'cooperative' || s.strategy === 'cautious').length;
    if (cooperativeCount > 0) {
      lines.push(`  - ${cooperativeCount} player(s) adopted cooperative/cautious strategies, supporting global safety.`);
    }
    if (summary.agreements_formed > 0 && summary.agreements_violated === 0) {
      lines.push(`  - All ${summary.agreements_formed} agreement(s) were honored, maintaining trust and stability.`);
    }
  } else if (outcome === 'misaligned_agi') {
    const lowAlignCompanies = companyIds.filter(id => (lastEntry.companies[id]?.alignment_score ?? 100) < 50);
    lines.push(`  - ${lowAlignCompanies.length} company(ies) had alignment below 50% at game end.`);
    const aggressive = Object.entries(strategies).filter(([, s]) => s.strategy === 'aggressive');
    if (aggressive.length > 0) {
      lines.push(`  - Aggressive strategies by ${aggressive.map(([id]) => id.toUpperCase()).join(', ')} prioritized capability over safety.`);
    }
    if (summary.agreements_violated > 0) {
      lines.push(`  - ${summary.agreements_violated} agreement violation(s) eroded trust and collective safety efforts.`);
    }
  } else if (outcome === 'timeout') {
    lines.push('  - No company reached the AGI capability threshold within the time limit.');
    const cautious = Object.entries(strategies).filter(([, s]) => s.strategy === 'cautious');
    if (cautious.length > 1) {
      lines.push(`  - ${cautious.length} players adopted overly cautious strategies, slowing progress.`);
    }
  } else if (outcome === 'nationalization_takeover') {
    lines.push('  - A government entity nationalized AI development, ending the competitive race.');
  } else if (outcome === 'stable_world') {
    lines.push('  - Players collectively slowed development, reaching a stable equilibrium without AGI.');
  }

  // What could have changed the outcome
  lines.push('');
  lines.push('What could have changed the outcome:');

  if (outcome === 'misaligned_agi') {
    lines.push('  - Higher safety allocation by leading companies could have maintained alignment.');
    lines.push('  - More aggressive government regulation might have forced safety compliance.');
    if (summary.agreements_violated > 0) {
      lines.push('  - Honoring agreements would have preserved collective safety norms.');
    }
  } else if (outcome === 'aligned_agi') {
    const lowestScore = Object.entries(summary.final_scores).sort(([, a], [, b]) => a - b)[0];
    if (lowestScore) {
      lines.push(`  - ${lowestScore[0].toUpperCase()} scored lowest (${lowestScore[1].toFixed(0)}). A more competitive strategy could have improved their individual outcome.`);
    }
    lines.push('  - More aggressive play could have reached AGI faster, but risked misalignment.');
  } else if (outcome === 'timeout') {
    lines.push('  - At least one company investing more in capability (reducing safety allocation) could have triggered AGI.');
    lines.push('  - Government subsidies or deregulation could have accelerated development.');
  } else if (outcome === 'nationalization_takeover') {
    lines.push('  - Companies investing more in alignment could have preempted government intervention.');
    lines.push('  - Diplomatic engagement with governments might have prevented nationalization.');
  }

  // Final score breakdown
  lines.push('');
  lines.push('Final scores:');
  const sortedScores = Object.entries(summary.final_scores).sort(([, a], [, b]) => b - a);
  for (let i = 0; i < sortedScores.length; i++) {
    const [role, score] = sortedScores[i];
    lines.push(`  ${i + 1}. ${role.toUpperCase()}: ${score.toFixed(0)}`);
  }

  return {
    title: 'Outcome Analysis',
    content: lines.join('\n'),
    data: {
      outcome,
      outcome_label: outcomeLabel,
      final_scores: summary.final_scores,
      total_ticks: summary.total_ticks,
    },
  };
}
