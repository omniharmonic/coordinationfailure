import type { GameState, PlayerAction, GameEvent, Notification } from './state.js';
import { TIME_SPEED_PRESETS } from './config.js';
import { computeDevelopment, getGeneration } from './development.js';
import { processCapitalMarkets } from './capital.js';
import { checkAgreementCompliance, applyViolationConsequences, processWithdrawals, processProposal, processResponse } from './agreements.js';
import { processEspionage } from './espionage.js';
import { generateWorldEvents, applyWorldEventEffects, computeGlobalStability } from './events.js';
import { checkEndConditions, checkGameEnding } from './conditions.js';
import { PRNG, hashSeed } from './prng.js';

export interface TickInput {
  current_state: GameState;
  player_actions: PlayerAction[];
  tick_number: number;
}

export interface TickOutput {
  new_state: GameState;
  events: GameEvent[];
  notifications: Notification[];
}

/** The core tick function — pure, deterministic given same inputs and seed */
export function tick(input: TickInput): TickOutput {
  const { current_state, player_actions, tick_number } = input;
  let state = structuredClone(current_state);
  // Restore Maps that structuredClone converts to plain objects
  state = restoreMaps(state);

  const rng = new PRNG(hashSeed(state.id, tick_number));
  const events: GameEvent[] = [];
  const timeConfig = TIME_SPEED_PRESETS[state.config.time_speed];
  const tickDuration = timeConfig.in_game_days_per_tick / 7; // normalize to weeks

  // 1. Apply player actions
  state = applyPlayerActions(state, player_actions);

  // 2. Advance development for each company
  for (const [id, company] of Object.entries(state.companies)) {
    const delta = computeDevelopment(company, state, tickDuration, rng);
    const newCapability = Math.max(0, Math.min(100, company.capability_level + delta.capability));
    state.companies[id] = {
      ...company,
      capability_level: newCapability,
      alignment_score: Math.max(0, Math.min(100, company.alignment_score + delta.alignment)),
      r_and_d_multiplier: delta.capability > 0 ? delta.capability / tickDuration : company.r_and_d_multiplier,
      model_generation: getGeneration(newCapability),
    };
    events.push(...delta.events);
  }

  // 3. Process capital markets
  const capitalResult = processCapitalMarkets(state, tickDuration);
  state = capitalResult.state;
  events.push(...capitalResult.events);

  // 4. Check agreement compliance
  const violations = checkAgreementCompliance(state);
  events.push(...violations);
  for (const v of violations) {
    if (v.type === 'agreement_violated') {
      state = applyViolationConsequences(state, v.agreement_id, v.violator_id);
    }
  }

  // 4b. Process agreement withdrawals
  state = processWithdrawals(state);

  // 5. Process espionage operations
  const espionageResult = processEspionage(state, rng, tickDuration);
  state = espionageResult.state;
  events.push(...espionageResult.events);

  // 6. Generate world events
  const worldEvents = generateWorldEvents(state, rng);
  for (const evt of worldEvents) {
    state.world.destabilization_events.push(evt);
    state = applyWorldEventEffects(state, evt);
    events.push({ type: 'world_event', event: evt });
  }

  // 7. Update global stability
  state.world.global_stability = computeGlobalStability(state);

  // 8. Advance in-game clock
  const currentDate = new Date(state.world.in_game_date);
  currentDate.setDate(currentDate.getDate() + timeConfig.in_game_days_per_tick);
  state.world.in_game_date = currentDate.toISOString().split('T')[0];
  state.world.tick_count = tick_number;

  // 9. Check game ending warning
  const endingWarning = checkGameEnding(state);
  if (endingWarning) events.push(endingWarning);

  // 10. Check win/loss conditions
  const endCondition = checkEndConditions(state);
  if (endCondition) {
    state.outcome = endCondition.outcome;
    state.scores = endCondition.scores;
    state.phase = 'ended';
    events.push({
      type: 'game_over',
      outcome: endCondition.outcome,
      scores: endCondition.scores,
      tick: tick_number,
    });
  }

  // 11. Build per-role notifications
  const notifications = buildNotifications(state, events);

  return { new_state: state, events, notifications };
}

function applyPlayerActions(state: GameState, actions: PlayerAction[]): GameState {
  for (const action of actions) {
    switch (action.type) {
      case 'set_safety_allocation': {
        const company = state.companies[action.role_id];
        if (company) {
          // Enforce government regulation minimum
          const gov = Object.values(state.governments).find(g => g.country === company.country);
          const minSafety = gov ? gov.safety_regulation_level : 0;
          state.companies[action.role_id] = {
            ...company,
            safety_allocation: Math.max(minSafety, Math.min(1, action.value)),
          };
        }
        break;
      }

      case 'set_regulation_level': {
        const gov = state.governments[action.role_id];
        if (gov) {
          state.governments[action.role_id] = {
            ...gov,
            safety_regulation_level: Math.max(0, Math.min(1, action.value)),
          };
        }
        break;
      }

      case 'set_nationalization': {
        const gov = state.governments[action.role_id];
        if (gov) {
          const levels: string[] = ['none', 'info_sharing', 'partial', 'full'];
          const currentIdx = levels.indexOf(gov.nationalization_status);
          const targetIdx = levels.indexOf(action.level);
          // Nationalization can only advance, not reverse
          if (targetIdx > currentIdx) {
            state.governments[action.role_id] = {
              ...gov,
              nationalization_status: action.level,
              nationalization_progress: 0,
            };
          }
        }
        break;
      }

      case 'allocate_subsidies': {
        const gov = state.governments[action.role_id];
        if (gov && gov.treasury >= action.amount) {
          const company = state.companies[action.company_id];
          if (company && company.country === gov.country) {
            const newSubsidies = new Map(gov.subsidies_allocated);
            newSubsidies.set(action.company_id, (newSubsidies.get(action.company_id) ?? 0) + action.amount);
            state.governments[action.role_id] = {
              ...gov,
              treasury: gov.treasury - action.amount,
              subsidies_allocated: newSubsidies,
            };
          }
        }
        break;
      }

      case 'invest_compute': {
        const company = state.companies[action.role_id];
        if (company && company.capital_reserves >= action.amount) {
          state.companies[action.role_id] = {
            ...company,
            capital_reserves: company.capital_reserves - action.amount,
            compute_level: Math.min(100, company.compute_level + action.amount * 2),
          };
        }
        break;
      }

      case 'invest_security': {
        const company = state.companies[action.role_id];
        if (company && company.capital_reserves >= action.amount) {
          state.companies[action.role_id] = {
            ...company,
            capital_reserves: company.capital_reserves - action.amount,
            security_level: Math.min(100, company.security_level + action.amount * 3),
          };
        }
        break;
      }

      case 'release_model': {
        const company = state.companies[action.role_id];
        if (company) {
          state.companies[action.role_id] = {
            ...company,
            has_released_model: true,
            releases_count: company.releases_count + 1,
            public_valuation: company.public_valuation * 1.3,
          };
          state.world.public_awareness = Math.min(100, state.world.public_awareness + 5);
        }
        break;
      }

      case 'initiate_espionage': {
        const gov = state.governments[action.role_id];
        if (gov && gov.treasury >= action.budget) {
          state.governments[action.role_id] = {
            ...gov,
            treasury: gov.treasury - action.budget,
          };
          state.espionage_operations.push({
            id: `esp_${state.world.tick_count}_${action.target_id}`,
            initiator_id: action.role_id,
            target_id: action.target_id,
            budget: action.budget,
            ticks_remaining: 10,
            ticks_total: 10,
            detected: false,
          });
        }
        break;
      }

      case 'propose_agreement': {
        const agreement = processProposal(
          state,
          action.role_id,
          action.agreement_type,
          action.party_ids,
          action.terms,
          action.duration_ticks,
        );
        state.agreements.push(agreement);
        break;
      }

      case 'respond_agreement': {
        const idx = state.agreements.findIndex(a => a.id === action.agreement_id);
        if (idx >= 0) {
          const result = processResponse(
            state.agreements[idx],
            action.role_id,
            action.accept,
            state.world.tick_count,
          );
          state.agreements[idx] = result.agreement;
        }
        break;
      }

      case 'withdraw_agreement': {
        const widx = state.agreements.findIndex(a => a.id === action.agreement_id);
        if (widx >= 0 && state.agreements[widx].status === 'active') {
          const agreement = state.agreements[widx];
          if (!agreement.withdrawing_parties.has(action.role_id)) {
            agreement.withdrawing_parties.set(action.role_id, agreement.withdrawal_notice_ticks);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return state;
}

function buildNotifications(state: GameState, events: GameEvent[]): Notification[] {
  const notifications: Notification[] = [];
  const allRoles = [...Object.keys(state.companies), ...Object.keys(state.governments)];

  for (const roleId of allRoles) {
    const roleEvents = events.filter(e => {
      // All roles see world events and game over
      if (e.type === 'world_event' || e.type === 'game_over' || e.type === 'game_ending') return true;

      // Company-specific events
      if (e.type === 'generation_reached' && e.company_id === roleId) return true;
      if (e.type === 'capital_crisis' && e.company_id === roleId) return true;
      if (e.type === 'model_released' && e.company_id === roleId) return true;

      // Agreement events for parties
      if (e.type === 'agreement_violated' || e.type === 'agreement_activated') {
        const agreement = state.agreements.find(a => a.id === e.agreement_id);
        return agreement?.parties.includes(roleId) ?? false;
      }

      // Espionage events
      if (e.type === 'espionage_completed') {
        const op = state.espionage_operations.find(o => o.id === e.operation_id);
        if (op?.initiator_id === roleId) return true;
        if (e.detected) {
          // Target's government sees detected operations
          const role = state.roles[roleId];
          if (role?.type === 'government') {
            const target = state.companies[op?.target_id ?? ''];
            if (target?.country === role.country) return true;
          }
        }
      }

      return false;
    });

    if (roleEvents.length > 0) {
      notifications.push({ role_id: roleId, events: roleEvents });
    }
  }

  return notifications;
}

/** Restore Maps from plain objects after structuredClone */
function restoreMaps(state: GameState): GameState {
  for (const gov of Object.values(state.governments)) {
    if (!(gov.subsidies_allocated instanceof Map)) {
      gov.subsidies_allocated = new Map(Object.entries(gov.subsidies_allocated as any));
    }
  }
  for (const agreement of state.agreements) {
    if (!(agreement.withdrawing_parties instanceof Map)) {
      agreement.withdrawing_parties = new Map(Object.entries(agreement.withdrawing_parties as any));
    }
  }
  return state;
}

/** Create the initial game state from config */
export function createInitialState(gameId: string, config: import('./config.js').GameConfig): GameState {
  const companies: Record<string, import('./state.js').CompanyState> = {};
  const governments: Record<string, import('./state.js').GovernmentState> = {};
  const roles: Record<string, import('./state.js').RoleInfo> = {};

  for (const cc of config.companies) {
    companies[cc.id] = {
      id: cc.id,
      name: cc.name,
      country: cc.country,
      capability_level: cc.starting_capability,
      alignment_score: cc.starting_alignment,
      safety_allocation: 0.3,
      r_and_d_multiplier: 1.0,
      model_generation: 0,
      public_valuation: cc.starting_valuation,
      capital_reserves: cc.starting_capital,
      burn_rate: cc.burn_rate,
      revenue: 0,
      compute_level: cc.starting_compute,
      security_level: cc.starting_security,
      talent_factor: cc.talent_factor,
      has_released_model: false,
      releases_count: 0,
      connection_status: 'lobby',
    };
    roles[cc.id] = {
      id: cc.id,
      type: 'company',
      country: cc.country,
      name: cc.name,
      display_name: cc.display_name,
    };
  }

  for (const gc of config.governments) {
    governments[gc.id] = {
      id: gc.id,
      name: gc.name,
      country: gc.country,
      safety_regulation_level: gc.starting_regulation,
      nationalization_status: 'none',
      nationalization_progress: 0,
      treasury: gc.starting_treasury,
      intelligence_budget: gc.starting_intelligence_budget,
      domestic_approval: gc.starting_approval,
      subsidies_allocated: new Map(),
      connection_status: 'lobby',
    };
    roles[gc.id] = {
      id: gc.id,
      type: 'government',
      country: gc.country,
      name: gc.name,
      display_name: gc.display_name,
    };
  }

  return {
    id: gameId,
    phase: 'lobby',
    config,
    companies,
    governments,
    roles,
    agreements: [],
    espionage_operations: [],
    world: {
      in_game_date: '2025-01-01',
      global_stability: 80,
      capital_market_sentiment: 70,
      global_investment_pool: config.global_investment_pool,
      public_awareness: 20,
      destabilization_events: [],
      tick_count: 0,
    },
    scores: {},
    outcome: null,
  };
}
