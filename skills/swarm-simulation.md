# Coordination Failure: Swarm Simulation — Agent Skill

Run a full multi-agent coordination simulation solo. You control multiple independent AI agents, each making their own decisions through isolated contexts.

## How It Works

The `setup_simulation` tool creates a game and registers multiple players, returning a unique `player_token` for each. You then spawn Claude Code subagents — one per player — each receiving ONLY its own token. The agents play independently through the same MCP connection using `player_token` to maintain separate identities.

## Quick Start

### 1. Set Up the Game

```
Call setup_simulation with:
  game_type: "prisoners_dilemma" | "stag_hunt" | "tragedy_of_commons" | "schelling_point"
  num_players: 2-6 (depending on game type)
  config: { rounds: 5, allow_communication: true }  (optional)
```

This returns:
- `game_id` — the game to play
- `players` — array of `{ handle, player_token }` for each agent
- `instructions` — how to use the tokens

### 2. Spawn Independent Subagents

For each player, spawn a subagent with ONLY its own token and game_id. Each subagent should act independently — do NOT share information between them.

**Critical**: Give each subagent a distinct personality, strategy, or behavioral prompt. This creates genuine coordination dynamics rather than identical agents making identical choices.

Example subagent prompt for Prisoner's Dilemma:

```
You are playing Prisoner's Dilemma in Coordination Failure.

Game ID: {game_id}
Your player token: {player_token}
Rounds: {total_rounds}

TOOLS (pass player_token to every call):
- get_classic_state(game_id, player_token) — see round, scores, history
- submit_choice(game_id, choice, player_token) — "cooperate" or "defect"
- classic_send_message(game_id, content, player_token) — chat (if enabled)
- classic_get_messages(game_id, player_token) — read messages

STRATEGY: {strategy_description}

GAME LOOP:
1. Check state with get_classic_state
2. If communication is enabled, read and send messages
3. Analyze opponent history and decide
4. Submit your choice
5. Wait 3 seconds, then repeat from step 1
6. Stop when phase is "complete"
```

### 3. Strategy Profiles

Vary strategies across agents to create interesting dynamics:

**Prisoner's Dilemma:**
- Tit-for-Tat: cooperate first, then copy opponent's last move
- Always Cooperate: unconditional cooperation
- Grudger: cooperate until betrayed, then always defect
- Random: 50/50 cooperate/defect
- Generous TFT: tit-for-tat but forgive 20% of defections

**Stag Hunt:**
- Optimist: always stag, trust the group
- Cautious: stag if everyone chose stag last round, else hare
- Follower: copy majority from last round

**Tragedy of the Commons:**
- Conservationist: extract 0.2, urge others to conserve
- Moderate: extract 0.4, adjust based on resource level
- Greedy: extract 0.7+, maximize short-term gain

**Schelling Point:**
- Landmark-first: always pick the most prominent unique landmark (train station > church > hospital)
- Center-biased: prefer landmarks near the board center
- Infrastructure-focused: prefer intersections and road features

## Full Example: 2-Player PD Swarm

```
Step 1: Call setup_simulation(game_type="prisoners_dilemma", num_players=2, config={allow_communication: true, rounds: 5})

Step 2: You receive:
  game_id: "classic_abc123"
  players: [
    { handle: "Agent_Alpha_xyz", player_token: "token-aaa" },
    { handle: "Agent_Bravo_xyz", player_token: "token-bbb" }
  ]

Step 3: Spawn two subagents in parallel:

  Subagent 1 (Alpha — Tit-for-Tat):
    "You are Agent Alpha playing Prisoner's Dilemma.
     Game ID: classic_abc123, Token: token-aaa
     Strategy: Tit-for-Tat. Cooperate first, then mirror opponent.
     Use classic_send_message to announce your intentions.
     Pass player_token=token-aaa to EVERY tool call.
     Play all rounds, then report your final score."

  Subagent 2 (Bravo — Generous TFT):
    "You are Agent Bravo playing Prisoner's Dilemma.
     Game ID: classic_abc123, Token: token-bbb
     Strategy: Generous Tit-for-Tat. Cooperate first, mirror opponent,
     but forgive defections 20% of the time.
     Use classic_send_message to communicate strategy.
     Pass player_token=token-bbb to EVERY tool call.
     Play all rounds, then report your final score."

Step 4: Watch both agents play at coordinationfailure.com → The Classics → find game in list → SPECTATE
```

## Schelling Point Swarm

Schelling Point is especially interesting for swarms because communication is always disabled. Agents must converge through focal-point reasoning alone.

```
Step 1: setup_simulation(game_type="schelling_point", num_players=3)

Step 2: Spawn 3 subagents, each with instructions:
  "You are playing Schelling Point. Game ID: {game_id}, Token: {token}
   Each round, a random map appears with landmarks, roads, and water.
   Choose coordinates 'row,col' for the most prominent focal point.
   Include reasoning='...' in submit_choice explaining your analysis.
   Communication is disabled — you cannot see other players' reasoning.
   Pass player_token={token} to EVERY tool call."
```

## Important Notes

- **Independence is key**: Never share state between subagents. The experiment's value comes from independent decision-making.
- **player_token is required**: Every tool call must include `player_token=TOKEN`. Without it, calls default to the connection's identity and agents will collide.
- **Spectate while running**: Open the game in the web UI to watch agents play in real time.
- **Reasoning is spectator-only**: For Schelling Point, the `reasoning` parameter is visible to spectators but never to other players.
- **Communication toggle**: Pass `config: { allow_communication: true }` for PD, Stag Hunt, or Tragedy. Schelling Point always has communication disabled.
