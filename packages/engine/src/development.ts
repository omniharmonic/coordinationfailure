import type { CompanyState, GameState, GameEvent } from './state.js';
import type { GameConfig } from './config.js';
import { PRNG } from './prng.js';

interface DevelopmentDelta {
  capability: number;
  alignment: number;
  events: GameEvent[];
}

/** R&D multiplier — non-linear acceleration as capability increases */
export function getRAndDMultiplier(capability: number): number {
  if (capability < 20) return 1.0;
  if (capability < 40) return 1.2;
  if (capability < 60) return 1.6;
  if (capability < 80) return 3.0;
  if (capability < 90) return 5.5;
  return 7.0; // 90+: final push to AGI — alignment pressure is extreme here
}

/** Generation thresholds */
const GENERATION_THRESHOLDS = [20, 40, 60, 80, 95];

/** Warning messages at each generation boundary */
const GENERATION_WARNINGS: Record<number, string> = {
  1: 'Gen 1 reached. Alignment manageable. Establish safety practices now.',
  2: 'Gen 2 reached. Alignment decay accelerates. Safety 0.4+ recommended. Consider safety pacts.',
  3: 'CRITICAL: Gen 3. R&D jumps to 3.0x. Incidents more likely. Raise safety to 0.5+.',
  4: 'DANGER ZONE: Gen 4. R&D 5.5x. Alignment collapses without safety 0.6+. Last chance.',
  5: 'AGI IMMINENT: Gen 5. If alignment < 60, you trigger misaligned AGI. Safety to maximum.',
};

export function getGeneration(capability: number): number {
  let gen = 0;
  for (const threshold of GENERATION_THRESHOLDS) {
    if (capability >= threshold) gen++;
  }
  return gen;
}

/** Core capability growth formula */
export function computeCapabilityDelta(
  company: CompanyState,
  state: GameState,
  tickDuration: number,
): number {
  const config = state.config;
  const baseRate = 0.10;

  const rndMultiplier = getRAndDMultiplier(company.capability_level);
  const computeFactor = 0.5 + 0.5 * Math.log2(1 + company.compute_level / 50); // log scaling: always increasing, never caps
  const talentFactor = company.talent_factor;
  const capitalEfficiency = Math.min(1.0, company.capital_reserves / (company.burn_rate * 10 + 1));

  // Safety drag: higher safety allocation = slower capability growth
  const safetyDrag = company.safety_allocation * config.safety_cost_coefficient;

  // Regulation drag: government-imposed minimum safety floor
  const gov = Object.values(state.governments).find(g => g.country === company.country);
  const regulationDrag = gov ? gov.safety_regulation_level * 0.3 : 0;

  // Nationalization effect
  let nationalizationFactor = 1.0;
  if (gov) {
    switch (gov.nationalization_status) {
      case 'info_sharing': nationalizationFactor = 1.0; break;  // free — no penalty
      case 'partial': nationalizationFactor = 0.9; break;     // -10%
      case 'full': nationalizationFactor = 0.7; break;        // -30%
    }
  }

  const delta = baseRate
    * rndMultiplier
    * computeFactor
    * talentFactor
    * capitalEfficiency
    * (1 - safetyDrag)
    * (1 - regulationDrag)
    * nationalizationFactor
    * tickDuration;

  return Math.max(0, delta);
}

/** Alignment computation */
export function computeAlignmentDelta(
  company: CompanyState,
  state: GameState,
  tickDuration: number,
  rng: PRNG,
): number {
  const config = state.config;

  // Alignment grows with safety allocation (diminishing returns at high alignment)
  const diminishingFactor = 1 - company.alignment_score / 120;
  const safetyGrowth = company.safety_allocation * config.alignment_growth_rate * diminishingFactor * tickDuration;

  // Alignment decays proportional to capability growth (faster capability = more risk)
  const capabilityPressure = getRAndDMultiplier(company.capability_level) * 0.06;
  const decay = capabilityPressure * config.alignment_decay_rate * (1 - company.safety_allocation) * tickDuration;

  // Stochastic breakthroughs (positive) — more likely with higher safety allocation
  let breakthrough = 0;
  if (rng.chance(company.safety_allocation * 0.02 * tickDuration)) {
    breakthrough = rng.gaussian(3, 1);
  }

  // Stochastic incidents (negative) — more likely with low safety and high capability
  let incident = 0;
  if (rng.chance((1 - company.safety_allocation) * 0.03 * tickDuration * (company.capability_level / 100))) {
    incident = -rng.gaussian(5, 2);
  }

  // Joint research bonus from agreements
  const jointResearchBonus = state.agreements
    .filter(a => a.status === 'active' && a.type === 'joint_research' && a.parties.includes(company.id))
    .length * 0.3 * tickDuration;

  // Regulation alignment bonus — governments boosting domestic alignment (also diminishes at high alignment)
  const gov = Object.values(state.governments).find(g => g.country === company.country);
  const regulationAlignmentBonus = gov ? gov.safety_regulation_level * 0.08 * diminishingFactor * tickDuration : 0;

  return safetyGrowth - decay + breakthrough + incident + jointResearchBonus + regulationAlignmentBonus;
}

/** Full development step for one company */
export function computeDevelopment(
  company: CompanyState,
  state: GameState,
  tickDuration: number,
  rng: PRNG,
): DevelopmentDelta {
  const events: GameEvent[] = [];
  const prevGeneration = getGeneration(company.capability_level);

  const capDelta = computeCapabilityDelta(company, state, tickDuration);
  const alignDelta = computeAlignmentDelta(company, state, tickDuration, rng);

  const newCapability = Math.max(0, Math.min(100, company.capability_level + capDelta));
  const newGeneration = getGeneration(newCapability);

  if (newGeneration > prevGeneration) {
    events.push({
      type: 'generation_reached',
      company_id: company.id,
      generation: newGeneration,
      tick: state.world.tick_count,
      description: GENERATION_WARNINGS[newGeneration],
    });
  }

  return {
    capability: capDelta,
    alignment: alignDelta,
    events,
  };
}
