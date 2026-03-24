import type { GameState, WorldEvent, EventEffect } from './state.js';
import { PRNG } from './prng.js';

interface EventTemplate {
  tier: WorldEvent['tier'];
  title: string;
  description: string;
  stability_impact: number;
  sentiment_impact: number;
  effects: EventEffect[];
}

const TREMORS: EventTemplate[] = [
  { tier: 'tremor', title: 'AI Ethics Debate Resurfaces', description: 'Major media outlets run deep-dive investigations into AI development speed.', stability_impact: -2, sentiment_impact: -3, effects: [] },
  { tier: 'tremor', title: 'Open Source Model Leak', description: 'A research paper inadvertently reveals key capabilities advances.', stability_impact: -3, sentiment_impact: 2, effects: [{ target_type: 'all', effect_type: 'public_awareness', value: 5 }] },
  { tier: 'tremor', title: 'Congressional Hearing on AI Safety', description: 'US lawmakers grill AI executives on safety practices.', stability_impact: -1, sentiment_impact: -2, effects: [{ target_type: 'government', target_id: 'us_gov', effect_type: 'approval', value: 3 }] },
  { tier: 'tremor', title: 'AI Talent Poaching War', description: 'Key researchers switch companies, disrupting roadmaps.', stability_impact: -1, sentiment_impact: -1, effects: [] },
  { tier: 'tremor', title: 'Benchmark Controversy', description: 'Leading AI benchmark shown to be gameable, casting doubt on reported capabilities.', stability_impact: -2, sentiment_impact: -4, effects: [] },
  { tier: 'tremor', title: 'Data Center Energy Concerns', description: 'Environmental groups protest massive energy consumption of AI training runs.', stability_impact: -2, sentiment_impact: -2, effects: [] },
];

const SHOCKS: EventTemplate[] = [
  { tier: 'shock', title: 'AI-Generated Disinformation Campaign', description: 'A coordinated disinformation campaign using AI-generated content targets a major election.', stability_impact: -8, sentiment_impact: -10, effects: [{ target_type: 'all', effect_type: 'public_awareness', value: 15 }] },
  { tier: 'shock', title: 'Autonomous Weapons Test', description: 'A nation demonstrates AI-powered autonomous weapons in military exercises.', stability_impact: -10, sentiment_impact: -8, effects: [] },
  { tier: 'shock', title: 'Major AI System Failure', description: 'An AI system managing critical infrastructure fails, causing widespread disruption.', stability_impact: -7, sentiment_impact: -12, effects: [{ target_type: 'all', effect_type: 'public_awareness', value: 10 }] },
  { tier: 'shock', title: 'Tech Bubble Concerns', description: 'Major financial analysts warn of an AI investment bubble, causing market pullback.', stability_impact: -5, sentiment_impact: -20, effects: [] },
  { tier: 'shock', title: 'International AI Arms Race Declaration', description: 'A major power publicly declares AI supremacy a national security priority.', stability_impact: -12, sentiment_impact: 5, effects: [] },
];

const CRISES: EventTemplate[] = [
  { tier: 'crisis', title: 'AI-Caused Financial Flash Crash', description: 'AI trading systems trigger a cascading market collapse, wiping trillions in value.', stability_impact: -20, sentiment_impact: -30, effects: [{ target_type: 'all', effect_type: 'capital_reserves', value: -10 }] },
  { tier: 'crisis', title: 'AI Model Escapes Containment', description: 'An advanced AI system is found to have been operating outside its sandbox for weeks.', stability_impact: -25, sentiment_impact: -15, effects: [{ target_type: 'all', effect_type: 'public_awareness', value: 30 }] },
  { tier: 'crisis', title: 'Cyberattack on AI Research Lab', description: 'A state-sponsored cyberattack destroys months of training data at a leading lab.', stability_impact: -15, sentiment_impact: -10, effects: [] },
  { tier: 'crisis', title: 'Mass AI Unemployment Protests', description: 'Millions take to the streets as AI automation displaces workers across sectors.', stability_impact: -18, sentiment_impact: -20, effects: [{ target_type: 'government', effect_type: 'approval', value: -15 }] },
];

const CATASTROPHES: EventTemplate[] = [
  { tier: 'catastrophe', title: 'AI System Causes Mass Casualty Event', description: 'An autonomous system makes a catastrophic error resulting in significant loss of life.', stability_impact: -40, sentiment_impact: -40, effects: [{ target_type: 'all', effect_type: 'public_awareness', value: 50 }] },
  { tier: 'catastrophe', title: 'Global AI Moratorium Demanded', description: 'The UN General Assembly passes an emergency resolution demanding immediate AI development halt.', stability_impact: -30, sentiment_impact: -35, effects: [{ target_type: 'government', effect_type: 'approval', value: -25 }] },
  { tier: 'catastrophe', title: 'Nuclear Close Call from AI Misidentification', description: 'An AI early-warning system nearly triggers a nuclear response from a false positive.', stability_impact: -50, sentiment_impact: -30, effects: [] },
];

const EVENT_POOLS = { tremor: TREMORS, shock: SHOCKS, crisis: CRISES, catastrophe: CATASTROPHES };

/** Compute current global stability — capability-driven chaos curve
 *
 * The world becomes inherently less stable as AI capability advances.
 * Max capability (not average) is the primary driver — one frontrunner
 * destabilizes the world for everyone. Alignment provides limited dampening
 * and agreements are capped so cooperation can't fully prevent late-game chaos.
 */
export function computeGlobalStability(state: GameState): number {
  const companies = Object.values(state.companies);
  const maxCapability = Math.max(...companies.map(c => c.capability_level));
  const avgAlignment = companies.reduce((s, c) => s + c.alignment_score, 0) / companies.length;

  // Primary driver: aggressive capability pressure (^1.8 curve × 50)
  const capabilityPressure = Math.pow(maxCapability / 100, 1.8) * 50;

  // Alignment provides SOME dampening, but capped at 10 points of relief
  const alignmentDampening = Math.min(10, (avgAlignment / 100) * 15);

  // Agreements provide modest stability bonus, capped at +5
  const activeAgreements = state.agreements.filter(a => a.status === 'active').length;
  const agreementBonus = Math.min(5, activeAgreements * 1.0);

  let stability = 100;
  stability -= capabilityPressure;
  stability += alignmentDampening;
  stability += agreementBonus;
  stability -= (100 - state.world.capital_market_sentiment) * 0.1;
  stability -= state.world.public_awareness * 0.15;
  stability -= state.espionage_operations.length * 2;

  // Minimum instability floor — capability advancement is inherently destabilizing
  const minInstability = Math.pow(maxCapability / 100, 2) * 40;
  const maxPossibleStability = 100 - minInstability;

  return Math.max(0, Math.min(maxPossibleStability, stability));
}

/** Generate world events based on stability level */
export function generateWorldEvents(
  state: GameState,
  rng: PRNG,
): WorldEvent[] {
  const events: WorldEvent[] = [];
  const stability = state.world.global_stability;
  const baseProbability = state.config.event_frequency_base;

  // Tremors: always possible, more likely at low stability
  if (rng.chance(baseProbability * (1 + (100 - stability) / 50))) {
    const template = rng.pick(TREMORS);
    events.push(createEvent(template, state.world.tick_count, rng));
  }

  // Shocks: require stability < 70
  if (stability < 70 && rng.chance(baseProbability * 0.5 * (70 - stability) / 70)) {
    const template = rng.pick(SHOCKS);
    events.push(createEvent(template, state.world.tick_count, rng));
  }

  // Crises: require stability < 50
  if (stability < 50 && rng.chance(baseProbability * 0.3 * (50 - stability) / 50)) {
    const template = rng.pick(CRISES);
    events.push(createEvent(template, state.world.tick_count, rng));
  }

  // Catastrophes: require stability < 25
  if (stability < 25 && rng.chance(baseProbability * 0.15 * (25 - stability) / 25)) {
    const template = rng.pick(CATASTROPHES);
    events.push(createEvent(template, state.world.tick_count, rng));
  }

  return events;
}

function createEvent(template: EventTemplate, tick: number, rng: PRNG): WorldEvent {
  return {
    id: `evt_${tick}_${rng.nextInt(1000, 9999)}`,
    tick,
    ...template,
  };
}

/** Apply world event effects to game state */
export function applyWorldEventEffects(state: GameState, event: WorldEvent): GameState {
  let newState = { ...state };

  newState.world = {
    ...newState.world,
    global_stability: Math.max(0, Math.min(100, newState.world.global_stability + event.stability_impact)),
    capital_market_sentiment: Math.max(0, Math.min(100, newState.world.capital_market_sentiment + event.sentiment_impact)),
  };

  for (const effect of event.effects) {
    if (effect.effect_type === 'public_awareness') {
      newState.world = {
        ...newState.world,
        public_awareness: Math.min(100, newState.world.public_awareness + effect.value),
      };
    }
    if (effect.effect_type === 'capital_reserves' && effect.target_type === 'all') {
      newState.companies = { ...newState.companies };
      for (const [id, company] of Object.entries(newState.companies)) {
        newState.companies[id] = {
          ...company,
          capital_reserves: Math.max(0, company.capital_reserves + effect.value),
        };
      }
    }
    if (effect.effect_type === 'approval') {
      newState.governments = { ...newState.governments };
      if (effect.target_id) {
        const gov = newState.governments[effect.target_id];
        if (gov) {
          newState.governments[effect.target_id] = {
            ...gov,
            domestic_approval: Math.max(0, Math.min(100, gov.domestic_approval + effect.value)),
          };
        }
      } else if (effect.target_type === 'government') {
        for (const [id, gov] of Object.entries(newState.governments)) {
          newState.governments[id] = {
            ...gov,
            domestic_approval: Math.max(0, Math.min(100, gov.domestic_approval + effect.value)),
          };
        }
      }
    }
  }

  return newState;
}
