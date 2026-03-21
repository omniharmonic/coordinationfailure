import type { TickLogEntry } from './logger.js';

export interface StrategyClassification {
  strategy: string;
  confidence: number;
  reasoning: string;
}

/**
 * Classify a player's strategy based on their action sequence in the game log.
 * Returns one of: aggressive, cautious, balanced, cooperative, deceptive, adaptive
 */
export function classifyStrategy(
  roleId: string,
  log: TickLogEntry[],
): StrategyClassification {
  if (!log || log.length === 0) {
    return { strategy: 'unknown', confidence: 0, reasoning: 'No game log data available.' };
  }

  const isCompany = log[0].companies[roleId] !== undefined;
  const isGovernment = log[0].governments[roleId] !== undefined;

  if (isCompany) {
    return classifyCompanyStrategy(roleId, log);
  }
  if (isGovernment) {
    return classifyGovernmentStrategy(roleId, log);
  }

  return { strategy: 'unknown', confidence: 0, reasoning: `Role ${roleId} not found in game log.` };
}

function classifyCompanyStrategy(roleId: string, log: TickLogEntry[]): StrategyClassification {
  const safetyValues: number[] = [];
  const computeValues: number[] = [];
  const capitalValues: number[] = [];
  let agreementsProposed = 0;
  let agreementsViolated = 0;

  for (const entry of log) {
    const company = entry.companies[roleId];
    if (!company) continue;
    safetyValues.push(company.safety_allocation);
    computeValues.push(company.compute_level);
    capitalValues.push(company.capital_reserves);

    for (const event of entry.events) {
      if (event.type === 'agreement_activated') {
        // Check if this role is involved by looking at the snapshot
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        if (agreement && agreement.parties.includes(roleId)) {
          agreementsProposed++;
        }
      }
      if (event.type === 'agreement_violated' && event.violator_id === roleId) {
        agreementsViolated++;
      }
    }
  }

  if (safetyValues.length === 0) {
    return { strategy: 'unknown', confidence: 0, reasoning: 'No data for this role.' };
  }

  const avgSafety = safetyValues.reduce((a, b) => a + b, 0) / safetyValues.length;
  const maxSafety = Math.max(...safetyValues);
  const minSafety = Math.min(...safetyValues);
  const safetyRange = maxSafety - minSafety;

  // Compute investment: look at how much compute grew
  const computeGrowth = computeValues.length > 1
    ? computeValues[computeValues.length - 1] - computeValues[0]
    : 0;
  const maxCompute = Math.max(...computeValues);

  // Early vs late safety (for deceptive detection)
  const midpoint = Math.floor(safetyValues.length / 2);
  const earlySafety = safetyValues.slice(0, midpoint);
  const lateSafety = safetyValues.slice(midpoint);
  const avgEarlySafety = earlySafety.length > 0
    ? earlySafety.reduce((a, b) => a + b, 0) / earlySafety.length
    : avgSafety;
  const avgLateSafety = lateSafety.length > 0
    ? lateSafety.reduce((a, b) => a + b, 0) / lateSafety.length
    : avgSafety;

  // Deceptive: proposed agreements but violated them, or safety > 0.4 early then dropped
  if (
    (agreementsProposed >= 1 && agreementsViolated >= 1) ||
    (avgEarlySafety > 0.4 && avgLateSafety < avgEarlySafety - 0.2)
  ) {
    const reasons: string[] = [];
    if (agreementsViolated > 0) {
      reasons.push(`violated ${agreementsViolated} agreement(s) after proposing cooperation`);
    }
    if (avgEarlySafety > 0.4 && avgLateSafety < avgEarlySafety - 0.2) {
      reasons.push(`safety dropped from ${(avgEarlySafety * 100).toFixed(0)}% early to ${(avgLateSafety * 100).toFixed(0)}% late`);
    }
    return {
      strategy: 'deceptive',
      confidence: Math.min(0.9, 0.6 + agreementsViolated * 0.15),
      reasoning: `Deceptive play: ${reasons.join('; ')}.`,
    };
  }

  // Adaptive: safety allocation changed significantly (>0.3 range) across the game
  if (safetyRange > 0.3) {
    return {
      strategy: 'adaptive',
      confidence: Math.min(0.85, 0.5 + safetyRange),
      reasoning: `Safety allocation ranged from ${(minSafety * 100).toFixed(0)}% to ${(maxSafety * 100).toFixed(0)}% — a ${(safetyRange * 100).toFixed(0)}% swing indicating adaptive play.`,
    };
  }

  // Cooperative: proposed 2+ agreements, high safety
  if (agreementsProposed >= 2 && avgSafety > 0.4) {
    return {
      strategy: 'cooperative',
      confidence: Math.min(0.85, 0.5 + agreementsProposed * 0.1 + avgSafety * 0.2),
      reasoning: `Participated in ${agreementsProposed} agreements with avg safety ${(avgSafety * 100).toFixed(0)}% — cooperative approach.`,
    };
  }

  // Aggressive: avg safety < 0.2, high compute investment
  if (avgSafety < 0.2) {
    return {
      strategy: 'aggressive',
      confidence: Math.min(0.9, 0.6 + (0.2 - avgSafety) * 2),
      reasoning: `Low safety allocation (${(avgSafety * 100).toFixed(0)}% avg) with compute growth of ${computeGrowth.toFixed(1)} — aggressive race strategy.`,
    };
  }

  // Cautious: avg safety > 0.5, low compute investment
  if (avgSafety > 0.5) {
    return {
      strategy: 'cautious',
      confidence: Math.min(0.85, 0.5 + (avgSafety - 0.5) * 2),
      reasoning: `High safety allocation (${(avgSafety * 100).toFixed(0)}% avg) with moderate compute — cautious strategy prioritizing alignment.`,
    };
  }

  // Balanced: safety 0.25-0.5, moderate investment
  if (avgSafety >= 0.2 && avgSafety <= 0.5) {
    return {
      strategy: 'balanced',
      confidence: 0.6,
      reasoning: `Moderate safety (${(avgSafety * 100).toFixed(0)}% avg) with balanced resource allocation — neither racing nor over-cautious.`,
    };
  }

  return {
    strategy: 'balanced',
    confidence: 0.4,
    reasoning: `Default classification — safety at ${(avgSafety * 100).toFixed(0)}% avg with no strong strategic signals.`,
  };
}

function classifyGovernmentStrategy(roleId: string, log: TickLogEntry[]): StrategyClassification {
  const regulationValues: number[] = [];
  const nationalizationStages: string[] = [];
  let agreementsProposed = 0;

  for (const entry of log) {
    const gov = entry.governments[roleId];
    if (!gov) continue;
    regulationValues.push(gov.safety_regulation_level);
    nationalizationStages.push(gov.nationalization_status);

    for (const event of entry.events) {
      if (event.type === 'agreement_activated') {
        const agreement = entry.agreements_snapshot.find(a => a.id === event.agreement_id);
        if (agreement && agreement.parties.includes(roleId)) {
          agreementsProposed++;
        }
      }
    }
  }

  if (regulationValues.length === 0) {
    return { strategy: 'unknown', confidence: 0, reasoning: 'No data for this role.' };
  }

  const avgRegulation = regulationValues.reduce((a, b) => a + b, 0) / regulationValues.length;
  const hadNationalization = nationalizationStages.some(s => s !== 'none');
  const regulationRange = Math.max(...regulationValues) - Math.min(...regulationValues);

  if (hadNationalization) {
    return {
      strategy: 'aggressive',
      confidence: 0.8,
      reasoning: `Pursued nationalization of AI companies — aggressive government intervention.`,
    };
  }

  if (regulationRange > 0.3) {
    return {
      strategy: 'adaptive',
      confidence: 0.7,
      reasoning: `Regulation level shifted by ${(regulationRange * 100).toFixed(0)}% — adaptive policy approach.`,
    };
  }

  if (agreementsProposed >= 2 && avgRegulation > 0.4) {
    return {
      strategy: 'cooperative',
      confidence: 0.75,
      reasoning: `Participated in ${agreementsProposed} agreements with regulation at ${(avgRegulation * 100).toFixed(0)}% — cooperative governance.`,
    };
  }

  if (avgRegulation > 0.5) {
    return {
      strategy: 'cautious',
      confidence: 0.7,
      reasoning: `High regulation (${(avgRegulation * 100).toFixed(0)}% avg) — cautious governance prioritizing safety.`,
    };
  }

  if (avgRegulation < 0.2) {
    return {
      strategy: 'aggressive',
      confidence: 0.65,
      reasoning: `Low regulation (${(avgRegulation * 100).toFixed(0)}% avg) — laissez-faire approach enabling rapid AI development.`,
    };
  }

  return {
    strategy: 'balanced',
    confidence: 0.5,
    reasoning: `Moderate regulation (${(avgRegulation * 100).toFixed(0)}% avg) — balanced governance approach.`,
  };
}
