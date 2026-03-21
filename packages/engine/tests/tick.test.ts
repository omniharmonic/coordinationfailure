import { describe, it, expect } from 'vitest';
import { createInitialState, tick } from '../src/tick.js';
import { createDefaultConfig } from '../src/config.js';

describe('createInitialState', () => {
  it('creates state with all 8 roles', () => {
    const config = createDefaultConfig();
    const state = createInitialState('test-game-1', config);

    expect(Object.keys(state.companies)).toHaveLength(6);
    expect(Object.keys(state.governments)).toHaveLength(2);
    expect(Object.keys(state.roles)).toHaveLength(8);
    expect(state.phase).toBe('lobby');
    expect(state.world.global_stability).toBe(80);
  });

  it('assigns correct countries', () => {
    const config = createDefaultConfig();
    const state = createInitialState('test-game-2', config);

    const usCompanies = Object.values(state.companies).filter(c => c.country === 'us');
    const chinaCompanies = Object.values(state.companies).filter(c => c.country === 'china');
    expect(usCompanies).toHaveLength(4);
    expect(chinaCompanies).toHaveLength(2);
  });
});

describe('tick', () => {
  it('advances state without crashing on empty actions', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-3', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [],
      tick_number: 1,
    });

    expect(result.new_state.world.tick_count).toBe(1);
    expect(result.new_state.phase).toBe('running');
  });

  it('applies safety allocation action', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-4', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [
        { type: 'set_safety_allocation', role_id: 'openbrain', value: 0.8 },
      ],
      tick_number: 1,
    });

    expect(result.new_state.companies.openbrain.safety_allocation).toBe(0.8);
  });

  it('enforces regulation minimum on safety allocation', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-5', config);
    state.phase = 'running';
    state.governments.us_gov.safety_regulation_level = 0.5;

    const result = tick({
      current_state: state,
      player_actions: [
        { type: 'set_safety_allocation', role_id: 'openbrain', value: 0.1 },
      ],
      tick_number: 1,
    });

    // Should be clamped to regulation minimum of 0.5
    expect(result.new_state.companies.openbrain.safety_allocation).toBe(0.5);
  });

  it('capability grows over time', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('test-game-6', config);
    state.phase = 'running';

    const initialCap = state.companies.openbrain.capability_level;

    const result = tick({
      current_state: state,
      player_actions: [],
      tick_number: 1,
    });

    expect(result.new_state.companies.openbrain.capability_level).toBeGreaterThan(initialCap);
  });

  it('is deterministic with same seed', () => {
    const config = createDefaultConfig({ seed: 42 });

    const state1 = createInitialState('test-game-7', config);
    state1.phase = 'running';
    const result1 = tick({ current_state: state1, player_actions: [], tick_number: 1 });

    const state2 = createInitialState('test-game-7', config);
    state2.phase = 'running';
    const result2 = tick({ current_state: state2, player_actions: [], tick_number: 1 });

    expect(result1.new_state.companies.openbrain.capability_level)
      .toBe(result2.new_state.companies.openbrain.capability_level);
  });

  it('runs 100 ticks without NaN or corruption', () => {
    const config = createDefaultConfig({ seed: 123 });
    let state = createInitialState('stress-test', config);
    state.phase = 'running';

    for (let i = 1; i <= 100; i++) {
      const result = tick({ current_state: state, player_actions: [], tick_number: i });
      state = result.new_state;

      // Verify no NaN or Infinity
      for (const company of Object.values(state.companies)) {
        expect(Number.isFinite(company.capability_level)).toBe(true);
        expect(Number.isFinite(company.alignment_score)).toBe(true);
        expect(Number.isFinite(company.capital_reserves)).toBe(true);
        expect(Number.isFinite(company.public_valuation)).toBe(true);
      }
      expect(Number.isFinite(state.world.global_stability)).toBe(true);
    }
  });

  it('zero safety causes alignment collapse at high capability', () => {
    const config = createDefaultConfig({ seed: 42 });
    let state = createInitialState('collapse-test', config);
    state.phase = 'running';
    // Start with high capability, zero safety
    state.companies.openbrain.capability_level = 75;
    state.companies.openbrain.safety_allocation = 0;

    for (let i = 1; i <= 50; i++) {
      const result = tick({ current_state: state, player_actions: [], tick_number: i });
      state = result.new_state;
    }

    // Alignment should have dropped significantly from starting 60
    expect(state.companies.openbrain.alignment_score).toBeLessThan(55);
  });

  it('processes agreement proposal and acceptance', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('agreement-test', config);
    state.phase = 'running';

    // Tick 1: propose agreement
    const result1 = tick({
      current_state: state,
      player_actions: [{
        type: 'propose_agreement',
        role_id: 'openbrain',
        agreement_type: 'safety_pact',
        party_ids: ['openbrain', 'prometheus'],
        terms: { min_safety: 0.3 },
      }],
      tick_number: 1,
    });

    expect(result1.new_state.agreements).toHaveLength(1);
    expect(result1.new_state.agreements[0].status).toBe('pending');
    expect(result1.new_state.agreements[0].type).toBe('safety_pact');

    const agreementId = result1.new_state.agreements[0].id;

    // Tick 2: accept agreement
    const result2 = tick({
      current_state: result1.new_state,
      player_actions: [{
        type: 'respond_agreement',
        role_id: 'prometheus',
        agreement_id: agreementId,
        accept: true,
      }],
      tick_number: 2,
    });

    expect(result2.new_state.agreements[0].status).toBe('active');
    // activated_at_tick uses the tick count at time of action processing (before clock advance)
    expect(result2.new_state.agreements[0].activated_at_tick).toBe(1);
  });

  it('handles nationalization progression', () => {
    const config = createDefaultConfig({ seed: 42 });
    const state = createInitialState('nat-test', config);
    state.phase = 'running';

    const result = tick({
      current_state: state,
      player_actions: [{
        type: 'set_nationalization',
        role_id: 'us_gov',
        level: 'info_sharing',
      }],
      tick_number: 1,
    });

    expect(result.new_state.governments.us_gov.nationalization_status).toBe('info_sharing');

    // Can't go backwards
    const result2 = tick({
      current_state: result.new_state,
      player_actions: [{
        type: 'set_nationalization',
        role_id: 'us_gov',
        level: 'none',
      }],
      tick_number: 2,
    });

    expect(result2.new_state.governments.us_gov.nationalization_status).toBe('info_sharing');
  });
});
