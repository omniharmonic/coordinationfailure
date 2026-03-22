import React, { useState, useEffect, useCallback, useRef } from 'react';
import { McpInstallTabs } from '../components/McpInstallTabs.js';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        background: 'transparent',
        color: copied ? 'var(--crt-green)' : 'var(--crt-text-dim)',
        border: `1px solid ${copied ? 'var(--crt-green)' : 'var(--crt-border)'}`,
        padding: '2px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        cursor: 'pointer',
        letterSpacing: '1px',
      }}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

interface ClassicGameListItem {
  game_id: string;
  type: string;
  phase: string;
  players: number;
  max_players: number;
  current_round: number;
  total_rounds: number;
}

interface ClassicLobbyDetail {
  id: string;
  type: string;
  phase: string;
  player_ids: string[];
  min_players: number;
  max_players: number;
  current_round: number;
  total_rounds: number;
  pending_count: number;
  scores: Record<string, number>;
  config?: { allow_communication?: boolean };
}

const GAME_TYPES = [
  {
    type: 'prisoners_dilemma',
    label: "PRISONER'S DILEMMA",
    description: 'Two players repeatedly choose to COOPERATE or DEFECT. Mutual cooperation pays well, but betrayal tempts with higher reward — at the other\'s expense.',
    tagline: 'TRUST VS. GREED',
  },
  {
    type: 'stag_hunt',
    label: 'STAG HUNT',
    description: 'Coordinate to hunt the STAG for maximum reward, or play it safe with HARE. One defector ruins the stag hunt for everyone.',
    tagline: 'COORDINATION VS. SAFETY',
  },
  {
    type: 'tragedy_of_commons',
    label: 'TRAGEDY OF THE COMMONS',
    description: 'Share a finite resource pool. Each player picks an extraction rate (0.0 = conserve, 1.0 = full exploit). Over-extraction depletes the commons for all.',
    tagline: 'SUSTAINABILITY VS. GREED',
  },
  {
    type: 'schelling_point',
    label: 'SCHELLING POINT',
    description: 'Players independently choose a location on a random map. No communication. Converge on natural focal points — train stations, intersections, landmarks.',
    tagline: 'CONVERGENCE WITHOUT WORDS',
  },
] as const;

const buttonStyle: React.CSSProperties = {
  background: 'rgba(51, 255, 51, 0.1)',
  color: 'var(--crt-green)',
  border: '1px solid var(--crt-green)',
  padding: '8px 20px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '2px',
};

const lobbyButtonStyle: React.CSSProperties = {
  background: 'rgba(255, 204, 0, 0.08)',
  color: 'var(--crt-amber, #ffcc00)',
  border: '1px solid var(--crt-amber, #ffcc00)',
  padding: '8px 20px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '2px',
};

export function ClassicsLobby({ onSpectate, onBack }: {
  onSpectate: (gameId: string, gameType: string) => void;
  onBack: () => void;
}) {
  const [games, setGames] = useState<ClassicGameListItem[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Waiting room state
  const [waitingGameId, setWaitingGameId] = useState<string | null>(null);
  const [waitingGameType, setWaitingGameType] = useState<string | null>(null);
  const [waitingHostToken, setWaitingHostToken] = useState<string | null>(null);
  const [lobbyDetail, setLobbyDetail] = useState<ClassicLobbyDetail | null>(null);
  const [fillingBot, setFillingBot] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch('/api/classics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGames(data);
    } catch (e: any) {
      console.error('Failed to fetch classic games:', e);
    }
  }, []);

  useEffect(() => {
    fetchGames();
    const interval = setInterval(fetchGames, 3000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  // Poll lobby detail when in waiting room
  useEffect(() => {
    if (!waitingGameId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const pollLobby = async () => {
      try {
        const res = await fetch(`/api/classics/${waitingGameId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLobbyDetail(data);

        // If game has started (second player joined, phase is now 'playing'), navigate to spectator
        if (data.phase === 'playing' || (data.player_ids && data.player_ids.length >= data.min_players)) {
          setWaitingGameId(null);
          setLobbyDetail(null);
          onSpectate(waitingGameId, waitingGameType ?? data.type);
          return;
        }
      } catch (e: any) {
        console.error('Failed to poll classic lobby:', e);
      }
    };

    pollLobby();
    pollRef.current = setInterval(pollLobby, 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [waitingGameId, waitingGameType, onSpectate]);

  const startBotLoop = (gameId: string, gameType: string, token1: string, token2: string) => {
    const tokens = [token1, token2];
    let stopped = false;

    const getBotChoice = (type: string, boardData?: any): string => {
      if (type === 'prisoners_dilemma') {
        return Math.random() < 0.6 ? 'cooperate' : 'defect';
      } else if (type === 'stag_hunt') {
        return Math.random() < 0.7 ? 'stag' : 'hare';
      } else if (type === 'tragedy_of_commons') {
        const rate = 0.2 + Math.random() * 0.4; // 0.2 to 0.6
        return rate.toFixed(2);
      } else if (type === 'schelling_point') {
        // Try to pick a landmark cell if board data is available
        if (boardData?.board_grid) {
          const landmarks: [number, number][] = [];
          const grid = boardData.board_grid;
          const landmarkTypes = ['school', 'church', 'hospital', 'library', 'train_station', 'gas_station', 'parking_garage', 'intersection'];
          for (let r = 0; r < grid.length; r++) {
            for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
              if (landmarkTypes.includes(grid[r][c])) {
                landmarks.push([r, c]);
              }
            }
          }
          if (landmarks.length > 0) {
            const [r, c] = landmarks[Math.floor(Math.random() * landmarks.length)];
            return `${r},${c}`;
          }
        }
        // Fallback: random coordinate on 8x8 board
        return `${Math.floor(Math.random() * 8)},${Math.floor(Math.random() * 8)}`;
      }
      return 'cooperate';
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const stateRes = await fetch('/mcp/tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[0]}` },
          body: JSON.stringify({ tool: 'get_classic_state', params: { game_id: gameId } }),
        });
        if (!stateRes.ok) { stopped = true; return; }
        const stateData = await stateRes.json();
        const state = stateData.result;

        if (!state || state.phase === 'complete') {
          stopped = true;
          return;
        }

        if (state.phase === 'playing') {
          for (let i = 0; i < tokens.length; i++) {
            const choice = getBotChoice(gameType, state);
            try {
              await fetch('/mcp/tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[i]}` },
                body: JSON.stringify({ tool: 'submit_choice', params: { game_id: gameId, choice } }),
              });
            } catch (_e) {
              // Ignore — may already have submitted this round
            }
          }
        }
      } catch (_e) {
        // Ignore fetch errors, retry next tick
      }
    };

    const interval = setInterval(tick, 1500);
    setTimeout(() => { stopped = true; clearInterval(interval); }, 5 * 60 * 1000);
  };

  // Option A: Quick Play (vs BOT) — existing behavior
  const quickPlay = async (gameType: string) => {
    setCreating(gameType);
    setError(null);
    try {
      // 1. Register player 1
      const reg1 = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'player_1' }),
      });
      if (!reg1.ok) throw new Error('Failed to register player 1');
      const { player_token: token1 } = await reg1.json();

      // 2. Create classic game via MCP tool
      const createRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
        body: JSON.stringify({ tool: 'join_classic', params: { game_type: gameType } }),
      });
      if (!createRes.ok) throw new Error('Failed to create classic game');
      const createData = await createRes.json();
      const gameId = createData.result?.game_id;
      if (!gameId) throw new Error('No game_id returned');

      // 3. Register player 2 (bot)
      const reg2 = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'bot_opponent' }),
      });
      if (!reg2.ok) throw new Error('Failed to register bot');
      const { player_token: token2 } = await reg2.json();

      // 4. Join player 2 into the game
      const joinRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ tool: 'join_classic', params: { game_type: gameType, game_id: gameId } }),
      });
      if (!joinRes.ok) throw new Error('Failed to join bot');

      // 5. Start bot auto-play loop
      startBotLoop(gameId, gameType, token1, token2);

      // 6. Navigate to spectator
      await fetchGames();
      onSpectate(gameId, gameType);
    } catch (e: any) {
      console.error('Quick play error:', e);
      setError(e.message);
    } finally {
      setCreating(null);
    }
  };

  // Option B: Create Lobby — create game, show waiting room
  const createLobby = async (gameType: string) => {
    setCreating(gameType);
    setError(null);
    try {
      // 1. Register host player
      const regRes = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'host' }),
      });
      if (!regRes.ok) throw new Error('Failed to register host');
      const { player_token } = await regRes.json();

      // 2. Create game via join_classic (creates when no game_id given)
      const createRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${player_token}` },
        body: JSON.stringify({ tool: 'join_classic', params: { game_type: gameType } }),
      });
      if (!createRes.ok) throw new Error('Failed to create classic game');
      const createData = await createRes.json();
      const gameId = createData.result?.game_id;
      if (!gameId) throw new Error('No game_id returned');

      // 3. Show waiting room
      setWaitingGameId(gameId);
      setWaitingGameType(gameType);
      setWaitingHostToken(player_token);
    } catch (e: any) {
      console.error('Create lobby error:', e);
      setError(e.message);
    } finally {
      setCreating(null);
    }
  };

  // Fill with bot & start (from waiting room)
  const fillWithBotAndStart = async () => {
    if (!waitingGameId || !waitingGameType || !waitingHostToken) return;
    setFillingBot(true);
    setError(null);
    try {
      // Register a bot player
      const regRes = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'bot_opponent' }),
      });
      if (!regRes.ok) throw new Error('Failed to register bot');
      const { player_token: botToken } = await regRes.json();

      // Join the bot into the game
      const joinRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
        body: JSON.stringify({ tool: 'join_classic', params: { game_type: waitingGameType, game_id: waitingGameId } }),
      });
      if (!joinRes.ok) throw new Error('Failed to join bot into game');

      // Start bot loop (host + bot)
      startBotLoop(waitingGameId, waitingGameType, waitingHostToken, botToken);

      // Navigate to spectator
      const gId = waitingGameId;
      const gType = waitingGameType;
      setWaitingGameId(null);
      setWaitingGameType(null);
      setWaitingHostToken(null);
      setLobbyDetail(null);
      await fetchGames();
      onSpectate(gId, gType);
    } catch (e: any) {
      console.error('Fill with bot error:', e);
      setError(e.message);
    } finally {
      setFillingBot(false);
    }
  };

  // Join an existing waiting game from the game list
  const joinGame = async (gameId: string, gameType: string) => {
    setError(null);
    try {
      const regRes = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'joiner' }),
      });
      if (!regRes.ok) throw new Error('Failed to register');
      const { player_token } = await regRes.json();

      const joinRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${player_token}` },
        body: JSON.stringify({ tool: 'join_classic', params: { game_type: gameType, game_id: gameId } }),
      });
      if (!joinRes.ok) throw new Error('Failed to join game');

      await fetchGames();
      onSpectate(gameId, gameType);
    } catch (e: any) {
      console.error('Join game error:', e);
      setError(e.message);
    }
  };

  const formatType = (type: string) => type.replace(/_/g, ' ').toUpperCase();

  // ─── Waiting Room View ───────────────────────────────────────────────
  if (waitingGameId && waitingGameType) {
    const shortId = waitingGameId.slice(0, 16).toUpperCase();
    const gameLabel = GAME_TYPES.find(g => g.type === waitingGameType)?.label ?? formatType(waitingGameType);
    const playerCount = lobbyDetail?.player_ids?.length ?? 1;
    const maxPlayers = lobbyDetail?.max_players ?? 2;

    return (
      <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => { setWaitingGameId(null); setWaitingGameType(null); setWaitingHostToken(null); setLobbyDetail(null); }}
            style={{
              background: 'transparent',
              color: 'var(--crt-text-dim)',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              padding: '0',
              marginBottom: '8px',
              letterSpacing: '2px',
            }}
          >
            &larr; CANCEL
          </button>
          <h2 style={{ letterSpacing: '4px' }}>WAITING ROOM</h2>
        </div>

        {error && (
          <div style={{
            color: 'var(--crt-red)',
            border: '1px solid var(--crt-red-dim)',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '0.85rem',
          }}>
            ERROR: {error}
          </div>
        )}

        <div className="panel" style={{ padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontSize: '1.1rem', letterSpacing: '3px', marginBottom: '8px' }}>
            {gameLabel}
          </div>
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>GAME ID: {shortId} &bull; {playerCount}/{maxPlayers} PLAYERS</span>
            {lobbyDetail?.config?.allow_communication && (
              <span style={{
                fontSize: '0.65rem', letterSpacing: '1px',
                color: 'var(--crt-cyan, #66ccff)',
                border: '1px solid var(--crt-cyan, #66ccff)',
                padding: '1px 6px',
              }}>
                COMMS ENABLED
              </span>
            )}
          </div>

          {/* Current players */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px', color: 'var(--crt-text-dim)' }}>
              PLAYERS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {lobbyDetail?.player_ids?.map((pid, i) => (
                <div
                  key={pid}
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '1px',
                    border: '1px solid var(--crt-green)',
                    color: 'var(--crt-green)',
                    background: 'rgba(51, 255, 51, 0.05)',
                  }}
                >
                  ● PLAYER {i + 1}
                </div>
              )) ?? (
                <div
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '1px',
                    border: '1px solid var(--crt-green)',
                    color: 'var(--crt-green)',
                    background: 'rgba(51, 255, 51, 0.05)',
                  }}
                >
                  ● PLAYER 1 (HOST)
                </div>
              )}
              {playerCount < maxPlayers && (
                <div
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '1px',
                    border: '1px solid var(--crt-border)',
                    color: 'var(--crt-amber)',
                    background: 'transparent',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                >
                  ○ WAITING FOR PLAYER...
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={fillWithBotAndStart}
              disabled={fillingBot}
              style={{
                ...buttonStyle,
                opacity: fillingBot ? 0.5 : 1,
                cursor: fillingBot ? 'wait' : 'pointer',
              }}
            >
              {fillingBot ? 'STARTING...' : 'FILL WITH BOT & START'}
            </button>
            <button
              onClick={() => { setWaitingGameId(null); setWaitingGameType(null); setWaitingHostToken(null); setLobbyDetail(null); }}
              style={{
                background: 'transparent',
                color: 'var(--crt-text-dim)',
                border: '1px solid var(--crt-border)',
                padding: '8px 20px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '2px',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>

        {/* MCP Connection Info */}
        <div className="panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '0.85rem', letterSpacing: '3px', marginBottom: '16px', color: 'var(--crt-amber)' }}>
            HOW TO CONNECT AI AGENTS
          </div>
          <McpInstallTabs
            gameId={waitingGameId}
            gameType={waitingGameType}
            showRoleSuggestion={false}
            compact
          />
        </div>
      </div>
    );
  }

  // ─── Main Lobby View ─────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              color: 'var(--crt-text-dim)',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              padding: '0',
              marginBottom: '8px',
              letterSpacing: '2px',
            }}
          >
            &larr; BACK
          </button>
          <h2 style={{ letterSpacing: '4px' }}>CLASSIC GAME THEORY</h2>
        </div>
      </div>

      {error && (
        <div style={{
          color: 'var(--crt-red)',
          border: '1px solid var(--crt-red-dim)',
          padding: '8px 12px',
          marginBottom: '16px',
          fontSize: '0.85rem',
        }}>
          ERROR: {error}
        </div>
      )}

      {/* Game type cards */}
      <div style={{ display: 'grid', gap: '16px', marginBottom: '40px' }}>
        {GAME_TYPES.map(({ type, label, description, tagline }) => (
          <div key={type} className="panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, marginRight: '20px' }}>
                <div style={{ fontSize: '1.1rem', letterSpacing: '3px', marginBottom: '4px' }}>
                  {label}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--crt-amber)', letterSpacing: '2px', marginBottom: '8px' }}>
                  {tagline}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--crt-text-dim)', lineHeight: '1.5' }}>
                  {description}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  onClick={() => quickPlay(type)}
                  disabled={creating !== null}
                  style={{
                    ...buttonStyle,
                    opacity: creating !== null ? 0.5 : 1,
                    cursor: creating !== null ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {creating === type ? 'LAUNCHING...' : 'QUICK PLAY'}
                </button>
                <button
                  onClick={() => createLobby(type)}
                  disabled={creating !== null}
                  style={{
                    ...lobbyButtonStyle,
                    opacity: creating !== null ? 0.5 : 1,
                    cursor: creating !== null ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  CREATE LOBBY
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Existing games */}
      <div style={{ marginBottom: '12px' }}>
        <div className="panel-header">ACTIVE CLASSIC GAMES</div>
      </div>

      {games.length === 0 ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '20px', fontSize: '0.85rem' }}>
          NO ACTIVE CLASSIC GAMES
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {games.map(game => (
            <div
              key={game.game_id}
              className="panel"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (game.phase === 'waiting' && game.players < game.max_players) {
                  joinGame(game.game_id, game.type);
                } else {
                  onSpectate(game.game_id, game.type);
                }
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '1rem', letterSpacing: '2px' }}>
                    {formatType(game.type)} &mdash; {game.game_id.slice(0, 16).toUpperCase()}
                  </div>
                  <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.8rem', marginTop: '4px' }}>
                    ROUND {game.current_round}/{game.total_rounds} &bull; {game.players}/{game.max_players} PLAYERS
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{
                    color: game.phase === 'playing' ? 'var(--crt-green)' :
                           game.phase === 'complete' ? 'var(--crt-text-dim)' : 'var(--crt-amber)',
                    fontSize: '0.85rem',
                    letterSpacing: '2px',
                  }}>
                    {game.phase === 'playing' ? '● LIVE' :
                     game.phase === 'complete' ? '■ DONE' : '○ WAITING'}
                  </span>
                  {game.phase === 'waiting' && game.players < game.max_players ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        joinGame(game.game_id, game.type);
                      }}
                      style={{
                        background: 'rgba(255, 204, 0, 0.08)',
                        color: 'var(--crt-amber, #ffcc00)',
                        border: '1px solid var(--crt-amber, #ffcc00)',
                        padding: '4px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      JOIN &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSpectate(game.game_id, game.type);
                      }}
                      style={{
                        background: 'transparent',
                        color: 'var(--crt-text)',
                        border: '1px solid var(--crt-text)',
                        padding: '4px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      SPECTATE &rarr;
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
