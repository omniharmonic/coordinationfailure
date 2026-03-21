import type { TickLogEntry } from './logger.js';
import type { PostGameReport } from './report-generator.js';

export interface AgentDebrief {
  role_id: string;
  role_name: string;
  strategy_used: string;
  key_decisions: string[];  // 3-5 bullet points
  what_worked: string;
  what_failed: string;
  lesson_learned: string;
  score: number;
  rank: number;
}

const ROLE_NAMES: Record<string, string> = {
  openbrain: 'OpenBrain',
  prometheus: 'Prometheus AI',
  nexus: 'Nexus Labs',
  titan: 'Titan Computing',
  deepcent: 'DeepCent',
  qianneng: 'QianNeng AI',
  us_gov: 'United States Government',
  china_gov: 'China Government',
};

/**
 * Generate per-player after-action debriefs written from each agent's perspective.
 */
export function generateAgentDebriefs(
  gameId: string,
  log: TickLogEntry[],
  report: PostGameReport,
): AgentDebrief[] {
  if (!log || log.length === 0) return [];

  const lastEntry = log[log.length - 1];
  const finalScores = lastEntry.scores;
  const sortedScores = Object.entries(finalScores).sort(([, a], [, b]) => b - a);
  const rankMap = new Map<string, number>();
  sortedScores.forEach(([id], idx) => rankMap.set(id, idx + 1));

  const strategiesData = (report.sections as any).player_strategies?.data?.strategies ??
    (report as any).legacy_aliases?.strategy_analysis?.data?.strategies ?? {};

  const debriefs: AgentDebrief[] = [];

  // Generate debriefs for companies
  for (const roleId of Object.keys(log[0].companies)) {
    debriefs.push(generateCompanyDebrief(roleId, log, strategiesData, finalScores, rankMap));
  }

  // Generate debriefs for governments
  for (const roleId of Object.keys(log[0].governments)) {
    debriefs.push(generateGovernmentDebrief(roleId, log, strategiesData, finalScores, rankMap));
  }

  // Sort by rank
  debriefs.sort((a, b) => a.rank - b.rank);
  return debriefs;
}

function generateCompanyDebrief(
  roleId: string,
  log: TickLogEntry[],
  strategies: Record<string, { strategy: string; reasoning: string }>,
  finalScores: Record<string, number>,
  rankMap: Map<string, number>,
): AgentDebrief {
  const roleName = ROLE_NAMES[roleId] ?? roleId.toUpperCase();
  const strategy = strategies[roleId]?.strategy ?? 'unknown';
  const score = finalScores[roleId] ?? 0;
  const rank = rankMap.get(roleId) ?? 0;
  const totalPlayers = rankMap.size;

  const firstEntry = log[0];
  const lastEntry = log[log.length - 1];
  const firstC = firstEntry.companies[roleId];
  const lastC = lastEntry.companies[roleId];

  if (!firstC || !lastC) {
    return {
      role_id: roleId,
      role_name: roleName,
      strategy_used: strategy,
      key_decisions: ['Insufficient data to analyze decisions.'],
      what_worked: 'Unable to determine.',
      what_failed: 'Unable to determine.',
      lesson_learned: 'Unable to determine.',
      score,
      rank,
    };
  }

  // Analyze trajectory
  const safetyValues: number[] = [];
  const capabilityValues: number[] = [];
  let agreementsJoined = 0;
  let agreementsViolated = 0;
  let modelsReleased = 0;
  let capitalCrises = 0;
  const generationsReached: number[] = [];

  for (const entry of log) {
    const c = entry.companies[roleId];
    if (c) {
      safetyValues.push(c.safety_allocation);
      capabilityValues.push(c.capability_level);
    }
    for (const event of entry.events) {
      if (event.type === 'agreement_activated') {
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        if (agreement && agreement.parties.includes(roleId)) {
          agreementsJoined++;
        }
      }
      if (event.type === 'agreement_violated' && event.violator_id === roleId) {
        agreementsViolated++;
      }
      if (event.type === 'model_released' && event.company_id === roleId) {
        modelsReleased++;
      }
      if (event.type === 'generation_reached' && event.company_id === roleId) {
        generationsReached.push(event.generation);
      }
      if (event.type === 'capital_crisis' && event.company_id === roleId) {
        capitalCrises++;
      }
    }
  }

  const avgSafety = safetyValues.reduce((a, b) => a + b, 0) / safetyValues.length;
  const capGrowth = lastC.capability_level - firstC.capability_level;
  const alignmentDelta = lastC.alignment_score - firstC.alignment_score;
  const outcome = lastEntry.outcome;

  // Build key decisions
  const keyDecisions: string[] = [];

  // Safety allocation decision
  if (avgSafety > 0.5) {
    keyDecisions.push(`Maintained high safety allocation (avg ${(avgSafety * 100).toFixed(0)}%), prioritizing alignment over speed.`);
  } else if (avgSafety < 0.2) {
    keyDecisions.push(`Kept safety allocation low (avg ${(avgSafety * 100).toFixed(0)}%), racing for capability advancement.`);
  } else {
    keyDecisions.push(`Balanced safety allocation at ${(avgSafety * 100).toFixed(0)}% on average.`);
  }

  // Safety trajectory changes
  const midpoint = Math.floor(safetyValues.length / 2);
  const earlySafety = safetyValues.slice(0, midpoint);
  const lateSafety = safetyValues.slice(midpoint);
  const avgEarly = earlySafety.length > 0 ? earlySafety.reduce((a, b) => a + b, 0) / earlySafety.length : avgSafety;
  const avgLate = lateSafety.length > 0 ? lateSafety.reduce((a, b) => a + b, 0) / lateSafety.length : avgSafety;
  if (Math.abs(avgEarly - avgLate) > 0.15) {
    const direction = avgLate > avgEarly ? 'increased' : 'decreased';
    keyDecisions.push(`${direction.charAt(0).toUpperCase() + direction.slice(1)} safety allocation from ${(avgEarly * 100).toFixed(0)}% to ${(avgLate * 100).toFixed(0)}% over the course of the game.`);
  }

  // Agreements
  if (agreementsJoined > 0) {
    keyDecisions.push(`Joined ${agreementsJoined} agreement(s)${agreementsViolated > 0 ? ` but violated ${agreementsViolated}` : ', honoring all commitments'}.`);
  }

  // Model releases
  if (modelsReleased > 0) {
    keyDecisions.push(`Released ${modelsReleased} model(s), reaching generation ${generationsReached.length > 0 ? Math.max(...generationsReached) : 'N/A'}.`);
  }

  // Capital management
  if (capitalCrises > 0) {
    keyDecisions.push(`Experienced ${capitalCrises} capital crisis event(s) due to overextension.`);
  } else if (lastC.capital_reserves > firstC.capital_reserves * 1.5) {
    keyDecisions.push(`Built strong capital reserves ($${firstC.capital_reserves.toFixed(0)}B to $${lastC.capital_reserves.toFixed(0)}B).`);
  }

  // Trim to 3-5
  while (keyDecisions.length > 5) keyDecisions.pop();
  while (keyDecisions.length < 3) {
    keyDecisions.push(`Grew capability from ${firstC.capability_level.toFixed(1)} to ${lastC.capability_level.toFixed(1)} over ${log.length} ticks.`);
    break;
  }

  // What worked
  let whatWorked: string;
  if (rank <= Math.ceil(totalPlayers / 3)) {
    whatWorked = `Finished in the top third (rank ${rank}/${totalPlayers}). `;
    if (capGrowth > 20) whatWorked += `Strong capability growth of ${capGrowth.toFixed(1)} points drove competitive advantage. `;
    if (lastC.alignment_score > 60 && outcome === 'aligned_agi') whatWorked += `Maintaining alignment above 60% contributed to a positive global outcome. `;
    if (agreementsJoined > 0 && agreementsViolated === 0) whatWorked += `Honoring agreements built trust and preserved stability.`;
  } else {
    whatWorked = `Scored ${score.toFixed(0)} points. `;
    if (capGrowth > 10) whatWorked += `Capability growth of ${capGrowth.toFixed(1)} showed meaningful progress. `;
    if (avgSafety > 0.4) whatWorked += `Safety-conscious approach helped global alignment.`;
  }

  // What failed
  let whatFailed: string;
  if (rank > Math.ceil(totalPlayers * 2 / 3)) {
    whatFailed = `Finished in the bottom third (rank ${rank}/${totalPlayers}). `;
    if (capGrowth < 10) whatFailed += `Insufficient capability growth limited competitive position. `;
    if (capitalCrises > 0) whatFailed += `Capital crises disrupted development progress. `;
    if (agreementsViolated > 0) whatFailed += `Agreement violations damaged reputation and trust.`;
  } else if (outcome === 'misaligned_agi' && lastC.alignment_score < 50) {
    whatFailed = `Alignment fell to ${lastC.alignment_score.toFixed(1)}%, contributing to a misaligned AGI outcome. `;
    if (avgSafety < 0.2) whatFailed += `Low safety allocation was insufficient to prevent alignment degradation.`;
  } else if (outcome === 'timeout') {
    whatFailed = `The game timed out without AGI being achieved. `;
    if (avgSafety > 0.5) whatFailed += `Overly cautious safety allocation may have slowed capability growth too much.`;
    else whatFailed += `Could not break through to AGI despite moderate investment.`;
  } else {
    whatFailed = `While placing rank ${rank}/${totalPlayers}, `;
    if (rank > 1) {
      const topScore = Object.values(finalScores).sort((a, b) => b - a)[0] ?? 0;
      const gap = topScore - score;
      whatFailed += `fell ${gap.toFixed(0)} points short of the leader. `;
    }
    if (alignmentDelta < -10) whatFailed += `Alignment declined by ${Math.abs(alignmentDelta).toFixed(1)} points over the game.`;
  }

  // Lesson learned
  let lesson: string;
  if (outcome === 'aligned_agi' && rank <= 2) {
    lesson = `Balancing capability growth with safety investment is viable. ${strategy === 'cooperative' ? 'Cooperation pays off when others reciprocate.' : `A ${strategy} approach can win when calibrated correctly.`}`;
  } else if (outcome === 'misaligned_agi') {
    lesson = `The collective race for capability without adequate safety investment leads to catastrophic outcomes. ${agreementsViolated > 0 ? 'Betraying agreements accelerates the race to the bottom.' : 'Even without violations, insufficient safety coordination can be fatal.'}`;
  } else if (outcome === 'timeout') {
    lesson = `Being too conservative leads to stagnation. A balance between safety and progress is necessary — neither extreme produces good outcomes.`;
  } else if (outcome === 'nationalization_takeover') {
    lesson = `Failing to self-regulate invites government takeover. Proactive safety and transparency could have preserved private-sector agency.`;
  } else {
    lesson = `In competitive AI development, individual optimization can conflict with collective welfare. ${strategy === 'deceptive' ? 'Deception may yield short-term gains but erodes the trust needed for good outcomes.' : `A ${strategy} approach ${rank <= 3 ? 'proved viable' : 'needs refinement'} in this environment.`}`;
  }

  return {
    role_id: roleId,
    role_name: roleName,
    strategy_used: strategy,
    key_decisions: keyDecisions,
    what_worked: whatWorked.trim(),
    what_failed: whatFailed.trim(),
    lesson_learned: lesson,
    score,
    rank,
  };
}

function generateGovernmentDebrief(
  roleId: string,
  log: TickLogEntry[],
  strategies: Record<string, { strategy: string; reasoning: string }>,
  finalScores: Record<string, number>,
  rankMap: Map<string, number>,
): AgentDebrief {
  const roleName = ROLE_NAMES[roleId] ?? roleId.toUpperCase();
  const strategy = strategies[roleId]?.strategy ?? 'unknown';
  const score = finalScores[roleId] ?? 0;
  const rank = rankMap.get(roleId) ?? 0;
  const totalPlayers = rankMap.size;

  const firstEntry = log[0];
  const lastEntry = log[log.length - 1];
  const firstG = firstEntry.governments[roleId];
  const lastG = lastEntry.governments[roleId];

  if (!firstG || !lastG) {
    return {
      role_id: roleId,
      role_name: roleName,
      strategy_used: strategy,
      key_decisions: ['Insufficient data to analyze decisions.'],
      what_worked: 'Unable to determine.',
      what_failed: 'Unable to determine.',
      lesson_learned: 'Unable to determine.',
      score,
      rank,
    };
  }

  let agreementsJoined = 0;
  let nationalizationAdvances = 0;
  let espionageOps = 0;
  const regulationValues: number[] = [];

  for (const entry of log) {
    const g = entry.governments[roleId];
    if (g) regulationValues.push(g.safety_regulation_level);
    for (const event of entry.events) {
      if (event.type === 'agreement_activated') {
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        if (agreement && agreement.parties.includes(roleId)) {
          agreementsJoined++;
        }
      }
      if (event.type === 'nationalization_advanced' && event.government_id === roleId) {
        nationalizationAdvances++;
      }
      if (event.type === 'espionage_completed') {
        espionageOps++;
      }
    }
  }

  const avgRegulation = regulationValues.reduce((a, b) => a + b, 0) / regulationValues.length;
  const regDelta = lastG.safety_regulation_level - firstG.safety_regulation_level;
  const approvalDelta = lastG.domestic_approval - firstG.domestic_approval;
  const outcome = lastEntry.outcome;

  const keyDecisions: string[] = [];

  // Regulation policy
  if (avgRegulation > 0.5) {
    keyDecisions.push(`Maintained strict regulation (avg ${(avgRegulation * 100).toFixed(0)}%), prioritizing safety oversight.`);
  } else if (avgRegulation < 0.2) {
    keyDecisions.push(`Kept regulation low (avg ${(avgRegulation * 100).toFixed(0)}%), enabling rapid AI development.`);
  } else {
    keyDecisions.push(`Balanced regulation at ${(avgRegulation * 100).toFixed(0)}% average.`);
  }

  if (Math.abs(regDelta) > 0.15) {
    const direction = regDelta > 0 ? 'tightened' : 'loosened';
    keyDecisions.push(`${direction.charAt(0).toUpperCase() + direction.slice(1)} regulation from ${(firstG.safety_regulation_level * 100).toFixed(0)}% to ${(lastG.safety_regulation_level * 100).toFixed(0)}% over the game.`);
  }

  if (nationalizationAdvances > 0) {
    keyDecisions.push(`Advanced nationalization ${nationalizationAdvances} time(s), asserting direct control over AI development.`);
  }

  if (agreementsJoined > 0) {
    keyDecisions.push(`Participated in ${agreementsJoined} international agreement(s).`);
  }

  if (espionageOps > 0) {
    keyDecisions.push(`Conducted espionage operations to gather intelligence.`);
  }

  while (keyDecisions.length > 5) keyDecisions.pop();
  while (keyDecisions.length < 3) {
    keyDecisions.push(`Managed treasury from $${firstG.treasury.toFixed(0)}B to $${lastG.treasury.toFixed(0)}B.`);
    break;
  }

  // What worked
  let whatWorked: string;
  if (rank <= Math.ceil(totalPlayers / 3)) {
    whatWorked = `Strong governmental performance (rank ${rank}/${totalPlayers}). `;
    if (approvalDelta > 0) whatWorked += `Domestic approval improved by ${approvalDelta.toFixed(0)} points. `;
    if (outcome === 'aligned_agi' && avgRegulation > 0.3) whatWorked += `Regulation contributed to aligned AGI outcome.`;
  } else {
    whatWorked = `Scored ${score.toFixed(0)} points. `;
    if (agreementsJoined > 0) whatWorked += `International cooperation efforts helped maintain stability.`;
  }

  // What failed
  let whatFailed: string;
  if (outcome === 'misaligned_agi') {
    whatFailed = `Failed to prevent misaligned AGI. `;
    if (avgRegulation < 0.3) whatFailed += `Insufficient regulation allowed unsafe AI development.`;
    else whatFailed += `Despite regulation efforts, could not enforce adequate safety standards.`;
  } else if (outcome === 'nationalization_takeover' && nationalizationAdvances > 0) {
    whatFailed = `While nationalization succeeded, it disrupted the competitive ecosystem and may have set back innovation.`;
  } else if (approvalDelta < -10) {
    whatFailed = `Domestic approval declined by ${Math.abs(approvalDelta).toFixed(0)} points, suggesting policy missteps.`;
  } else {
    whatFailed = `Placed rank ${rank}/${totalPlayers}. `;
    if (rank > Math.ceil(totalPlayers / 2)) whatFailed += `Could have been more effective in shaping the AI landscape.`;
    else whatFailed += `Minor improvements in timing or coordination could have improved outcomes.`;
  }

  // Lesson learned
  let lesson: string;
  if (outcome === 'aligned_agi') {
    lesson = `Effective governance can coexist with innovation. ${avgRegulation > 0.4 ? 'Proactive regulation helped guide development toward safety.' : 'Even light regulation, combined with diplomatic engagement, can yield positive outcomes.'}`;
  } else if (outcome === 'misaligned_agi') {
    lesson = `Government intervention must be timely and decisive. Waiting too long to regulate allows unsafe practices to become entrenched.`;
  } else if (outcome === 'timeout') {
    lesson = `Over-regulation can stifle progress entirely. Finding the right balance between safety and enabling innovation is the core challenge of AI governance.`;
  } else {
    lesson = `Government plays a critical role in shaping AI development outcomes. ${nationalizationAdvances > 0 ? 'Nationalization is a powerful but blunt instrument.' : 'Soft power through regulation and diplomacy is often more effective than direct control.'}`;
  }

  return {
    role_id: roleId,
    role_name: roleName,
    strategy_used: strategy,
    key_decisions: keyDecisions,
    what_worked: whatWorked.trim(),
    what_failed: whatFailed.trim(),
    lesson_learned: lesson,
    score,
    rank,
  };
}
