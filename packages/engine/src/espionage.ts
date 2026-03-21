import type { GameState, GameEvent, EspionageOperation } from './state.js';
import { PRNG } from './prng.js';

/** Process all active espionage operations */
export function processEspionage(
  state: GameState,
  rng: PRNG,
  tickDuration: number,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const newOps: EspionageOperation[] = [];

  for (const op of state.espionage_operations) {
    const updated = { ...op, ticks_remaining: op.ticks_remaining - 1 };

    if (updated.ticks_remaining <= 0) {
      // Operation completes — determine success
      const successProb = computeSuccessProbability(updated, state);
      const success = rng.chance(successProb);

      // Detection check
      const target = state.companies[updated.target_id];
      const detectionProb = target
        ? 0.2 + (target.security_level / 100) * 0.5
        : 0.3;
      const detected = rng.chance(detectionProb);

      if (success && target) {
        // Weight theft — boost capability
        const gap = Math.max(0, target.capability_level - 10);
        const stolen = gap * 0.1 * updated.budget;
        // Apply to the initiating country's companies
        const initiatorGov = state.governments[updated.initiator_id];
        if (initiatorGov) {
          for (const [cid, company] of Object.entries(state.companies)) {
            if (company.country === initiatorGov.country) {
              state.companies[cid] = {
                ...company,
                capability_level: company.capability_level + stolen / 2,
              };
            }
          }
        }
      }

      events.push({
        type: 'espionage_completed',
        operation_id: updated.id,
        initiator_id: updated.initiator_id,
        target_id: updated.target_id,
        success,
        detected,
        tick: state.world.tick_count,
      });

      if (detected && target) {
        // Increase target's security
        state.companies[updated.target_id] = {
          ...target,
          security_level: Math.min(100, target.security_level + 10),
        };
      }
    } else {
      newOps.push(updated);
    }
  }

  return {
    state: { ...state, espionage_operations: newOps },
    events,
  };
}

function computeSuccessProbability(
  op: EspionageOperation,
  state: GameState,
): number {
  const target = state.companies[op.target_id];
  const targetSecurity = target ? target.security_level / 100 : 0.3;
  const initiatorGov = state.governments[op.initiator_id];
  const intelBudget = initiatorGov ? initiatorGov.intelligence_budget : 0.3;

  const base = state.config.espionage_base_probability;
  const budgetFactor = 0.5 + op.budget * 0.5;
  const timeFactor = 0.5 + (op.ticks_total / 20) * 0.5;

  return Math.min(0.9, base * budgetFactor * timeFactor * intelBudget / (targetSecurity + 0.1));
}
