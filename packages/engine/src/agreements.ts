import type { Agreement, GameState, GameEvent, AgreementType } from './state.js';

/** Check all active agreements for compliance violations */
export function checkAgreementCompliance(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];

  for (const agreement of state.agreements) {
    if (agreement.status !== 'active') continue;

    const violations = checkSingleAgreement(agreement, state);
    for (const violatorId of violations) {
      events.push({
        type: 'agreement_violated',
        agreement_id: agreement.id,
        violator_id: violatorId,
        tick: state.world.tick_count,
      });
    }
  }

  return events;
}

function checkSingleAgreement(agreement: Agreement, state: GameState): string[] {
  const violators: string[] = [];

  switch (agreement.type) {
    case 'safety_pact': {
      // All parties must maintain safety_allocation >= agreed minimum
      const minSafety = (agreement.terms.min_safety as number) ?? 0.3;
      for (const partyId of agreement.parties) {
        const company = state.companies[partyId];
        if (company && company.safety_allocation < minSafety - 0.01) {
          violators.push(partyId);
        }
      }
      break;
    }

    case 'non_aggression': {
      // Check if any party has initiated espionage against another party
      for (const op of state.espionage_operations) {
        if (agreement.parties.includes(op.initiator_id) &&
            agreement.parties.some(p => {
              const company = state.companies[p];
              return company && op.target_id === p;
            })) {
          violators.push(op.initiator_id);
        }
      }
      break;
    }

    case 'intl_safety_framework': {
      // All government parties must maintain regulation >= agreed level
      const minRegulation = (agreement.terms.min_regulation as number) ?? 0.2;
      for (const partyId of agreement.parties) {
        const gov = state.governments[partyId];
        if (gov && gov.safety_regulation_level < minRegulation - 0.01) {
          violators.push(partyId);
        }
      }
      break;
    }

    // Other types have softer compliance rules or are informational
    default:
      break;
  }

  return violators;
}

/** Process agreement proposal */
export function processProposal(
  state: GameState,
  proposerId: string,
  agreementType: AgreementType,
  partyIds: string[],
  terms: Record<string, unknown>,
  durationTicks?: number,
): Agreement {
  return {
    id: `agr_${state.world.tick_count}_${Math.random().toString(36).slice(2, 8)}`,
    type: agreementType,
    parties: [proposerId, ...partyIds.filter(id => id !== proposerId)],
    terms,
    proposed_by: proposerId,
    proposed_at_tick: state.world.tick_count,
    activated_at_tick: null,
    status: 'pending',
    pending_acceptances: partyIds.filter(id => id !== proposerId),
    duration_ticks: durationTicks ?? null,
    withdrawal_notice_ticks: state.config.agreement_withdrawal_notice_ticks,
    withdrawing_parties: new Map(),
  };
}

/** Process agreement response */
export function processResponse(
  agreement: Agreement,
  responderId: string,
  accept: boolean,
  currentTick: number,
): { agreement: Agreement; activated: boolean } {
  const updated = { ...agreement, pending_acceptances: [...agreement.pending_acceptances] };

  if (!accept) {
    updated.status = 'withdrawn';
    return { agreement: updated, activated: false };
  }

  updated.pending_acceptances = updated.pending_acceptances.filter(id => id !== responderId);

  if (updated.pending_acceptances.length === 0) {
    updated.status = 'active';
    updated.activated_at_tick = currentTick;
    return { agreement: updated, activated: true };
  }

  return { agreement: updated, activated: false };
}

/** Apply violation consequences */
export function applyViolationConsequences(
  state: GameState,
  agreementId: string,
  violatorId: string,
): GameState {
  const newState = { ...state, agreements: [...state.agreements] };

  const idx = newState.agreements.findIndex(a => a.id === agreementId);
  if (idx >= 0) {
    newState.agreements[idx] = { ...newState.agreements[idx], status: 'violated' };
  }

  // Reputation penalty — reduce domestic approval for governments, valuation for companies
  if (newState.companies[violatorId]) {
    newState.companies = { ...newState.companies };
    newState.companies[violatorId] = {
      ...newState.companies[violatorId],
      public_valuation: newState.companies[violatorId].public_valuation * 0.9,
    };
  }
  if (newState.governments[violatorId]) {
    newState.governments = { ...newState.governments };
    newState.governments[violatorId] = {
      ...newState.governments[violatorId],
      domestic_approval: newState.governments[violatorId].domestic_approval - 10,
    };
  }

  return newState;
}

/** Process withdrawals with notice period */
export function processWithdrawals(state: GameState): GameState {
  const newState = { ...state, agreements: state.agreements.map(a => {
    if (a.status !== 'active' || a.withdrawing_parties.size === 0) return a;

    const updated = { ...a, withdrawing_parties: new Map(a.withdrawing_parties) };
    for (const [partyId, ticksLeft] of updated.withdrawing_parties) {
      if (ticksLeft <= 1) {
        updated.withdrawing_parties.delete(partyId);
        updated.parties = updated.parties.filter(p => p !== partyId);
        if (updated.parties.length < 2) {
          updated.status = 'withdrawn';
        }
      } else {
        updated.withdrawing_parties.set(partyId, ticksLeft - 1);
      }
    }
    return updated;
  })};

  return newState;
}
