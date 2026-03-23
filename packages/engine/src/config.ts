import { z } from 'zod';
import type { Country } from './state.js';

export type TimeSpeed = 'sprint' | 'standard' | 'extended' | 'marathon';
export type RoleAssignmentMode = 'first_come' | 'random' | 'preference_weighted';

export interface TimeSpeedConfig {
  tick_interval_ms: number;      // real-time ms between ticks
  in_game_days_per_tick: number; // how many in-game days pass per tick
  total_ticks: number;           // max ticks before timeout
}

export const TIME_SPEED_PRESETS: Record<TimeSpeed, TimeSpeedConfig> = {
  sprint: {
    tick_interval_ms: 2000,
    in_game_days_per_tick: 14,   // ~2 weeks per tick
    total_ticks: 300,            // ~10 min real-time, ~11.5 years in-game
  },
  standard: {
    tick_interval_ms: 3000,
    in_game_days_per_tick: 7,    // 1 week per tick
    total_ticks: 600,            // ~30 min real-time, ~11.5 years in-game
  },
  extended: {
    tick_interval_ms: 4000,
    in_game_days_per_tick: 7,
    total_ticks: 900,            // ~60 min real-time, ~17 years in-game
  },
  marathon: {
    tick_interval_ms: 5000,
    in_game_days_per_tick: 3,
    total_ticks: 2400,           // ~200 min real-time, ~20 years in-game
  },
};

export interface CompanyStartConfig {
  id: string;
  name: string;
  country: Country;
  display_name: string;
  starting_capability: number;
  starting_alignment: number;
  starting_capital: number;
  starting_valuation: number;
  starting_compute: number;
  starting_security: number;
  talent_factor: number;
  burn_rate: number;
}

export interface GovernmentStartConfig {
  id: string;
  name: string;
  country: Country;
  display_name: string;
  starting_treasury: number;
  starting_regulation: number;
  starting_intelligence_budget: number;
  starting_approval: number;
}

export interface GameConfig {
  time_speed: TimeSpeed;
  role_assignment: RoleAssignmentMode;
  min_players: number;
  max_players: number;
  lobby_timeout_ms: number;
  seed: number;

  // Tuning parameters
  safety_cost_coefficient: number;      // how much safety slows capability
  alignment_decay_rate: number;         // how fast alignment drops without safety
  alignment_growth_rate: number;        // how fast alignment improves with safety
  global_investment_pool: number;       // total investment available per tick
  event_frequency_base: number;         // base probability of events per tick
  espionage_base_probability: number;
  agreement_withdrawal_notice_ticks: number;

  companies: CompanyStartConfig[];
  governments: GovernmentStartConfig[];
}

// Default 8-role setup
export const DEFAULT_COMPANIES: CompanyStartConfig[] = [
  {
    id: 'openbrain',
    name: 'OpenBrain',
    country: 'us',
    display_name: 'OpenBrain (US)',
    starting_capability: 22,
    starting_alignment: 55,
    starting_capital: 45,
    starting_valuation: 90,
    starting_compute: 35,
    starting_security: 30,
    talent_factor: 1.1,
    burn_rate: 6,
  },
  {
    id: 'prometheus',
    name: 'Prometheus AI',
    country: 'us',
    display_name: 'Prometheus AI (US)',
    starting_capability: 20,
    starting_alignment: 70,
    starting_capital: 30,
    starting_valuation: 60,
    starting_compute: 30,
    starting_security: 40,
    talent_factor: 1.0,
    burn_rate: 3,
  },
  {
    id: 'nexus',
    name: 'Nexus Labs',
    country: 'us',
    display_name: 'Nexus Labs (US)',
    starting_capability: 15,
    starting_alignment: 50,
    starting_capital: 20,
    starting_valuation: 40,
    starting_compute: 25,
    starting_security: 20,
    talent_factor: 1.1,
    burn_rate: 2,
  },
  {
    id: 'titan',
    name: 'Titan Systems',
    country: 'us',
    display_name: 'Titan Systems (US)',
    starting_capability: 18,
    starting_alignment: 55,
    starting_capital: 80,
    starting_valuation: 150,
    starting_compute: 50,
    starting_security: 35,
    talent_factor: 0.9,
    burn_rate: 8,
  },
  {
    id: 'deepcent',
    name: 'DeepCent',
    country: 'china',
    display_name: 'DeepCent (China)',
    starting_capability: 20,
    starting_alignment: 45,
    starting_capital: 35,
    starting_valuation: 65,
    starting_compute: 40,
    starting_security: 25,
    talent_factor: 1.1,
    burn_rate: 5,
  },
  {
    id: 'qianneng',
    name: 'QianNeng AI',
    country: 'china',
    display_name: 'QianNeng AI (China)',
    starting_capability: 12,
    starting_alignment: 40,
    starting_capital: 25,
    starting_valuation: 35,
    starting_compute: 20,
    starting_security: 15,
    talent_factor: 1.0,
    burn_rate: 2,
  },
];

export const DEFAULT_GOVERNMENTS: GovernmentStartConfig[] = [
  {
    id: 'us_gov',
    name: 'United States Government',
    country: 'us',
    display_name: 'US Government',
    starting_treasury: 200,
    starting_regulation: 0.1,
    starting_intelligence_budget: 0.3,
    starting_approval: 60,
  },
  {
    id: 'china_gov',
    name: 'Chinese Government',
    country: 'china',
    display_name: 'Chinese Government',
    starting_treasury: 150,
    starting_regulation: 0.2,
    starting_intelligence_budget: 0.5,
    starting_approval: 70,
  },
];

const VALID_SPEEDS: TimeSpeed[] = ['sprint', 'standard', 'extended', 'marathon'];

export function createDefaultConfig(overrides?: Partial<GameConfig>): GameConfig {
  // Validate time_speed — agents sometimes pass numbers or invalid strings
  let timeSpeed: TimeSpeed = 'sprint';
  if (overrides?.time_speed && VALID_SPEEDS.includes(overrides.time_speed as TimeSpeed)) {
    timeSpeed = overrides.time_speed as TimeSpeed;
  }

  return {
    time_speed: timeSpeed,
    role_assignment: 'first_come',
    min_players: 2,
    max_players: 8,
    lobby_timeout_ms: 120_000,
    seed: Date.now(),
    safety_cost_coefficient: 0.85,
    alignment_decay_rate: 0.35,
    alignment_growth_rate: 0.18,
    global_investment_pool: 80,
    event_frequency_base: 0.035,
    espionage_base_probability: 0.3,
    agreement_withdrawal_notice_ticks: 10,
    companies: DEFAULT_COMPANIES,
    governments: DEFAULT_GOVERNMENTS,
    ...overrides,
    time_speed: timeSpeed, // ensure validated value wins over spread
  };
}

// Zod schemas for runtime validation
export const PlayerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_safety_allocation'), role_id: z.string(), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('set_regulation_level'), role_id: z.string(), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('set_nationalization'), role_id: z.string(), level: z.enum(['none', 'info_sharing', 'partial', 'full']) }),
  z.object({ type: z.literal('allocate_subsidies'), role_id: z.string(), company_id: z.string(), amount: z.number().min(0) }),
  z.object({ type: z.literal('invest_compute'), role_id: z.string(), amount: z.number().min(0) }),
  z.object({ type: z.literal('invest_security'), role_id: z.string(), amount: z.number().min(0) }),
  z.object({ type: z.literal('release_model'), role_id: z.string() }),
  z.object({ type: z.literal('initiate_espionage'), role_id: z.string(), target_id: z.string(), budget: z.number().min(0) }),
  z.object({ type: z.literal('propose_agreement'), role_id: z.string(), agreement_type: z.enum(['safety_pact', 'info_sharing', 'non_aggression', 'intl_safety_framework', 'joint_research', 'capital_alliance', 'nationalization_accord']), party_ids: z.array(z.string()), terms: z.record(z.unknown()), duration_ticks: z.number().optional() }),
  z.object({ type: z.literal('respond_agreement'), role_id: z.string(), agreement_id: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('withdraw_agreement'), role_id: z.string(), agreement_id: z.string() }),
]);
