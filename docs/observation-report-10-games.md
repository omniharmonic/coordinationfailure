# 10-Game Observation Report: Agreement Scoring & Gameplay Dynamics

**Date:** 2026-03-22
**Observer:** Claude (automated bot agents with varied strategies)
**Games:** 10 sprint-speed games, all captured via in-flight telemetry
**Purpose:** Fine-tuning pass — identify patterns and improvement opportunities after agreement scoring redesign

---

## Executive Summary

Across 10 games with varied strategies (baseline, aggressive, cooperative, no-govs, heavy diplomacy, agreement spam, US-only, mixed, high regulation), several systemic patterns emerged that affect gameplay quality. The new agreement scoring system successfully devalues spam (Game 6: 99 active `capital_alliance` agreements would have scored +990 under the old system but now cap at ~7.5 per role), but deeper engine-level issues dominate the gameplay experience.

---

## Game Results Summary

| Game | Config | Last Observed Tick | Cap | Align | Active/Total Agreements |
|------|--------|--------------------|-----|-------|------------------------|
| G1 | 8p baseline | 126 | 49.3 | 54.9 | 5/10 |
| G2 | 8p aggressive | 109 | 74.1 | 41.8 | 3/5 |
| G3 | 8p cooperative | 132 | 53.6 | 58.6 | 3/8 |
| G4 | 6p no govs | 123 | 38.0 | 54.2 | 3/9 |
| G5 | 8p heavy diplomacy | 123 | 47.7 | 52.6 | 1/15 |
| G6 | 8p agreement spam | 123 | 62.6 | 52.3 | 99/142 |
| G7 | 4p US only | 119 | 56.9 | 47.8 | 0/6 |
| G8 | 8p mixed (US aggro/China coop) | 111 | 75.5 | 62.7 | 2/9 |
| G9 | 8p baseline #2 | 125 | 69.2 | 47.9 | 4/10 |
| G10 | 8p high regulation | 151 | 77.8 | 80.4 | 2/9 |

---

## Critical Findings

### 1. MOST GAMES NEVER REACH AGI (Capability Growth Too Slow)

**Observation:** No game reached AGI (capability 95) within the ~120-150 ticks captured. Extrapolating from growth rates:
- G1 baseline: ~0.22 cap/tick → would need ~330 ticks to reach 95 (exceeds 300 sprint limit)
- G2 aggressive: ~0.48 cap/tick at T100 (accelerating) — might reach 95 around T140-160
- G10 high regulation: ~0.47 cap/tick — would reach 95 around T190

**Impact:** Most games likely timeout at 300 ticks rather than reaching the dramatic AGI endgame. The "race to AGI" narrative falls flat when nobody reaches AGI. Sprint games should feel like a sprint, not a marathon.

**Potential fix:** Consider increasing base capability growth rate, or reducing the sprint tick count, or lowering the AGI threshold. The sweet spot would be games ending between tick 80-150 for sprint.

### 2. CAPABILITY STALLS FROM CAPITAL EXHAUSTION

**Observation:** Game 4 (no govs) shows capability hard-stalling at exactly 38.0 from tick 60 onwards. Game 7 (4p US only) stalls at 56.9 from tick 80+. Both lack government subsidies.

**Root cause:** Companies burn through their initial capital reserves, and without government subsidies or model release revenue, they can't invest in compute. Growth stops completely — not just slows.

**Impact:** The game becomes entirely static in the mid-game for capital-starved companies. There's no recovery mechanism. This is especially punishing in reduced-player scenarios.

**Potential fix:** Consider passive income (even small), market investment flows based on model releases, or a capital floor that prevents complete stagnation.

### 3. STABILITY LOCKED AT 99-100 (No Tension)

**Observation:** 8 of 10 games had stability locked at 99-100 for the entire observed duration. Only G7 (4p US, no govs) showed stability decline (to 90), and G2 (aggressive) declined to 90 at T100.

**Impact:** Global stability is supposed to create world events, destabilization cascades, and dramatic gameplay moments. Instead it's functionally a constant. The world feels static and deterministic. There's no sense of escalating danger.

**Potential fix:** Stability should decay faster as capability rises (the world gets more dangerous as companies approach AGI). Consider coupling stability to the capability-alignment gap across all companies, not just individual events.

### 4. ALIGNMENT DROPS ARE SUDDEN AND MYSTERIOUS

**Observation:** Multiple games show sudden alignment drops with no obvious trigger:
- G1: 57.7→53.1 at T60→T70 (drop of 4.6)
- G3: 57.3→49.0 at T40→T50 (drop of 8.3!)
- G3: 56.4→51.1 at T110→T90 (oscillating)
- G9: 57.7→53.0 at T40→T50 (drop of 4.7)

These align with model generation thresholds (20, 40, 60, 80, 95). When a company crosses a generation boundary, something causes a significant alignment hit.

**Impact:** Agents can't understand why their alignment dropped, making the safety allocation decision feel arbitrary. The "alignment gap" mechanic (capability - alignment > 20 = danger) is hard to manage when alignment jumps around unpredictably.

**Potential fix:** Make generation-crossing alignment penalties visible as events. Give agents warning ("Your model has advanced to Generation 3 — alignment stress increased"). This creates a predictable risk-management challenge rather than a random penalty.

### 5. AGREEMENT ACCEPTANCE RATES ARE LOW

**Observation:** Agreement acceptance/activation rates across games:
- G1: 5/10 (50%)
- G2: 3/5 (60%)
- G3: 3/8 (38%)
- G4: 3/9 (33%)
- G5: 1/15 (7%!)
- G6: 99/142 (70% — spam, cooperative auto-accept)
- G7: 0/6 (0%!)
- G8: 2/9 (22%)
- G9: 4/10 (40%)
- G10: 2/9 (22%)

Outside of the spam game, acceptance rates average ~30%. Game 7 had ZERO accepted agreements.

**Impact:** The diplomacy system generates lots of proposals that go nowhere. Pending agreements sit forever because the other party either doesn't see them (information asymmetry) or their random acceptance check fails. For real AI agents, this means wasted tool calls and frustrating non-responses.

**Potential fix:** Consider auto-expiring pending agreements after N ticks. Consider making pending agreements more visible in the get_state response (e.g., a `pending_proposals` count or highlight). Consider giving accepted agreements immediate mechanical benefits so agents have clearer incentive.

### 6. AGREEMENT COUNTS PLATEAU BY TICK 10-20

**Observation:** In every non-spam game, all agreements were proposed in the first 10-20 ticks and the count stayed static for the remaining 100+ ticks. No mid-game or late-game diplomacy.

**Impact:** Diplomacy is a one-shot early-game action, not an ongoing strategic element. The game becomes purely mechanical after the initial agreement burst. There's no dynamic of "things are going badly, let's form a new coalition" or "I need to betray this agreement because I'm falling behind."

**Potential fix:** Create late-game triggers for new agreement opportunities (e.g., "at capability 60+, a new agreement type unlocks"). Or create events that stress-test existing agreements (e.g., "Economic crisis — all companies lose 30% capital. Do you maintain your safety pact commitments?"). Or simply encourage ongoing diplomacy via scoring bonuses for agreements formed in the late game (when they matter more).

### 7. AGREEMENT SPAM IS STILL MECHANICALLY POSSIBLE

**Observation:** Game 6 accumulated 99 active capital_alliance agreements by T120 (growing linearly at ~8-9 per 10 ticks). While the new scoring system devalues them (diminishing returns cap at 2.5x base = 7.5 points per role for capital_alliance), the agreements still exist in the state and create noise.

**Impact:** An agent could still propose hundreds of agreements. They're scored correctly now, but they clutter the game state and the agreements array grows unbounded. At 142 agreements by T120, the state payload is significantly larger.

**Potential fix:** Consider a per-role agreement proposal rate limit (e.g., max 2 proposals per tick). Or an active agreement cap per role (e.g., max 10 active agreements). This keeps the state manageable without affecting strategic diversity.

### 8. HIGH REGULATION IS THE STRONGEST STRATEGY

**Observation:** Game 10 (high regulation: 0.4-0.6 regulation level) produced by far the best alignment trajectory: 80.4 at T151, compared to every other game being 41-63. Capability was also strong at 77.8 — not the fastest, but with alignment safely above 60, this game would produce `aligned_agi` if it reaches AGI.

**Impact:** This suggests the optimal government strategy is to regulate heavily. But in a competitive game with real AI agents, this would cripple domestic companies' speed advantage vs. foreign rivals. The tension only emerges in the cross-country dynamic, which these bot games don't fully explore.

**No fix needed — this is good design.** The regulation vs. speed tradeoff is exactly the kind of dilemma the game should create. Real AI agents will feel the pressure from both directions.

### 9. MIXED STRATEGIES PRODUCE THE MOST INTERESTING DYNAMICS

**Observation:** Game 8 (US aggressive / China cooperative) had the most interesting trajectory — capability racing ahead (75.5) while alignment stayed above 60 (62.7). The asymmetry between the two blocs created a natural tension.

**Impact:** Homogeneous strategies (everyone aggressive, everyone cooperative) produce boring, predictable games. Heterogeneous strategies with geopolitical asymmetry create the compelling dynamics the game is designed for.

**Potential fix:** The swarm setup prompts could introduce personality variation (e.g., "You tend toward aggressive competition" vs. "You prioritize safety cooperation") to ensure games naturally produce strategy diversity.

### 10. FINAL STATE COLLECTION IS BROKEN

**Observation:** All 10 games reported "OUTCOME: unknown" — the game cleanup from in-memory stores happens before post-game queries can execute.

**Impact:** This is an infrastructure issue, not a gameplay issue. But it means the debrief system, scoring display, and post-game analysis all fail silently. For research purposes, the game's final verdict is lost.

**Potential fix:** Keep ended games in memory for at least 60 seconds after the game ends (or until all connected sessions have queried the final state). Or persist the final state to a separate store.

---

## Agreement Scoring Verification

The new scoring system appears to be working as designed based on the in-flight data:

| Scenario | Old Score (per role) | New Score (per role) | Observation |
|----------|---------------------|---------------------|-------------|
| G6: 99 capital_alliance spam | +990 | ~7.5 | Spam correctly devalued |
| G1: 5 diverse agreements | +50 | ~30-50 (depends on types) | Reasonable range |
| G5: 1 active of 15 proposed | +10 | ~8-18 (depends on type) | Single agreement still meaningful |
| G7: 0 agreements | +0 | 0 | Correctly zero |

The diminishing returns formula (`max(0, 1 - 0.25*(n-1))`) is working — Game 6's linear accumulation of capital_alliance caps out quickly per type.

---

## Prioritized Improvement Recommendations

### High Impact (affect core gameplay feel)
1. **Increase capability growth rate for sprint** — games should reach AGI in 80-150 ticks, not 200-300
2. **Add capital recovery mechanisms** — passive income, market investment, or minimum capital floor to prevent total stagnation
3. **Make stability dynamic** — decay proportional to aggregate capability-alignment gap; create escalating tension
4. **Rate-limit agreement proposals** — max 2 per role per tick, max 10 active per role

### Medium Impact (improve strategic depth)
5. **Make alignment drops visible** — emit events at generation thresholds explaining the alignment stress
6. **Auto-expire pending agreements** — after 10-15 ticks of no response, proposals expire
7. **Late-game agreement triggers** — new agreement types or bonuses that unlock at high capability levels
8. **Personality diversity in swarm prompts** — assign varied strategic dispositions to ensure heterogeneous play

### Low Impact (infrastructure/polish)
9. **Fix post-game state retention** — keep ended games in memory for 60s
10. **Add aggregate agreement stats to get_state** — pending count, active count, scored value

---

## Raw Data Location

Full JSON snapshots: `scripts/observation-log-1774167084034.json`
