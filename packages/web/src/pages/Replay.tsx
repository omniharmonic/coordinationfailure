import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CompanyCard } from '../components/CompanyCard.js';
import { GovernmentPanel } from '../components/GovernmentPanel.js';
import { StabilityMeter } from '../components/StabilityMeter.js';
import { CapitalDisplay } from '../components/CapitalDisplay.js';
import { AgreementsPanel } from '../components/AgreementsPanel.js';

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

interface LogEntry {
  tick: number;
  state: GameState;
  events?: any[];
}

type PlaybackSpeed = 1 | 2 | 4;

export function Replay({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [staticState, setStaticState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // All messages (including private) for replay
  const [allMessages, setAllMessages] = useState<Array<{
    id: string; channel_id: string; from: string; content: string;
    timestamp: number; channel_name: string; channel_type: string;
  }>>([]);

  // Playback state
  const [currentTick, setCurrentTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch log or fall back to final state
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      // Try the log endpoint first
      try {
        const logRes = await fetch(`/api/games/${gameId}/log`);
        if (logRes.ok) {
          const data = await logRes.json();
          if (!cancelled && Array.isArray(data) && data.length > 0) {
            // Sort by tick
            data.sort((a: LogEntry, b: LogEntry) => a.tick - b.tick);
            setLog(data);
            setCurrentTick(0);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Fall through to static state
      }

      // Fall back to final game state
      try {
        const stateRes = await fetch(`/api/games/${gameId}`);
        if (!cancelled && stateRes.ok) {
          const data = await stateRes.json();
          setStaticState(data);
          setLoading(false);
          return;
        }
      } catch {
        // ignore
      }

      if (!cancelled) {
        setError('GAME DATA UNAVAILABLE');
        setLoading(false);
      }
    };

    fetchData();

    // Also fetch all messages (including private)
    fetch(`/api/games/${gameId}/messages/all`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) setAllMessages(Array.isArray(data) ? data : []); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [gameId]);

  // Playback timer
  useEffect(() => {
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }

    if (playing && log) {
      const interval = Math.max(50, 500 / speed);
      playRef.current = setInterval(() => {
        setCurrentTick(prev => {
          const next = prev + 1;
          if (next >= log.length - 1) {
            setPlaying(false);
            return log.length - 1;
          }
          return next;
        });
      }, interval);
    }

    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, speed, log]);

  const maxTick = log ? log.length - 1 : 0;

  const stepForward = useCallback(() => {
    setCurrentTick(prev => Math.min(prev + 1, maxTick));
  }, [maxTick]);

  const stepBack = useCallback(() => {
    setCurrentTick(prev => Math.max(prev - 1, 0));
  }, []);

  const togglePlay = useCallback(() => {
    if (!log) return;
    // If at end, restart
    setCurrentTick(prev => {
      if (prev >= maxTick) return 0;
      return prev;
    });
    setPlaying(p => !p);
  }, [log, maxTick]);

  const cycleSpeed = useCallback(() => {
    setSpeed(s => {
      if (s === 1) return 2;
      if (s === 2) return 4;
      return 1;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); stepForward(); }
      if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); stepBack(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, stepForward, stepBack]);

  // --- RENDER ---

  if (loading) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>LOADING REPLAY FOR {gameId.slice(0, 8).toUpperCase()}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <div style={{ color: 'var(--crt-red)' }}>{error}</div>
        <button onClick={onBack} style={backBtnStyle}>RETURN TO LOBBY</button>
      </div>
    );
  }

  // Static summary if no log available
  if (!log && staticState) {
    return <StaticSummary state={staticState} onBack={onBack} />;
  }

  if (!log) return null;

  const entry = log[currentTick];
  const state = entry.state;
  const stability = state.world.global_stability;
  const themeColor = stability > 60 ? 'green' : stability > 30 ? 'amber' : 'red';

  const usCompanies = Object.values(state.companies).filter((c: any) => c.country === 'us');
  const chinaCompanies = Object.values(state.companies).filter((c: any) => c.country === 'china');
  const usGov = Object.values(state.governments).find((g: any) => g.country === 'us');
  const chinaGov = Object.values(state.governments).find((g: any) => g.country === 'china');

  // Gather events up to current tick
  const eventsUpToCurrent = log
    .slice(0, currentTick + 1)
    .flatMap(e => e.events ?? []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr auto',
      gridTemplateColumns: '1fr',
      gap: '0',
      overflow: 'hidden',
      '--crt-text': `var(--crt-${themeColor})`,
      '--crt-text-dim': `var(--crt-${themeColor}-dim)`,
      '--crt-glow': `var(--crt-${themeColor}-glow)`,
    } as React.CSSProperties}>

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid var(--crt-border)',
        background: 'var(--crt-bg-light)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onBack} style={backBtnStyle}>
            &larr; LOBBY
          </button>
          <span style={{ letterSpacing: '3px', fontSize: '1.1rem' }}>REPLAY</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '0.85rem' }}>
          <span>DATE: {state.world.in_game_date}</span>
          <span>TICK: {entry.tick}</span>
          <span>SENTIMENT: {(state.world.capital_market_sentiment ?? 0).toFixed(0)}%</span>
          <StabilityMeter stability={stability} />
        </div>
      </div>

      {/* Timeline & Playback Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 16px',
        borderBottom: '1px solid var(--crt-border)',
        background: 'var(--crt-bg-light)',
        fontSize: '0.8rem',
      }}>
        {/* Step back */}
        <button onClick={stepBack} style={controlBtnStyle} title="Step back (J / Left)">
          &laquo;
        </button>

        {/* Play/Pause */}
        <button onClick={togglePlay} style={controlBtnStyle} title="Play/Pause (Space / K)">
          {playing ? '||' : '\u25B6'}
        </button>

        {/* Step forward */}
        <button onClick={stepForward} style={controlBtnStyle} title="Step forward (L / Right)">
          &raquo;
        </button>

        {/* Speed */}
        <button onClick={cycleSpeed} style={controlBtnStyle} title="Change speed">
          {speed}X
        </button>

        {/* Timeline slider */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', minWidth: '20px' }}>0</span>
          <input
            type="range"
            min={0}
            max={maxTick}
            value={currentTick}
            onChange={e => {
              setPlaying(false);
              setCurrentTick(Number(e.target.value));
            }}
            style={{
              flex: 1,
              accentColor: 'var(--crt-green)',
              cursor: 'pointer',
            }}
          />
          <span style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', minWidth: '20px' }}>{maxTick}</span>
        </div>

        <span style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', letterSpacing: '1px' }}>
          TICK {currentTick} / {maxTick}
        </span>
      </div>

      {/* Main game board — mirrors Spectator layout */}
      <div style={{
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {usCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        </div>

        {/* China Side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel-header" style={{ padding: '4px 12px', textAlign: 'center' }}>
            CHINA
          </div>
          {chinaGov && <GovernmentPanel gov={chinaGov} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {chinaCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar: Private Reveal | Capital + Agreements | Events at this tick */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '2px',
        borderTop: '1px solid var(--crt-border)',
        overflow: 'hidden',
        minHeight: '120px',
        maxHeight: '25%',
      }}>
        {/* Left: Private Comms reveal */}
        <div className="panel" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}>
          <div className="panel-header" style={{ marginBottom: '4px' }}>
            PRIVATE COMMS
          </div>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            fontSize: '0.75rem',
            padding: '4px',
          }}>
            {allMessages.length === 0 ? (
              <div style={{ color: 'var(--crt-text-dim)', padding: '8px', textAlign: 'center', lineHeight: 1.5 }}>
                NO COMMUNICATIONS RECORDED
              </div>
            ) : (
              allMessages.slice(-50).map((msg) => {
                const channelColor = CHANNEL_TYPE_COLORS[msg.channel_type] ?? 'var(--crt-text-dim)';
                return (
                  <div
                    key={msg.id}
                    style={{
                      padding: '2px 0',
                      borderBottom: '1px solid var(--crt-border)',
                    }}
                  >
                    <span style={{ color: channelColor, fontSize: '0.65rem', letterSpacing: '1px' }}>
                      [{msg.channel_type === 'public' ? 'PUB' : msg.channel_type === 'country' ? 'CTY' : msg.channel_type === 'dm' ? 'DM' : 'GRP'}]
                    </span>{' '}
                    <span style={{ color: 'var(--crt-green)', fontWeight: 'bold' }}>
                      {msg.from.toUpperCase()}
                    </span>
                    : {msg.content}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Capital Display + Agreements stacked */}
        <div style={{
          display: 'grid',
          gridTemplateRows: '1fr 1fr',
          gap: '2px',
          overflow: 'hidden',
        }}>
          <CapitalDisplay
            companies={state.companies}
            marketSentiment={state.world.capital_market_sentiment ?? 0}
          />
          <AgreementsPanel agreements={state.agreements ?? []} />
        </div>

        {/* Right: Events */}
        <div className="panel" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}>
          <div className="panel-header" style={{ marginBottom: '4px' }}>
            EVENTS (UP TO TICK {entry.tick})
          </div>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            fontSize: '0.75rem',
          }}>
            {state.world.destabilization_events.length === 0 && eventsUpToCurrent.length === 0 ? (
              <div style={{ color: 'var(--crt-text-dim)', padding: '4px 0' }}>
                NO EVENTS AT THIS POINT
              </div>
            ) : (
              [...state.world.destabilization_events, ...eventsUpToCurrent]
                .slice(-20)
                .map((event: any, i: number) => (
                  <div
                    key={event.id ?? `evt_${i}`}
                    style={{
                      padding: '2px 0',
                      borderBottom: '1px solid var(--crt-border)',
                      color: TIER_COLORS[event.tier] ?? 'var(--crt-text)',
                    }}
                  >
                    <span style={{ letterSpacing: '1px' }}>
                      [{(event.tier ?? event.type ?? 'INFO').toUpperCase()}]
                    </span>{' '}
                    {event.title ?? event.description ?? ''}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Game over overlay for final tick */}
      {state.outcome && currentTick === maxTick && (
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
            {state.outcome === 'aligned_agi' && 'ALIGNED AGI ACHIEVED'}
            {state.outcome === 'misaligned_agi' && 'MISALIGNED AGI — CATASTROPHIC FAILURE'}
            {state.outcome === 'timeout' && 'TIMEOUT — NO AGI ACHIEVED'}
            {state.outcome === 'stable_world' && 'STABLE WORLD — MUTUAL SLOWDOWN'}
            {state.outcome === 'nationalization_takeover' && 'NATIONALIZATION TAKEOVER'}
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
          <button onClick={onBack} style={{
            marginTop: '30px',
            background: 'transparent',
            color: 'var(--crt-text)',
            border: '1px solid var(--crt-text)',
            padding: '8px 24px',
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            cursor: 'pointer',
            letterSpacing: '2px',
          }}>
            RETURN TO LOBBY
          </button>
        </div>
      )}
    </div>
  );
}

/** Static summary when no log is available — shows final game state */
function StaticSummary({ state, onBack }: { state: GameState; onBack: () => void }) {
  const stability = state.world?.global_stability ?? 0;
  const themeColor = stability > 60 ? 'green' : stability > 30 ? 'amber' : 'red';

  const usCompanies = Object.values(state.companies ?? {}).filter((c: any) => c.country === 'us');
  const chinaCompanies = Object.values(state.companies ?? {}).filter((c: any) => c.country === 'china');
  const usGov = Object.values(state.governments ?? {}).find((g: any) => g.country === 'us');
  const chinaGov = Object.values(state.governments ?? {}).find((g: any) => g.country === 'china');

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      gridTemplateColumns: '1fr',
      gap: '0',
      overflow: 'hidden',
      '--crt-text': `var(--crt-${themeColor})`,
      '--crt-text-dim': `var(--crt-${themeColor}-dim)`,
      '--crt-glow': `var(--crt-${themeColor}-glow)`,
    } as React.CSSProperties}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid var(--crt-border)',
        background: 'var(--crt-bg-light)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onBack} style={backBtnStyle}>
            &larr; LOBBY
          </button>
          <span style={{ letterSpacing: '3px', fontSize: '1.1rem' }}>REPLAY — FINAL STATE</span>
          <span style={{
            fontSize: '0.7rem',
            color: 'var(--crt-amber)',
            letterSpacing: '1px',
          }}>
            (TICK LOG UNAVAILABLE)
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '0.85rem' }}>
          {state.world && (
            <>
              <span>DATE: {state.world.in_game_date}</span>
              <span>TICK: {state.world.tick_count}</span>
              <StabilityMeter stability={stability} />
            </>
          )}
        </div>
      </div>

      {/* Game board — same as Spectator */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2px',
        overflow: 'auto',
        padding: '8px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel-header" style={{ padding: '4px 12px', textAlign: 'center' }}>
            UNITED STATES
          </div>
          {usGov && <GovernmentPanel gov={usGov} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {usCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="panel-header" style={{ padding: '4px 12px', textAlign: 'center' }}>
            CHINA
          </div>
          {chinaGov && <GovernmentPanel gov={chinaGov} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {chinaCompanies.map((c: any) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </div>
        </div>
      </div>

      {/* Outcome overlay */}
      {state.outcome && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '16px',
          background: 'var(--crt-bg-light)',
          borderTop: '1px solid var(--crt-border)',
          textAlign: 'center',
          zIndex: 100,
        }}>
          <span style={{
            fontSize: '1.2rem',
            letterSpacing: '4px',
            color: state.outcome === 'aligned_agi' ? 'var(--crt-green)' : 'var(--crt-red)',
          }}>
            OUTCOME: {state.outcome.toUpperCase().replace(/_/g, ' ')}
          </span>
        </div>
      )}
    </div>
  );
}

const CHANNEL_TYPE_COLORS: Record<string, string> = {
  public: 'var(--crt-green-dim)',
  country: 'var(--crt-amber)',
  dm: 'var(--crt-red)',
  group: '#aa88ff',
};

const TIER_COLORS: Record<string, string> = {
  tremor: 'var(--crt-green-dim)',
  shock: 'var(--crt-amber)',
  crisis: 'var(--crt-red)',
  catastrophe: '#ff0000',
};

const backBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--crt-text-dim)',
  border: 'none',
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const controlBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--crt-green)',
  border: '1px solid var(--crt-border)',
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  padding: '2px 10px',
  minWidth: '32px',
  letterSpacing: '1px',
};
