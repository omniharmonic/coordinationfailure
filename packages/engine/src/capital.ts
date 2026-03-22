import type { CompanyState, GameState, GameEvent } from './state.js';

/** How much of the global pool this company attracts */
export function computeInvestmentAttracted(
  company: CompanyState,
  state: GameState,
): number {
  const totalValuation = Object.values(state.companies)
    .reduce((sum, c) => sum + c.public_valuation, 0);

  if (totalValuation <= 0) return 0;

  const share = company.public_valuation / totalValuation;
  const sentimentFactor = state.world.capital_market_sentiment / 100;
  return state.config.global_investment_pool * share * sentimentFactor;
}

/** Valuation changes based on milestones, releases, incidents */
export function computeValuationDelta(
  company: CompanyState,
  state: GameState,
  tickDuration: number,
): number {
  let delta = 0;

  // Base growth from capability progress
  delta += company.capability_level * 0.02 * tickDuration;

  // Revenue-based growth
  delta += company.revenue * 0.5 * tickDuration;

  // Recent model release bonus (decays)
  if (company.has_released_model) {
    delta += 5 * tickDuration;
  }

  // Market sentiment impact
  const sentimentFactor = (state.world.capital_market_sentiment - 50) / 100;
  delta += company.public_valuation * sentimentFactor * 0.01 * tickDuration;

  // Instability penalty
  const instabilityPenalty = (100 - state.world.global_stability) / 100;
  delta -= company.public_valuation * instabilityPenalty * 0.02 * tickDuration;

  return delta;
}

/** Net capital change per tick */
export function computeCapitalDelta(
  company: CompanyState,
  state: GameState,
  tickDuration: number,
): number {
  const investment = computeInvestmentAttracted(company, state) * tickDuration;
  const revenue = company.revenue * tickDuration;

  // Burn rate scales with capability — more advanced models cost more to run
  const capabilityBurnMultiplier = 1 + (company.capability_level / 100) * 2; // 1x at 0, 3x at 100
  const burn = company.burn_rate * capabilityBurnMultiplier * tickDuration;

  // Government subsidies
  const gov = Object.values(state.governments).find(g => g.country === company.country);
  let subsidies = 0;
  if (gov) {
    subsidies = gov.subsidies_allocated.get(company.id) ?? 0;
  }

  // Safety cost: higher safety allocation increases burn significantly
  const safetyCost = company.safety_allocation * company.burn_rate * 0.5 * tickDuration;

  // Compute maintenance cost — log scaling matches compute benefit curve
  const computeCost = Math.log2(1 + company.compute_level / 50) * company.burn_rate * 0.3 * tickDuration;

  return investment + revenue + subsidies - burn - safetyCost - computeCost;
}

/** Revenue scales with capability, model generation, and releases */
export function computeRevenue(company: CompanyState): number {
  // Quadratic-ish scaling: product-market fit grows non-linearly with capability
  const capabilityRevenue = Math.pow(company.capability_level / 100, 1.5) * 8;
  // Each generation unlocks a new revenue tier
  const generationBonus = company.model_generation * 1.5;
  // Recurring API customer revenue from past releases
  const releaseRevenue = company.releases_count * 0.8;
  // Fresh release buzz — temporary hype bump
  const hypeBonus = company.has_released_model ? 3.0 : 0;
  return capabilityRevenue + generationBonus + releaseRevenue + hypeBonus;
}

/** Process capital markets for all companies */
export function processCapitalMarkets(
  state: GameState,
  tickDuration: number,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const newState = { ...state, companies: { ...state.companies } };

  for (const [id, company] of Object.entries(state.companies)) {
    const updated = { ...company };

    // Update revenue
    updated.revenue = computeRevenue(updated);

    // Update valuation
    const valDelta = computeValuationDelta(updated, state, tickDuration);
    updated.public_valuation = Math.max(1, updated.public_valuation + valDelta);

    // Update capital
    const capDelta = computeCapitalDelta(updated, state, tickDuration);
    updated.capital_reserves = Math.max(0, updated.capital_reserves + capDelta);

    // Capital crisis detection
    if (updated.capital_reserves <= 0 && company.capital_reserves > 0) {
      events.push({
        type: 'capital_crisis',
        company_id: id,
        tick: state.world.tick_count,
      });
    }

    newState.companies[id] = updated;
  }

  return { state: newState, events };
}
