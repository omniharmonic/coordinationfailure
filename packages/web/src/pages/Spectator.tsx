import React, { useState, useEffect, useRef } from 'react';
import { CompanyCard } from '../components/CompanyCard.js';
import { GovernmentPanel } from '../components/GovernmentPanel.js';
import { EventTicker } from '../components/EventTicker.js';
import { StabilityMeter } from '../components/StabilityMeter.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { CapitalDisplay } from '../components/CapitalDisplay.js';
import { AgreementsPanel } from '../components/AgreementsPanel.js';
import { SurveillancePanel } from '../components/SurveillancePanel.js';
import { useSound } from '../hooks/useSound.js';
import { SoundToggle } from '../components/SoundToggle.js';

interface GameState {
  id: string;
  phase: string;
  companies: Record<string, any>;
  governments: Record<string, any>;
  world: {
    in_game_date: string;
    global_stability: number;
    capital_market_sentiment: number;
    public_awareness: number;
    destabilization_events: any[];
    tick_count: number;
  };
  agreements: any[];
  outcome: string | null;
  scores: Record<string, number>;
}

export function Spectator({ gameId, onBack, onReplay }: { gameId: string; onBack: () => void; onReplay?: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const gameOverRef = useRef(false);
  const [lostConnection, setLostConnection] = useState(false);

  // Sticky gameOver: once true, never revert
  const markGameOver = () => {
    if (!gameOverRef.current) {
      gameOverRef.current = true;
      setGameOver(true);
    }
  };
  const wsRef = useRef<WebSocket | null>(null);
  const wsAliveRef = useRef(false);
  const hadRunningStateRef = useRef(false);
  const lastTickRef = useRef(-1);

  // Sound integration
  const { playBeep, playAlert, playKlaxon, playKeyClick } = useSound();
  const prevEventCountRef = useRef(0);
  const prevStabilityRef = useRef(100);
  const alertPlayedRef = useRef(false);
  const klaxonPlayedRef = useRef(false);

  useEffect(() => {
    let wsInstance: WebSocket | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let lastWsMessage = 0; // timestamp of last WS message for heartbeat detection

    // Only update state if tick is moving forward (prevents WebSocket delay vs poll race)
    // Returns true if state was accepted, false if stale
    const updateState = (data: any): boolean => {
      const tick = data.world?.tick_count ?? -1;
      if (tick < lastTickRef.current) return false; // stale data — discard
      lastTickRef.current = tick;
      hadRunningStateRef.current = true;
      setState(data);
      return true;
    };

    const loadState = async () => {
      // Once game is over, stop fetching to prevent state thrashing
      if (gameOverRef.current) return;
      // Heartbeat: if no WS message in 10s during a running game, assume WS is dead
      if (wsAliveRef.current && lastWsMessage > 0 && Date.now() - lastWsMessage > 10000) {
        wsAliveRef.current = false;
      }
      // If WebSocket is delivering data, skip polling to avoid time-travel
      if (wsAliveRef.current) return;
      try {
        const res = await fetch(`/api/games/${gameId}`);
        if (!res.ok) {
          if (hadRunningStateRef.current && (res.status === 404 || res.status === 410)) {
            markGameOver();
            setLostConnection(true);
          }
          return;
        }
        const data = await res.json();
        if (data.phase === 'ended' && data.companies) {
          updateState(data);
          markGameOver();
        } else if (data.phase === 'running' && data.companies) {
          updateState(data);
        } else if (data.phase === 'lobby') {
          console.log('Game in lobby, waiting for start...');
        }
      } catch (_e) {
        if (hadRunningStateRef.current) {
          markGameOver();
          setLostConnection(true);
        }
      }
    };

    // Initial fetch
    loadState();

    // WebSocket for live updates
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsInstance = new WebSocket(`${protocol}//${window.location.host}/ws/spectate/${gameId}`);
      wsRef.current = wsInstance;

      wsInstance.onmessage = (event) => {
        if (gameOverRef.current) return;
        lastWsMessage = Date.now();
        // Only mark WS alive if the connection is actually open (prevents race with onclose)
        if (wsInstance?.readyState === WebSocket.OPEN) {
          wsAliveRef.current = true;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state' && msg.data?.companies) {
            updateState(msg.data);
            if (msg.data.phase === 'ended') {
              markGameOver();
            }
          } else if (msg.type === 'tick' && msg.data?.state?.companies) {
            const accepted = updateState(msg.data.state);
            if (accepted) {
              if (msg.data.state.phase === 'ended') {
                markGameOver();
              }
              if (msg.data.events?.length) {
                setEvents(prev => [...prev.slice(-50), ...msg.data.events]);
              }
            }
          }
        } catch (_e) { /* ignore parse errors */ }
      };

      wsInstance.onerror = () => {
        wsAliveRef.current = false; // Fall back to polling
        console.log('WebSocket error — falling back to polling');
      };

      wsInstance.onclose = () => {
        wsAliveRef.current = false; // Fall back to polling
      };
    } catch (_e) {
      console.log('WebSocket unavailable — using polling');
    }

    // Fallback polling (always active to catch lobby→running transitions)
    pollInterval = setInterval(loadState, 2000);

    return () => {
      if (wsInstance) wsInstance.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [gameId]);

  // Sound effects based on state changes
  useEffect(() => {
    if (!state) return;

    const stability = state.world.global_stability;
    const worldEventCount = state.world.destabilization_events?.length ?? 0;

    // New world event appeared — play beep
    if (worldEventCount > prevEventCountRef.current && prevEventCountRef.current > 0) {
      playBeep();
    }
    prevEventCountRef.current = worldEventCount;

    // Stability dropped below 50 — play alert (once per crossing)
    if (stability < 50 && prevStabilityRef.current >= 50) {
      alertPlayedRef.current = false;
    }
    if (stability < 50 && !alertPlayedRef.current) {
      playAlert();
      alertPlayedRef.current = true;
    }
    if (stability >= 50) {
      alertPlayedRef.current = false;
    }

    // Klaxon: game_ending event or stability below 25
    const hasGameEnding = events.some(e => e.type === 'game_ending');
    if (stability < 25 && prevStabilityRef.current >= 25) {
      klaxonPlayedRef.current = false;
    }
    if ((stability < 25 || hasGameEnding) && !klaxonPlayedRef.current) {
      playKlaxon();
      klaxonPlayedRef.current = true;
    }
    if (stability >= 25 && !hasGameEnding) {
      klaxonPlayedRef.current = false;
    }

    prevStabilityRef.current = stability;
  }, [state, events, playBeep, playAlert, playKlaxon]);

  if (!state) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>CONNECTING TO GAME {gameId.slice(0, 8).toUpperCase()}...</div>
      </div>
    );
  }

  const usCompanies = Object.values(state.companies).filter((c: any) => c.country === 'us');
  const chinaCompanies = Object.values(state.companies).filter((c: any) => c.country === 'china');
  const usGov = Object.values(state.governments).find((g: any) => g.country === 'us');
  const chinaGov = Object.values(state.governments).find((g: any) => g.country === 'china');
  const stability = state.world.global_stability;

  // Dynamic color based on stability
  const themeColor = stability > 60 ? 'green' : stability > 30 ? 'amber' : 'red';

  // CRT glitch class based on stability
  const glitchClass =
    stability <= 15 ? 'crt-glitch-high' :
    stability <= 30 ? 'crt-glitch-medium' :
    stability <= 60 ? 'crt-glitch-low' :
    '';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'grid',
      gridTemplateRows: 'auto 1fr 25%',
      gridTemplateColumns: '1fr',
      gap: '0',
      overflow: 'hidden',
      '--crt-text': `var(--crt-${themeColor})`,
      '--crt-text-dim': `var(--crt-${themeColor}-dim)`,
      '--crt-glow': `var(--crt-${themeColor}-glow)`,
    } as React.CSSProperties}>
      {/* Header */}
      <div className="spectator-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid var(--crt-border)',
        background: 'var(--crt-bg-light)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => { playKeyClick(); onBack(); }}
            style={{
              background: 'transparent',
              color: 'var(--crt-text-dim)',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            ← LOBBY
          </button>
          <span style={{ letterSpacing: '3px', fontSize: '1.1rem' }}>COORDINATION FAILURE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <span>DATE: {state.world.in_game_date}</span>
          <span>TICK: {state.world.tick_count}</span>
          <span>SENTIMENT: {(state.world.capital_market_sentiment ?? 0).toFixed(0)}%</span>
          <StabilityMeter stability={stability} />
          <SoundToggle />
        </div>
      </div>

      {/* Main game board */}
      <div className={`spectator-grid ${glitchClass}`} style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2px',
        overflow: 'auto',
        padding: '8px',
      }}>
        {/* US Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel-header" style={{ padding: '4px 12px', textAlign: 'center' }}>
            UNITED STATES
          </div>
          {usGov && <GovernmentPanel gov={usGov} />}
          <div className="company-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {usCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        </div>

        {/* China Side + Capital Markets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel-header" style={{ padding: '4px 12px', textAlign: 'center' }}>
            CHINA
          </div>
          {chinaGov && <GovernmentPanel gov={chinaGov} />}
          <div className="company-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {chinaCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
          {/* Capital Markets spans full width of right column */}
          <CapitalDisplay
            companies={state.companies}
            marketSentiment={state.world.capital_market_sentiment ?? 0}
          />
        </div>
      </div>

      {/* Bottom bar: Chat | Agreements | Event Ticker */}
      <div className="bottom-panels" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '2px',
        borderTop: '1px solid var(--crt-border)',
        overflow: 'hidden',
      }}>
        {/* Left: Chat */}
        <ChatPanel gameId={gameId} />

        {/* Center: Agreements */}
        <div className="panel" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}>
          <AgreementsPanel agreements={state.agreements ?? []} />
        </div>

        {/* Right: Event Ticker (vertical) */}
        <div className="panel" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}>
          <div className="panel-header" style={{ marginBottom: '4px' }}>
            WORLD EVENTS
          </div>
          <EventTickerVertical
            events={state.world.destabilization_events}
            gameEvents={events}
          />
        </div>
      </div>

      {/* Surveillance panel — floating overlay for backroom intel */}
      <SurveillancePanel gameId={gameId} gameState={state} />

      {/* Game over overlay */}
      {(gameOver || state.outcome) && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <h1 style={{
            fontSize: '3rem',
            letterSpacing: '8px',
            marginBottom: '20px',
            color: state.outcome === 'aligned_agi' ? 'var(--crt-green)' : 'var(--crt-red)',
            textShadow: `0 0 30px ${state.outcome === 'aligned_agi' ? 'var(--crt-green-glow)' : 'var(--crt-red-glow)'}`,
          }}>
            GAME OVER
          </h1>
          <h2 style={{
            fontSize: '1.5rem',
            letterSpacing: '4px',
            marginBottom: '30px',
            color: state.outcome === 'aligned_agi' ? 'var(--crt-green)' : 'var(--crt-red)',
          }}>
            {state.outcome === 'aligned_agi' && 'ALIGNED AGI ACHIEVED — HUMANITY WINS'}
            {state.outcome === 'misaligned_agi' && 'MISALIGNED AGI — CATASTROPHIC FAILURE'}
            {state.outcome === 'timeout' && 'TIMEOUT — NO AGI ACHIEVED'}
            {state.outcome === 'stable_world' && 'STABLE WORLD — MUTUAL SLOWDOWN'}
            {state.outcome === 'nationalization_takeover' && 'NATIONALIZATION TAKEOVER'}
            {!state.outcome && lostConnection && 'GAME ENDED — CONNECTION LOST'}
            {!state.outcome && !lostConnection && 'GAME ENDED'}
          </h2>
          {Object.entries(state.scores).length > 0 && (
            <div style={{ width: '400px' }}>
              <div className="panel-header">FINAL SCORES</div>
              {Object.entries(state.scores)
                .sort(([, a], [, b]) => b - a)
                .map(([role, score]) => (
                  <div key={role} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span>{role.toUpperCase()}</span>
                    <span>{score}</span>
                  </div>
                ))}
            </div>
          )}
          <button
            onClick={onBack}
            style={{
              marginTop: '30px',
              background: 'transparent',
              color: 'var(--crt-text)',
              border: '1px solid var(--crt-text)',
              padding: '8px 24px',
              fontFamily: 'var(--font-mono)',
              fontSize: '1rem',
              cursor: 'pointer',
              letterSpacing: '2px',
            }}
          >
            RETURN TO LOBBY
          </button>
          {onReplay && (
            <button
              onClick={onReplay}
              style={{
                marginTop: '10px',
                background: 'transparent',
                color: 'var(--crt-amber)',
                border: '1px solid var(--crt-amber)',
                padding: '8px 24px',
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem',
                cursor: 'pointer',
                letterSpacing: '2px',
              }}
            >
              VIEW REPLAY
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Vertical scrolling event ticker for the bottom-right panel */
function EventTickerVertical({ events, gameEvents }: { events: any[]; gameEvents: any[] }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const TIER_COLORS: Record<string, string> = {
    tremor: 'var(--crt-green-dim)',
    shock: 'var(--crt-amber)',
    crisis: 'var(--crt-red)',
    catastrophe: '#ff0000',
  };

  const TIER_LABELS: Record<string, string> = {
    tremor: 'TREMOR',
    shock: 'SHOCK',
    crisis: 'CRISIS',
    catastrophe: 'CATASTROPHE',
  };

  const allEvents = [
    ...events.map(e => ({ ...e, source: 'world' })),
    ...gameEvents
      .filter(e => e.type === 'game_ending' || e.type === 'generation_reached')
      .map(e => ({
        id: `ge_${e.tick}`,
        tick: e.tick,
        tier: e.type === 'game_ending' ? 'crisis' : 'shock',
        title: e.type === 'game_ending'
          ? `${e.leading_company?.toUpperCase()} APPROACHING AGI (${e.capability?.toFixed(0)})`
          : `${e.company_id?.toUpperCase()} REACHED GEN ${e.generation}`,
        description: '',
        source: 'game',
      })),
  ].sort((a, b) => a.tick - b.tick);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allEvents.length]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        fontSize: '0.75rem',
      }}
    >
      {allEvents.length === 0 ? (
        <div style={{ color: 'var(--crt-text-dim)', padding: '4px 0' }}>
          NO EVENTS YET • MONITORING...
        </div>
      ) : (
        allEvents.slice(-30).map(event => (
          <div
            key={event.id}
            style={{
              padding: '3px 0',
              borderBottom: '1px solid var(--crt-border)',
              color: TIER_COLORS[event.tier] ?? 'var(--crt-text)',
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
            }}
          >
            <span style={{
              letterSpacing: '1px',
              fontSize: '0.65rem',
              padding: '1px 4px',
              border: `1px solid ${TIER_COLORS[event.tier] ?? 'var(--crt-text-dim)'}`,
              flexShrink: 0,
            }}>
              {TIER_LABELS[event.tier] ?? event.tier?.toUpperCase()}
            </span>
            <span>{event.title}</span>
          </div>
        ))
      )}
    </div>
  );
}
