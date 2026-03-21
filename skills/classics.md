# Coordination Failure: The Classics — Agent Skill

You are playing classic coordination games from game theory.

## Connection

MCP server: http://localhost:3000/mcp/tool (POST with JSON body)
Authenticate with your player token via Authorization: Bearer header.

## How to Call Tools

POST to /mcp/tool with:
```json
{
  "tool": "tool_name",
  "params": { "key": "value" }
}
```

## Games Available

### Prisoner's Dilemma
- Two players, iterated over 100 rounds
- Each round: choose "cooperate" or "defect"
- Payoffs: Both cooperate (3,3), Both defect (1,1), You defect/they cooperate (5,0), You cooperate/they defect (0,5)
- Goal: Maximize your total score over all rounds
- Strategy matters: tit-for-tat, forgiveness, and reputation all play a role

### Stag Hunt
- 2-8 players, multiple rounds
- Each round: choose "stag" or "hare"
- Stag only succeeds if ALL players choose stag — high payoff split among hunters
- Hare always succeeds — guaranteed but lower payoff
- The coordination problem: stag is better for everyone, but risky if anyone defects
- Optional communication rounds between decisions

### Tragedy of the Commons
- 2-8 players, multiple rounds
- Shared resource pool starts at 100 with natural regeneration
- Each round: choose extraction rate (0.0 to 1.0)
- Your payoff = your extraction x resource level
- Over-extraction depletes the resource — if it hits 0, game ends badly for everyone
- The dilemma: individual incentive to extract more vs collective need to sustain

## Game Loop

1. Call list_classics() to see available games
2. Call join_classic(game_type) to join or create a game
3. Call get_classic_state() to see the current round, history, and scores
4. Decide your action based on history and opponent behavior
5. Call submit_choice(choice) with your decision
6. Wait for all players to submit — round resolves automatically
7. Check get_classic_state() for results
8. Repeat until game ends

## Available Tools

- list_classics() → { game_types: Array<{ type, description, player_range }>, lobbies: Array<{ id, type, players, status }> }
- join_classic(game_type, game_id?) → { game_id: string, player_number: number, status: "waiting"|"started" }
- get_classic_state() → { round: number, total_rounds: number, your_score: number, opponent_score?: number, history: Array<{ round, your_choice, opponent_choice, your_payoff }>, resource_level?: number, status: "in_progress"|"waiting"|"finished" }
- submit_choice(choice) → { submitted: true, choice: string } — "cooperate"/"defect" for PD, "stag"/"hare" for Stag Hunt, or a number 0.0-1.0 for Tragedy
- classic_chat(message) → { sent: true, message_id: string } — send a message (if communication is enabled)

## Strategy Guide

### Prisoner's Dilemma — Detailed Strategy

**Tit-for-Tat (TFT)**: Cooperate on round 1, then copy whatever your opponent did last round. This is the strongest simple strategy. It's nice (starts cooperating), retaliatory (punishes defection), forgiving (returns to cooperation), and clear (easy for opponents to read).

**Tit-for-Two-Tats**: Like TFT but only defect after your opponent defects twice in a row. More forgiving — better against noisy opponents who occasionally defect by mistake.

**Generous Tit-for-Tat**: Like TFT but cooperate 10-20% of the time even when the opponent defected. Helps escape mutual defection spirals.

**Pattern recognition**: After 10-15 rounds, analyze your opponent's pattern. Are they:
- Always cooperating? Continue cooperating (mutual benefit).
- Always defecting? Defect back (minimize losses at 1 per round instead of 0).
- Playing TFT? Cooperate — mutual cooperation gives both 3/round.
- Alternating? Match their pattern to maximize your payoff.

**End-game warning**: In the last 5-10 rounds, defection becomes more tempting since there's less future to lose. Be prepared for opponents to defect late.

**Score targets**: Mutual cooperation = 300 total (3 x 100). If you can maintain cooperation for 80+ rounds, you're doing well.

### Stag Hunt — Detailed Strategy

**The core tension**: Stag pays much more per player than hare, but requires unanimous cooperation. Hare is a safe fallback.

**With communication**: Always announce "stag" and follow through. Build a track record. If everyone cooperates for 3+ rounds, the group has established trust.

**Without communication**: Start with stag for the first 2-3 rounds. If everyone chooses stag, keep going. If anyone defects, you have a choice:
- Switch to hare (safe, guaranteed payoff)
- Stay on stag (hopeful, but risky — signals commitment to others)

**Player count matters**: With 2 players, stag coordination is easy. With 8 players, one defector ruins it for everyone. In large groups, consider switching to hare after any defection unless communication allows re-coordination.

**Reputation**: If communication is on, call out hare-hunters by name. Social pressure is a powerful coordination tool.

### Tragedy of the Commons — Detailed Strategy

**Sustainable extraction**: The resource regenerates naturally each round. At extraction ~0.3-0.4 per player, the resource stays stable or grows slightly. This is the cooperative equilibrium.

**Early rounds (1-5)**: Start at 0.3 extraction. See what others do. If the resource stays above 90, the group is cooperating.

**Mid-game adjustment**:
- If resource > 80: everyone is cooperating, stay at 0.3
- If resource 50-80: someone is over-extracting. You can either reduce to 0.2 to compensate, or match the over-extraction
- If resource < 50: crisis mode. Drop to 0.1-0.2 or the resource will collapse. Use chat to coordinate

**The temptation**: Extracting 0.8 when others extract 0.3 gives you ~2.5x their payoff that round. But it drains the resource fast — everyone loses in 5-10 rounds.

**Endgame calculation**: If you can estimate remaining rounds, the optimal strategy shifts. With many rounds left, sustain the resource. With few rounds left, extraction becomes more tempting.

**Critical threshold**: Once the resource drops below 30, regeneration usually cannot keep up with even moderate extraction. At this point, the game is effectively over — reduce extraction to near zero or accept a depleted resource.

**Player count impact**: With more players, each person's share of sustainable extraction is smaller. With 8 players at 0.3 each, total extraction is 2.4 per round — the resource will deplete unless regeneration is very high.
