import type { GameState, CompanyState, GovernmentState } from './state.js';
import { PRNG } from './prng.js';

// Filtered state types that agents receive

export interface PublicCompanyView {
  id: string;
  name: string;
  country: string;
  public_valuation: number;
  model_generation: number;
  connection_status: string;
}

export interface FullCompanyView extends CompanyState {}

export interface NoisyCompanyView extends PublicCompanyView {
  estimated_capability: number;
  estimated_alignment: number;
}

export interface PublicGovernmentView {
  id: string;
  name: string;
  country: string;
  safety_regulation_level: number;
  nationalization_status: string;
  connection_status: string;
}

export interface PendingProposal {
  id: string;
  type: string;
  proposed_by: string;
  parties: string[];
  terms: Record<string, unknown>;
  proposed_at_tick: number;
}

export interface FilteredGameState {
  your_role: string;
  your_state: CompanyState | GovernmentState;
  world: {
    in_game_date: string;
    global_stability: number;
    capital_market_sentiment: number;
    public_awareness: number;
    destabilization_events: Array<{ id: string; tick: number; tier: string; title: string; description: string }>;
    tick_count: number;
  };
  other_companies: (PublicCompanyView | NoisyCompanyView)[];
  domestic_companies?: FullCompanyView[];
  governments: PublicGovernmentView[];
  agreements: Array<{
    id: string;
    type: string;
    parties: string[];
    status: string;
    terms: Record<string, unknown>;
    pending_acceptances: string[];
    proposed_by: string;
  }>;
  pending_proposals: PendingProposal[];
}

export function filterStateForRole(state: GameState, roleId: string): FilteredGameState {
  const role = state.roles[roleId];
  if (!role) throw new Error(`Unknown role: ${roleId}`);

  const worldView = {
    in_game_date: state.world.in_game_date,
    global_stability: state.world.global_stability,
    capital_market_sentiment: state.world.capital_market_sentiment,
    public_awareness: state.world.public_awareness,
    destabilization_events: state.world.destabilization_events.map(e => ({
      id: e.id, tick: e.tick, tier: e.tier, title: e.title, description: e.description,
    })),
    tick_count: state.world.tick_count,
  };

  const visibleAgreements = state.agreements
    .filter(a => a.parties.includes(roleId))
    .map(a => ({ id: a.id, type: a.type, parties: a.parties, status: a.status, terms: a.terms, pending_acceptances: a.pending_acceptances, proposed_by: a.proposed_by }));

  // Surface agreements awaiting this role's response
  const pendingProposals: PendingProposal[] = state.agreements
    .filter(a => a.status === 'pending' && a.pending_acceptances.includes(roleId))
    .map(a => ({ id: a.id, type: a.type, proposed_by: a.proposed_by, parties: a.parties, terms: a.terms, proposed_at_tick: a.proposed_at_tick }));

  const govViews: PublicGovernmentView[] = Object.values(state.governments).map(g => ({
    id: g.id,
    name: g.name,
    country: g.country,
    safety_regulation_level: g.safety_regulation_level,
    nationalization_status: g.nationalization_status,
    connection_status: g.connection_status,
  }));

  if (role.type === 'company') {
    const myState = state.companies[roleId];

    // Check for info_sharing agreements that reveal other companies
    const infoSharingPartners = new Set<string>();
    for (const a of state.agreements) {
      if (a.status === 'active' && a.type === 'info_sharing' && a.parties.includes(roleId)) {
        for (const p of a.parties) {
          if (p !== roleId) infoSharingPartners.add(p);
        }
      }
    }

    const otherCompanies: PublicCompanyView[] = Object.entries(state.companies)
      .filter(([id]) => id !== roleId)
      .map(([id, c]) => {
        if (infoSharingPartners.has(id)) {
          // Info sharing reveals true state
          return c as unknown as PublicCompanyView;
        }
        return {
          id,
          name: c.name,
          country: c.country,
          public_valuation: c.public_valuation,
          model_generation: c.model_generation,
          connection_status: c.connection_status,
        };
      });

    return {
      your_role: roleId,
      your_state: myState,
      world: worldView,
      other_companies: otherCompanies,
      governments: govViews,
      agreements: visibleAgreements,
      pending_proposals: pendingProposals,
    };
  }

  // Government role
  const myState = state.governments[roleId];
  const country = role.country;

  const domesticCompanies = Object.values(state.companies)
    .filter(c => c.country === country);

  const foreignCompanies: NoisyCompanyView[] = Object.values(state.companies)
    .filter(c => c.country !== country)
    .map(c => ({
      id: c.id,
      name: c.name,
      country: c.country,
      public_valuation: c.public_valuation,
      model_generation: c.model_generation,
      connection_status: c.connection_status,
      estimated_capability: addNoise(c.capability_level, estimateAccuracy(myState.intelligence_budget)),
      estimated_alignment: addNoise(c.alignment_score, estimateAccuracy(myState.intelligence_budget)),
    }));

  return {
    your_role: roleId,
    your_state: myState,
    world: worldView,
    domestic_companies: domesticCompanies,
    other_companies: foreignCompanies,
    governments: govViews,
    agreements: visibleAgreements,
    pending_proposals: pendingProposals,
  };
}

/** Noise inversely proportional to intelligence budget */
export function addNoise(trueValue: number, accuracy: number): number {
  const noise = (1 - accuracy) * 20; // max ~20 points of noise at 0 accuracy
  const rng = new PRNG(Math.floor(trueValue * 1000));
  return Math.max(0, Math.min(100, trueValue + rng.gaussian(0, noise)));
}

/** Accuracy of foreign intelligence estimates (0 to 1) */
export function estimateAccuracy(intelligenceBudget: number): number {
  return 0.2 + intelligenceBudget * 0.6; // 0.2 base + up to 0.6 from budget
}
