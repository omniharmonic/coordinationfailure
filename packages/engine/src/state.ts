// Core game state types for Coordination Failure: The AI Dilemma

export type Country = 'us' | 'china';
export type RoleType = 'company' | 'government';
export type GamePhase = 'lobby' | 'running' | 'ended';
export type NationalizationLevel = 'none' | 'info_sharing' | 'partial' | 'full';
export type GameOutcome = 'aligned_agi' | 'misaligned_agi' | 'stable_world' | 'timeout' | 'nationalization_takeover';
export type ConnectionStatus = 'connected' | 'disconnected' | 'lobby';

export interface CompanyState {
  id: string;
  name: string;
  country: Country;
  capability_level: number;       // 0-100, AGI threshold at ~95
  alignment_score: number;        // 0-100
  safety_allocation: number;      // 0.0-1.0 (player-controlled)
  r_and_d_multiplier: number;     // computed from capability tier
  model_generation: number;       // generation thresholds: 20, 40, 60, 80, 95
  public_valuation: number;       // billions, determines investment attracted
  capital_reserves: number;       // billions, current cash
  burn_rate: number;              // billions per tick
  revenue: number;                // billions per tick
  compute_level: number;          // 0-100
  security_level: number;         // 0-100, defense against espionage
  talent_factor: number;          // multiplier on capability growth
  has_released_model: boolean;
  releases_count: number;
  connection_status: ConnectionStatus;
}

export interface GovernmentState {
  id: string;
  name: string;
  country: Country;
  safety_regulation_level: number;    // 0.0-1.0 (player-controlled)
  nationalization_status: NationalizationLevel;
  nationalization_progress: number;   // ticks into current transition
  treasury: number;                   // billions
  intelligence_budget: number;        // 0.0-1.0
  domestic_approval: number;          // 0-100
  subsidies_allocated: Map<string, number>; // company_id -> amount
  connection_status: ConnectionStatus;
}

export interface EspionageOperation {
  id: string;
  initiator_id: string;      // government role_id
  target_id: string;          // company role_id
  budget: number;
  ticks_remaining: number;
  ticks_total: number;
  detected: boolean;
}

export interface Agreement {
  id: string;
  type: AgreementType;
  parties: string[];          // role_ids
  terms: Record<string, unknown>;
  proposed_by: string;
  proposed_at_tick: number;
  activated_at_tick: number | null;
  status: 'pending' | 'active' | 'violated' | 'withdrawn' | 'expired';
  pending_acceptances: string[];  // parties who haven't responded yet
  duration_ticks: number | null;  // null = until game end
  withdrawal_notice_ticks: number;
  withdrawing_parties: Map<string, number>; // role_id -> ticks remaining
}

export type AgreementType =
  | 'safety_pact'
  | 'info_sharing'
  | 'non_aggression'
  | 'intl_safety_framework'
  | 'joint_research'
  | 'capital_alliance'
  | 'nationalization_accord';

export interface WorldEvent {
  id: string;
  tick: number;
  tier: 'tremor' | 'shock' | 'crisis' | 'catastrophe';
  title: string;
  description: string;
  stability_impact: number;
  sentiment_impact: number;
  effects: EventEffect[];
}

export interface EventEffect {
  target_type: 'all' | 'country' | 'company' | 'government';
  target_id?: string;
  effect_type: string;
  value: number;
}

export interface WorldState {
  in_game_date: string;          // ISO date string, starts 2025-01-01
  global_stability: number;      // 0-100, starts at 80
  capital_market_sentiment: number;  // 0-100, affects investment
  global_investment_pool: number;    // total available investment billions
  public_awareness: number;      // 0-100, how much public knows about AI race
  destabilization_events: WorldEvent[];
  tick_count: number;
}

export interface RoleInfo {
  id: string;
  type: RoleType;
  country: Country;
  name: string;
  display_name: string;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  config: import('./config.js').GameConfig;
  companies: Record<string, CompanyState>;
  governments: Record<string, GovernmentState>;
  roles: Record<string, RoleInfo>;
  agreements: Agreement[];
  espionage_operations: EspionageOperation[];
  world: WorldState;
  scores: Record<string, number>;
  outcome: GameOutcome | null;
}

// Player action types
export type PlayerAction =
  | { type: 'set_safety_allocation'; role_id: string; value: number }
  | { type: 'set_regulation_level'; role_id: string; value: number }
  | { type: 'set_nationalization'; role_id: string; level: NationalizationLevel }
  | { type: 'allocate_subsidies'; role_id: string; company_id: string; amount: number }
  | { type: 'invest_compute'; role_id: string; amount: number }
  | { type: 'invest_security'; role_id: string; amount: number }
  | { type: 'release_model'; role_id: string }
  | { type: 'initiate_espionage'; role_id: string; target_id: string; budget: number }
  | { type: 'propose_agreement'; role_id: string; agreement_type: AgreementType; party_ids: string[]; terms: Record<string, unknown>; duration_ticks?: number }
  | { type: 'respond_agreement'; role_id: string; agreement_id: string; accept: boolean }
  | { type: 'withdraw_agreement'; role_id: string; agreement_id: string };

// Game events emitted by the engine
export type GameEvent =
  | { type: 'generation_reached'; company_id: string; generation: number; tick: number }
  | { type: 'agreement_violated'; agreement_id: string; violator_id: string; tick: number }
  | { type: 'agreement_activated'; agreement_id: string; tick: number }
  | { type: 'espionage_completed'; operation_id: string; initiator_id: string; target_id: string; success: boolean; detected: boolean; tick: number }
  | { type: 'world_event'; event: WorldEvent }
  | { type: 'game_ending'; leading_company: string; capability: number; tick: number }
  | { type: 'game_over'; outcome: GameOutcome; scores: Record<string, number>; tick: number }
  | { type: 'model_released'; company_id: string; generation: number; tick: number }
  | { type: 'nationalization_advanced'; government_id: string; new_level: NationalizationLevel; tick: number }
  | { type: 'capital_crisis'; company_id: string; tick: number };

export interface Notification {
  role_id: string;
  events: GameEvent[];
}
