import type { GameState, GameOutcome, GameEvent, AgreementType } from './state.js';
import { TIME_SPEED_PRESETS } from './config.js';

// Enforceability tiers for agreement scoring
const AGREEMENT_WEIGHTS: Record<AgreementType, { tier: 'enforced' | 'effective' | 'symbolic'; company: number; gov: number }> = {
  safety_pact:            { tier: 'enforced',   company: 12, gov: 18 },
  non_aggression:         { tier: 'enforced',   company: 12, gov: 18 },
  intl_safety_framework:  { tier: 'enforced',   company: 12, gov: 18 },
  info_sharing:           { tier: 'effective',  company: 8,  gov: 12 },
  joint_research:         { tier: 'effective',  company: 8,  gov: 12 },
  capital_alliance:       { tier: 'symbolic',   company: 3,  gov: 5 },
  nationalization_accord: { tier: 'symbolic',   company: 3,  gov: 5 },
};

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
  if (alignmentScore >= ALIGNMENT_TIERS.good) return 'aligned_agi';
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
    : outcome === 'misaligned_agi' ? -0.5
    : 0.3; // nationalization_takeover

  // Determine leading company's country for country-based scoring
  const leadingCountry = leadingCompany ? state.companies[leadingCompany]?.country : undefined;

  for (const [id, company] of Object.entries(state.companies)) {
    let score = 100 * outcomeMultiplier;

    // Bonus for safety contribution
    score += company.alignment_score * 0.3;
    score += company.safety_allocation * 20;

    // Bonus for being the leading company
    if (id === leadingCompany) score += 150;

    // Country-based scoring: solidarity/rivalry bonuses
    if (leadingCompany && id !== leadingCompany && leadingCountry) {
      if (company.country === leadingCountry) {
        // Same country as winner — solidarity
        if (outcome === 'aligned_agi') score += 25;
        if (outcome === 'misaligned_agi') score -= 15;
      } else {
        // Foreign company won — rivalry penalty
        if (outcome === 'aligned_agi') score -= 10;
      }
    }

    // Bonus for agreements (enforceability-weighted with diminishing returns)
    score += computeAgreementScore(id, 'company', state);

    // Penalty for violations
    const violations = state.agreements.filter(
      a => a.status === 'violated' && a.parties.includes(id)
    ).length;
    score -= violations * 20;

    scores[id] = Math.round(score);
  }

  for (const [id, gov] of Object.entries(state.governments)) {
    let score = 100 * outcomeMultiplier;

    // Domestic companies' alignment contributes
    const domesticCompanies = Object.values(state.companies).filter(c => c.country === gov.country);
    const avgAlignment = domesticCompanies.reduce((s, c) => s + c.alignment_score, 0) / domesticCompanies.length;
    score += avgAlignment * 0.3;

    // Regulation contribution
    score += gov.safety_regulation_level * 50;

    // Subsidies contribution
    let totalSubsidies = 0;
    if (gov.subsidies_allocated) {
      for (const amount of gov.subsidies_allocated.values()) {
        totalSubsidies += amount;
      }
    }
    score += totalSubsidies * 0.15;

    // Approval rating
    score += gov.domestic_approval * 0.2;

    // Country-based scoring: government whose company wins/loses
    if (leadingCompany && leadingCountry) {
      if (leadingCountry === gov.country) {
        // Your company achieved AGI
        if (outcome === 'aligned_agi') score += 80;
        if (outcome === 'misaligned_agi') score -= 60;
      } else {
        // Foreign company achieved AGI
        if (outcome === 'aligned_agi') score -= 30;
        if (outcome === 'misaligned_agi') score -= 40;
      }
    }

    // Agreement bonuses (enforceability-weighted with diminishing returns)
    score += computeAgreementScore(id, 'government', state);

    scores[id] = Math.round(score);
  }

  return scores;
}

/** Compute weighted agreement score for a role, with diminishing returns and enforceability tiers */
export function computeAgreementScore(
  roleId: string,
  roleType: 'company' | 'government',
  state: GameState,
): number {
  const honored = state.agreements.filter(
    a => a.parties.includes(roleId) && (a.status === 'active' || a.status === 'expired')
  );

  // Count by type for diminishing returns
  const typeCounts: Partial<Record<AgreementType, number>> = {};
  let total = 0;
  let agreementIndex = 0;

  for (const a of honored) {
    const n = (typeCounts[a.type] ?? 0) + 1;
    typeCounts[a.type] = n;
    agreementIndex++;

    const w = AGREEMENT_WEIGHTS[a.type];
    if (!w) continue; // skip unknown agreement types
    const base = roleType === 'company' ? w.company : w.gov;

    // Diminishing returns: 1st=100%, 2nd=75%, 3rd=50%, 4th=25%, 5th=0%, 6th+= negative
    const dimFactor = 1 - 0.25 * (n - 1);

    // Global tier multiplier based on total agreement count
    let globalMultiplier: number;
    if (agreementIndex <= 4) globalMultiplier = 1.0;
    else if (agreementIndex <= 8) globalMultiplier = 0.5;
    else if (agreementIndex <= 12) globalMultiplier = 0.25;
    else globalMultiplier = 0;

    // Term stringency bonus (enforced types only)
    let stringencyBonus = 0;
    if (w.tier === 'enforced') {
      if (a.type === 'safety_pact') {
        const minSafety = (a.terms.min_safety as number) ?? 0.3;
        stringencyBonus = 5 * Math.max(0, minSafety - 0.3) / 0.7;
      } else if (a.type === 'intl_safety_framework') {
        const minReg = (a.terms.min_regulation as number) ?? 0.2;
        stringencyBonus = 5 * Math.max(0, minReg - 0.2) / 0.8;
      }
      // non_aggression: no bonus (binary)
    }

    // Cross-country multiplier: 1.5x when parties span both US and China
    let crossCountry = 1;
    const countries = new Set<string>();
    for (const partyId of a.parties) {
      const company = state.companies[partyId];
      const gov = state.governments[partyId];
      if (company) countries.add(company.country);
      if (gov) countries.add(gov.country);
    }
    if (countries.has('us') && countries.has('china')) {
      crossCountry = 1.5;
    }

    total += (base + stringencyBonus) * dimFactor * crossCountry * globalMultiplier;
  }

  return total;
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
