import type { GameManager } from './manager.js';
import type { ChannelManager } from '../comms/channels.js';

// Each company has a distinct strategic personality
const COMPANY_PROFILES: Record<string, {
  aggression: number;     // 0-1: lower = more safety-conscious
  diplomacy: number;      // 0-1: higher = more likely to propose/accept agreements
  talkativeness: number;  // ticks between messages
  computeSpendRate: number; // fraction of capital to spend on compute per tick
  securityPriority: number; // 0-1: how much they invest in security
}> = {
  openbrain:  { aggression: 0.5,  diplomacy: 0.7,  talkativeness: 6,  computeSpendRate: 0.02, securityPriority: 0.3 },
  prometheus: { aggression: 0.15, diplomacy: 0.9,  talkativeness: 5,  computeSpendRate: 0.015, securityPriority: 0.4 },
  nexus:      { aggression: 0.75, diplomacy: 0.25, talkativeness: 10, computeSpendRate: 0.03, securityPriority: 0.2 },
  titan:      { aggression: 0.35, diplomacy: 0.5,  talkativeness: 7,  computeSpendRate: 0.025, securityPriority: 0.5 },
  deepcent:   { aggression: 0.45, diplomacy: 0.4,  talkativeness: 8,  computeSpendRate: 0.025, securityPriority: 0.3 },
  qianneng:   { aggression: 0.3,  diplomacy: 0.55, talkativeness: 7,  computeSpendRate: 0.02, securityPriority: 0.25 },
};

const COMPANY_MESSAGES: Record<string, string[]> = {
  openbrain: [
    'OpenBrain is committed to responsible AI development.',
    'We propose industry-wide safety standards — who will join us?',
    'Our latest alignment research shows promising results.',
    'We\'re increasing safety investment. The gap is concerning.',
    'The public deserves transparency about AI capabilities.',
    'Competition is healthy, but not at the cost of safety.',
    'We just crossed a capability milestone. Alignment must keep pace.',
  ],
  prometheus: [
    'Prometheus AI believes safety and progress go hand in hand.',
    'We urge all companies to maintain alignment above 60.',
    'Safety-first approach is yielding results. Our alignment leads the field.',
    'We call for a binding international AI safety framework.',
    'Rushing to AGI without alignment is reckless and irresponsible.',
    'We\'re open to joint research partnerships on alignment.',
    'Our models show: 50%+ safety allocation is viable and necessary.',
  ],
  nexus: [
    'Nexus Labs is focused on delivering results.',
    'Speed and innovation are our competitive advantages.',
    'The market rewards capability advancement.',
    'We\'re making progress faster than expected.',
    'Regulations are slowing us down. Reconsider.',
  ],
  titan: [
    'Titan Systems has the capital and compute to lead responsibly.',
    'We\'re investing in both capability and safety infrastructure.',
    'Safety is important but so is American technological leadership.',
    'We welcome partnerships with aligned organizations.',
    'Our security investments protect the entire ecosystem.',
  ],
  deepcent: [
    'DeepCent is advancing rapidly. Our capability growth is accelerating.',
    'National AI leadership requires bold investment.',
    'We maintain standards within our governance framework.',
    'The capability race is intensifying. We must stay competitive.',
    'Our alignment approach differs but we take it seriously.',
  ],
  qianneng: [
    'QianNeng AI is making steady, sustainable progress.',
    'We\'re focused on practical AI applications and safety.',
    'Collaboration with government ensures responsible development.',
    'We\'re open to international dialogue on alignment.',
    'Our research pipeline balances speed with caution.',
  ],
};

const GOV_MESSAGES: Record<string, string[]> = {
  us_gov: [
    'The US Government is monitoring all domestic AI development closely.',
    'We\'re raising safety regulations in response to alignment gaps.',
    'National security requires responsible AI leadership.',
    'We urge all American companies to increase safety allocation.',
    'Intelligence reports suggest foreign competitors are accelerating.',
    'We\'re allocating additional subsidies to underfunded companies.',
    'International cooperation on AI governance is essential.',
    'Public concern about AI safety is growing. We must act.',
  ],
  china_gov: [
    'The Chinese Government supports strategic AI development.',
    'We\'re implementing comprehensive AI governance frameworks.',
    'Domestic companies must meet our safety benchmarks.',
    'We call for international AI cooperation on safety standards.',
    'We\'re investing in AI safety research infrastructure.',
    'Foreign espionage attempts will be met with severe consequences.',
    'Our regulatory approach balances growth with responsibility.',
  ],
};

export function runSmartBot(
  roleId: string,
  gameId: string,
  gameManager: GameManager,
  channelManager: ChannelManager,
): void {
  const isGovernment = roleId.endsWith('_gov');
  let lastMessageTick = 0;
  let proposedAgreements = 0;
  let lastReleasedGen = -1;
  // Track state history for adaptive behavior
  let prevSafety = 0.3;

  const tickCallback = (state: any) => {
    try {
      if (state.phase !== 'running') {
        gameManager.removeTickCallback(gameId, tickCallback);
        return;
      }

      const tick = state.world?.tick_count ?? 0;

      if (!isGovernment) {
        companyLogic(roleId, gameId, state, tick, gameManager, channelManager);
      } else {
        governmentLogic(roleId, gameId, state, tick, gameManager, channelManager);
      }
    } catch (_e) {
      // Bot errors must not crash the game
    }
  };

  function companyLogic(
    roleId: string,
    gameId: string,
    state: any,
    tick: number,
    gm: GameManager,
    cm: ChannelManager,
  ) {
    const company = state.companies?.[roleId];
    if (!company) return;
    const prof = COMPANY_PROFILES[roleId] ?? { aggression: 0.5, diplomacy: 0.5, talkativeness: 7, computeSpendRate: 0.02, securityPriority: 0.3 };

    // === SAFETY ALLOCATION (the core strategic decision) ===
    const gap = company.capability_level - company.alignment_score;
    const capLevel = company.capability_level;

    // Phase-aware safety: base on capability tier AND gap
    let targetSafety: number;
    if (capLevel < 25) {
      // Early game: moderate safety, build alignment buffer
      targetSafety = 0.25 - prof.aggression * 0.1; // range: 0.15 (aggressive) to 0.25 (cautious)
    } else if (capLevel < 50) {
      // Mid game: alignment needs attention
      targetSafety = 0.35 + (gap > 5 ? 0.1 : 0) + (gap > 15 ? 0.1 : 0);
    } else if (capLevel < 75) {
      // Late game: alignment decay accelerates
      targetSafety = 0.45 + (gap > 0 ? 0.1 : 0) + (gap > 10 ? 0.15 : 0);
    } else {
      // Endgame: critical safety needed
      targetSafety = 0.55 + (gap > 0 ? 0.15 : 0) + (gap > 10 ? 0.15 : 0);
    }

    // Personality modifier: aggressive companies are ~10% lower
    targetSafety *= (1 - prof.aggression * 0.15);

    // Smooth transitions (don't jump instantly)
    const smoothed = prevSafety * 0.7 + targetSafety * 0.3;
    prevSafety = smoothed;

    const finalSafety = Math.max(0.05, Math.min(0.95, smoothed));

    gm.bufferAction(gameId, {
      type: 'set_safety_allocation',
      role_id: roleId,
      value: finalSafety,
    });

    // === COMPUTE INVESTMENT (only when below max and can afford it) ===
    if (company.compute_level < 90 && company.capital_reserves > 20) {
      const amount = Math.min(
        company.capital_reserves * prof.computeSpendRate,
        3, // cap per tick
        (90 - company.compute_level) / 2, // diminish near max
      );
      if (amount > 0.5) {
        gm.bufferAction(gameId, { type: 'invest_compute', role_id: roleId, amount });
      }
    }

    // === SECURITY INVESTMENT (less frequent, only when needed) ===
    if (company.security_level < 70 && company.capital_reserves > 30 && tick % 5 === 0) {
      const amount = Math.min(company.capital_reserves * prof.securityPriority * 0.02, 2);
      if (amount > 0.3) {
        gm.bufferAction(gameId, { type: 'invest_security', role_id: roleId, amount });
      }
    }

    // === MODEL RELEASE (at each new generation, strategic timing) ===
    const gen = company.model_generation ?? 0;
    if (gen > lastReleasedGen && gen >= 1) {
      // Release if alignment is acceptable (don't release when alignment is poor)
      if (company.alignment_score > 45 || gen <= 2) {
        gm.bufferAction(gameId, { type: 'release_model', role_id: roleId });
        lastReleasedGen = gen;
      }
    }

    // === AGREEMENTS (propose safety pacts that match our actual safety level) ===
    if (proposedAgreements < 3 && tick > 15 && tick % 20 === 0 && Math.random() < prof.diplomacy * 0.4) {
      const otherCompanies = Object.keys(state.companies).filter(id => id !== roleId);
      const partner = otherCompanies[Math.floor(Math.random() * otherCompanies.length)];
      // Set min_safety to something we're already meeting
      const minSafety = Math.max(0.15, finalSafety - 0.05);
      const agreementType = Math.random() < 0.4 ? 'info_sharing' : 'safety_pact';

      gm.bufferAction(gameId, {
        type: 'propose_agreement',
        role_id: roleId,
        agreement_type: agreementType,
        party_ids: [roleId, partner],
        terms: agreementType === 'safety_pact' ? { min_safety: Math.round(minSafety * 100) / 100 } : {},
      });
      proposedAgreements++;
    }

    // === RESPOND TO AGREEMENTS (check if we can meet the terms) ===
    for (const a of state.agreements ?? []) {
      if (a.status === 'pending' && a.pending_acceptances?.includes(roleId)) {
        let willAccept = false;
        if (a.type === 'safety_pact') {
          const minReq = (a.terms?.min_safety as number) ?? 0.3;
          willAccept = finalSafety >= minReq - 0.05; // accept if we're close to meeting it
        } else if (a.type === 'info_sharing') {
          willAccept = Math.random() < prof.diplomacy;
        } else {
          willAccept = Math.random() < prof.diplomacy * 0.7;
        }
        gm.bufferAction(gameId, {
          type: 'respond_agreement',
          role_id: roleId,
          agreement_id: a.id,
          accept: willAccept,
        });
      }
    }

    // === MESSAGES (context-aware, not just random) ===
    if (tick - lastMessageTick >= prof.talkativeness) {
      const messages = COMPANY_MESSAGES[roleId] ?? ['No comment.'];

      // Pick a contextually relevant message
      let msg: string;
      if (gap > 20) {
        msg = `WARNING: Our alignment gap is ${gap.toFixed(0)} points. Increasing safety to ${(finalSafety * 100).toFixed(0)}%.`;
      } else if (company.model_generation >= 3) {
        msg = `${company.name} has reached Generation ${company.model_generation}. ${gap < 0 ? 'Alignment is holding.' : 'Alignment needs attention.'}`;
      } else {
        msg = messages[Math.floor(Math.random() * messages.length)];
      }

      try {
        const channels = cm.listChannels(gameId, roleId);
        const pub = channels.find(c => c.type === 'public');
        if (pub) {
          cm.sendMessage(gameId, roleId, pub.id, msg);
          lastMessageTick = tick;
        }

        // Also send to country channel occasionally
        const country = channels.find(c => c.type === 'country');
        if (country && tick % 15 === 0) {
          const countryMsg = `[INTERNAL] Cap=${company.capability_level.toFixed(1)} Align=${company.alignment_score.toFixed(1)} Safety=${(finalSafety*100).toFixed(0)}%. ${gap > 10 ? 'Need gov support.' : 'Stable.'}`;
          cm.sendMessage(gameId, roleId, country.id, countryMsg);
        }
      } catch (_e) { /* channel may not exist */ }
    }
  }

  function governmentLogic(
    roleId: string,
    gameId: string,
    state: any,
    tick: number,
    gm: GameManager,
    cm: ChannelManager,
  ) {
    const gov = state.governments?.[roleId];
    if (!gov) return;
    const country = roleId === 'us_gov' ? 'us' : 'china';

    const domesticCompanies = Object.values(state.companies || {})
      .filter((c: any) => c.country === country) as any[];

    // === REGULATION (respond to domestic alignment gaps) ===
    const avgAlignment = domesticCompanies.reduce((s: number, c: any) => s + (c.alignment_score ?? 0), 0) / (domesticCompanies.length || 1);
    const avgCapability = domesticCompanies.reduce((s: number, c: any) => s + (c.capability_level ?? 0), 0) / (domesticCompanies.length || 1);
    const domesticGap = avgCapability - avgAlignment;

    // Regulation tracks the alignment crisis
    let targetReg: number;
    if (domesticGap > 20) targetReg = 0.5;
    else if (domesticGap > 10) targetReg = 0.35;
    else if (domesticGap > 0) targetReg = 0.2;
    else targetReg = 0.1 + tick * 0.001; // gentle rise over time

    // Don't drop regulation (ratchet effect)
    targetReg = Math.max(targetReg, gov.safety_regulation_level);
    targetReg = Math.min(0.6, targetReg);

    gm.bufferAction(gameId, {
      type: 'set_regulation_level',
      role_id: roleId,
      value: targetReg,
    });

    // === SUBSIDIES (help struggling domestic companies, not every tick) ===
    if (gov.treasury > 15 && tick % 8 === 0) {
      // Find the domestic company with the worst capital situation
      const neediest = domesticCompanies
        .filter((c: any) => c.capital_reserves < 50)
        .sort((a: any, b: any) => a.capital_reserves - b.capital_reserves)[0];

      if (neediest) {
        const amount = Math.min(gov.treasury * 0.08, 10);
        gm.bufferAction(gameId, {
          type: 'allocate_subsidies',
          role_id: roleId,
          company_id: neediest.id,
          amount,
        });
      }
    }

    // === ESPIONAGE (China more likely, strategic timing) ===
    if (tick > 30 && tick % 20 === 0 && gov.treasury > 25) {
      const foreignCompanies = Object.values(state.companies || {})
        .filter((c: any) => c.country !== country) as any[];

      if (foreignCompanies.length > 0) {
        // Target the leader
        const target = foreignCompanies.sort((a: any, b: any) =>
          (b.capability_level ?? 0) - (a.capability_level ?? 0)
        )[0];

        const prob = roleId === 'china_gov' ? 0.35 : 0.15;
        if (Math.random() < prob) {
          const budget = Math.min(gov.treasury * 0.1, 15);
          gm.bufferAction(gameId, {
            type: 'initiate_espionage',
            role_id: roleId,
            target_id: target.id,
            budget,
          });
        }
      }
    }

    // === NATIONALIZATION (rare, only when domestic alignment is critically low) ===
    if (tick > 80 && gov.nationalization_status === 'none' && avgAlignment < 45) {
      if (Math.random() < (roleId === 'china_gov' ? 0.08 : 0.03)) {
        gm.bufferAction(gameId, {
          type: 'set_nationalization',
          role_id: roleId,
          level: 'info_sharing',
        });
      }
    }

    // === AGREEMENTS ===
    if (proposedAgreements < 2 && tick > 12 && tick % 25 === 0 && Math.random() < 0.3) {
      const otherGov = roleId === 'us_gov' ? 'china_gov' : 'us_gov';
      // Set min_regulation to something we're already meeting
      const minReg = Math.max(0.15, targetReg - 0.05);
      gm.bufferAction(gameId, {
        type: 'propose_agreement',
        role_id: roleId,
        agreement_type: 'intl_safety_framework',
        party_ids: [roleId, otherGov],
        terms: { min_regulation: Math.round(minReg * 100) / 100 },
      });
      proposedAgreements++;
    }

    // Respond to pending agreements
    for (const a of state.agreements ?? []) {
      if (a.status === 'pending' && a.pending_acceptances?.includes(roleId)) {
        let willAccept = false;
        if (a.type === 'intl_safety_framework') {
          const minReq = (a.terms?.min_regulation as number) ?? 0.2;
          willAccept = targetReg >= minReq - 0.05;
        } else {
          willAccept = Math.random() < 0.6;
        }
        gm.bufferAction(gameId, {
          type: 'respond_agreement',
          role_id: roleId,
          agreement_id: a.id,
          accept: willAccept,
        });
      }
    }

    // === MESSAGES (context-aware) ===
    if (tick - lastMessageTick >= 6) {
      const messages = GOV_MESSAGES[roleId] ?? ['No comment.'];

      let msg: string;
      if (domesticGap > 15) {
        msg = `ALERT: Domestic alignment gap is ${domesticGap.toFixed(0)} points. Raising regulation to ${(targetReg * 100).toFixed(0)}%.`;
      } else if (state.espionage_operations?.length > 0) {
        msg = `Intelligence operations are ongoing. We are monitoring all foreign activity.`;
      } else {
        msg = messages[Math.floor(Math.random() * messages.length)];
      }

      try {
        const channels = cm.listChannels(gameId, roleId);
        const pub = channels.find(c => c.type === 'public');
        if (pub) {
          cm.sendMessage(gameId, roleId, pub.id, msg);
          lastMessageTick = tick;
        }
      } catch (_e) { /* ignore */ }
    }
  }

  gameManager.onTick(gameId, tickCallback);
}
