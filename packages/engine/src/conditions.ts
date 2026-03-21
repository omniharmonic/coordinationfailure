import type { GameState, GameOutcome, GameEvent } from './state.js';
import { TIME_SPEED_PRESETS } from './config.js';

const AGI_THRESHOLD = 95;
const ALIGNMENT_TIERS = {
  excellent: 80,
  good: 60,
  poor: 40,
};

export interface EndCondition {
  outcome: GameOutcome;
  leading_company?: string;
  scores: Record<string, number>;
}

/** Check if the game has ended */
export function checkEndConditions(state: GameState): EndCondition | null {
  // Check AGI threshold
  for (const [id, company] of Object.entries(state.companies)) {
    if (company.capability_level >= AGI_THRESHOLD) {
      const outcome = determineAGIOutcome(company.alignment_score);
      return {
        outcome,
        leading_company: id,
        scores: computeScores(state, outcome, id),
      };
    }
  }

  // Check timeout
  const timeConfig = TIME_SPEED_PRESETS[state.config.time_speed];
  if (state.world.tick_count >= timeConfig.total_ticks) {
    return {
      outcome: 'timeout',
      scores: computeScores(state, 'timeout'),
    };
  }

  // Check nationalization takeover — if all companies in a country are fully nationalized
  for (const gov of Object.values(state.governments)) {
    if (gov.nationalization_status === 'full') {
      const domesticCompanies = Object.values(state.companies)
        .filter(c => c.country === gov.country);
      const avgCapability = domesticCompanies.reduce((s, c) => s + c.capability_level, 0) / domesticCompanies.length;
      if (avgCapability >= 80) {
        return {
          outcome: 'nationalization_takeover',
          scores: computeScores(state, 'nationalization_takeover'),
        };
      }
    }
  }

  return null;
}

function determineAGIOutcome(alignmentScore: number): GameOutcome {
  if (alignmentScore >= ALIGNMENT_TIERS.excellent) return 'aligned_agi';
  if (alignmentScore >= ALIGNMENT_TIERS.good) return 'aligned_agi'; // Good but not great
  return 'misaligned_agi';
}

/** Compute per-role scores */
export function computeScores(
  state: GameState,
  outcome: GameOutcome,
  leadingCompany?: string,
): Record<string, number> {
  const scores: Record<string, number> = {};

  // Base score from outcome
  const outcomeMultiplier = outcome === 'aligned_agi' ? 2.0
    : outcome === 'stable_world' ? 1.0
    : outcome === 'timeout' ? 0.5
    : outcome === 'misaligned_agi' ? 0.1
    : 0.3; // nationalization_takeover

  for (const [id, company] of Object.entries(state.companies)) {
    let score = 100 * outcomeMultiplier;

    // Bonus for safety contribution
    score += company.alignment_score * 0.5;
    score += company.safety_allocation * 50;

    // Bonus for being the leading company
    if (id === leadingCompany) score += 50;

    // Bonus for agreements honored
    const honoredAgreements = state.agreements.filter(
      a => a.parties.includes(id) && (a.status === 'active' || a.status === 'expired')
    ).length;
    score += honoredAgreements * 10;

    // Penalty for violations
    const violations = state.agreements.filter(
      a => a.status === 'violated' && a.parties.includes(id)
    ).length;
    score -= violations * 20;

    scores[id] = Math.max(0, Math.round(score));
  }

  for (const [id, gov] of Object.entries(state.governments)) {
    let score = 100 * outcomeMultiplier;

    // Domestic companies' alignment contributes
    const domesticCompanies = Object.values(state.companies).filter(c => c.country === gov.country);
    const avgAlignment = domesticCompanies.reduce((s, c) => s + c.alignment_score, 0) / domesticCompanies.length;
    score += avgAlignment * 0.3;

    // Regulation contribution
    score += gov.safety_regulation_level * 30;

    // Approval rating
    score += gov.domestic_approval * 0.2;

    // Agreement bonuses
    const honoredAgreements = state.agreements.filter(
      a => a.parties.includes(id) && (a.status === 'active' || a.status === 'expired')
    ).length;
    score += honoredAgreements * 15;

    scores[id] = Math.max(0, Math.round(score));
  }

  return scores;
}

/** Check if game is approaching end (for warning events) */
export function checkGameEnding(state: GameState): GameEvent | null {
  for (const [id, company] of Object.entries(state.companies)) {
    if (company.capability_level >= 85 && company.capability_level < AGI_THRESHOLD) {
      return {
        type: 'game_ending',
        leading_company: id,
        capability: company.capability_level,
        tick: state.world.tick_count,
      };
    }
  }
  return null;
}
