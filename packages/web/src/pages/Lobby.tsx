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

interface GameListItem {
  game_id: string;
  phase: string;
  time_speed: string;
  players: number;
  max_players: number;
  available_roles: string[];
}

interface LobbyDetail {
  phase: string;
  game_id: string;
  time_speed: string;
  players: number;
  max_players: number;
  claimed_roles: string[];
  available_roles: string[];
}

const ALL_ROLES = ['openbrain', 'prometheus', 'nexus', 'titan', 'deepcent', 'qianneng', 'us_gov', 'china_gov'];

export function Lobby({ onSpectate, onBack }: { onSpectate: (gameId: string) => void; onBack?: () => void }) {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [speed, setSpeed] = useState('sprint');
  const [error, setError] = useState<string | null>(null);

  // Waiting room state
  const [waitingGameId, setWaitingGameId] = useState<string | null>(null);
  const [lobbyDetail, setLobbyDetail] = useState<LobbyDetail | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch('/api/games');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGames(data);
    } catch (e: any) {
      console.error('Failed to fetch games:', e);
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
        const res = await fetch(`/api/games/${waitingGameId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.phase === 'running') {
          // Game started (maybe by someone else) -- go spectate
          setWaitingGameId(null);
          setLobbyDetail(null);
          onSpectate(waitingGameId);
          return;
        }
        setLobbyDetail(data);
      } catch (e: any) {
        console.error('Failed to poll lobby:', e);
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
  }, [waitingGameId, onSpectate]);

  // Quick Start: create + fill + start + navigate (existing behaviour)
  const createAndStartGame = async () => {
    setCreating(true);
    setError(null);
    try {
      const regRes = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'host' }),
      });
      if (!regRes.ok) throw new Error('Failed to register');
      const { player_token } = await regRes.json();

      const createRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${player_token}` },
        body: JSON.stringify({ tool: 'create_game', params: { config: { time_speed: speed } } }),
      });
      if (!createRes.ok) throw new Error('Failed to create game');
      const createData = await createRes.json();
      const gameId = createData.result?.game_id;
      if (!gameId) throw new Error('No game_id returned');

      const startRes = await fetch(`/api/games/${gameId}/start-with-bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fill_all: true }),
      });
      if (!startRes.ok) {
        const errData = await startRes.json();
        throw new Error(errData.error ?? 'Failed to start game');
      }

      await fetchGames();
      onSpectate(gameId);
    } catch (e: any) {
      console.error('Create game error:', e);
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // Create Lobby: create game only, then show waiting room
  const createLobby = async () => {
    setCreating(true);
    setError(null);
    try {
      const regRes = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'host' }),
      });
      if (!regRes.ok) throw new Error('Failed to register');
      const { player_token } = await regRes.json();

      const createRes = await fetch('/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${player_token}` },
        body: JSON.stringify({ tool: 'create_game', params: { config: { time_speed: speed } } }),
      });
      if (!createRes.ok) throw new Error('Failed to create game');
      const createData = await createRes.json();
      const gameId = createData.result?.game_id;
      if (!gameId) throw new Error('No game_id returned');

      setWaitingGameId(gameId);
    } catch (e: any) {
      console.error('Create lobby error:', e);
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const fillAndStart = async (gameId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/start-with-bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fill_all: true }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? 'Failed to start');
      }
      setWaitingGameId(null);
      setLobbyDetail(null);
      await fetchGames();
      onSpectate(gameId);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startWithBots = async (gameId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/start-with-bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fill_all: true }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? 'Failed to start');
      }
      await fetchGames();
      onSpectate(gameId);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // ─── Waiting Room View ───────────────────────────────────────────────
  if (waitingGameId) {
    const detail = lobbyDetail;
    const shortId = waitingGameId.slice(0, 8).toUpperCase();

    return (
      <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => { setWaitingGameId(null); setLobbyDetail(null); }}
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
            GAME {shortId}
          </div>
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', marginBottom: '16px' }}>
            SPEED: {detail?.time_speed?.toUpperCase() ?? '...'} &bull; {detail?.players ?? 0}/{detail?.max_players ?? 8} PLAYERS
          </div>

          {/* Role slots */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px', color: 'var(--crt-text-dim)' }}>
              ROLE SLOTS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {ALL_ROLES.map(role => {
                const claimed = detail?.claimed_roles?.includes(role);
                return (
                  <div
                    key={role}
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '1px',
                      border: `1px solid ${claimed ? 'var(--crt-green)' : 'var(--crt-border)'}`,
                      color: claimed ? 'var(--crt-green)' : 'var(--crt-text-dim)',
                      background: claimed ? 'rgba(51, 255, 51, 0.05)' : 'transparent',
                    }}
                  >
                    {claimed ? '●' : '○'} {role.toUpperCase()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => fillAndStart(waitingGameId)}
              style={{
                background: 'rgba(51, 255, 51, 0.1)',
                color: 'var(--crt-green)',
                border: '1px solid var(--crt-green)',
                padding: '8px 20px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '2px',
              }}
            >
              FILL WITH BOTS &amp; START
            </button>
            <button
              onClick={() => { setWaitingGameId(null); setLobbyDetail(null); }}
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
            availableRoles={detail?.available_roles}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'transparent',
                color: 'var(--crt-text-dim)',
                border: 'none',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              ← BACK
            </button>
          )}
          <h2 style={{ letterSpacing: '4px' }}>GAME LOBBY</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={speed}
            onChange={e => setSpeed(e.target.value)}
            style={{
              background: 'var(--crt-bg)',
              color: 'var(--crt-text)',
              border: '1px solid var(--crt-border)',
              padding: '6px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
            }}
          >
            <option value="sprint">SPRINT (10 MIN)</option>
            <option value="standard">STANDARD (30 MIN)</option>
            <option value="extended">EXTENDED (60 MIN)</option>
            <option value="marathon">MARATHON (200 MIN)</option>
          </select>
          <button
            onClick={createAndStartGame}
            disabled={creating}
            style={{
              background: creating ? 'transparent' : 'rgba(51, 255, 51, 0.1)',
              color: 'var(--crt-text)',
              border: '1px solid var(--crt-text)',
              padding: '8px 24px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              cursor: creating ? 'wait' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            {creating ? 'LAUNCHING...' : '\u25B6 QUICK START (8 BOTS)'}
          </button>
          <button
            onClick={createLobby}
            disabled={creating}
            style={{
              background: creating ? 'transparent' : 'rgba(255, 204, 0, 0.08)',
              color: 'var(--crt-amber, #ffcc00)',
              border: '1px solid var(--crt-amber, #ffcc00)',
              padding: '8px 24px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              cursor: creating ? 'wait' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            {creating ? 'CREATING...' : '+ CREATE LOBBY'}
          </button>
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

      {games.length === 0 ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
          <div>NO ACTIVE GAMES</div>
          <div style={{ fontSize: '0.85rem' }}>CLICK "QUICK START" TO LAUNCH A SIMULATION WITH AI BOTS</div>
          <div style={{ fontSize: '0.85rem' }}>OR "CREATE LOBBY" TO WAIT FOR MCP AGENTS TO JOIN</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {games.map(game => (
            <div
              key={game.game_id}
              className="panel"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (game.phase === 'running') {
                  onSpectate(game.game_id);
                } else {
                  // For lobby-state games, open the waiting room
                  setWaitingGameId(game.game_id);
                }
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '1.1rem', letterSpacing: '2px' }}>
                    GAME {game.game_id.slice(0, 8).toUpperCase()}
                  </div>
                  <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', marginTop: '4px' }}>
                    {String(game.time_speed ?? 'unknown').toUpperCase()} &bull; {game.players}/{game.max_players} PLAYERS
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{
                    color: game.phase === 'running' ? 'var(--crt-green)' : 'var(--crt-amber)',
                    fontSize: '0.9rem',
                    letterSpacing: '2px',
                  }}>
                    {game.phase === 'running' ? '\u25CF LIVE' : '\u25CB LOBBY'}
                  </span>
                  {game.phase === 'running' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSpectate(game.game_id);
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
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWaitingGameId(game.game_id);
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
                  )}
                </div>
              </div>
              {game.phase === 'lobby' && game.available_roles.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--crt-text-dim)' }}>
                  AVAILABLE: {game.available_roles.join(', ').toUpperCase()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
