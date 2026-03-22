import React, { useState, useEffect, useCallback } from 'react';
import { PrisonersDilemmaView } from '../components/PrisonersDilemmaView';
import { StagHuntView } from '../components/StagHuntView';
import { TragedyCommonsView } from '../components/TragedyCommonsView';
import { SchellingPointView } from '../components/SchellingPointView';

export function ClassicsSpectator({ gameId, gameType, onBack }: {
  gameId: string;
  gameType: string;
  onBack: () => void;
}) {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/classics/${gameId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (e: any) {
      console.error('Failed to fetch classic game state:', e);
      setError(e.message);
    }
  }, [gameId]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const isComplete = state?.phase === 'complete';

  const renderView = () => {
    if (!state) return null;
    switch (gameType) {
      case 'prisoners_dilemma':
        return <PrisonersDilemmaView state={state} />;
      case 'stag_hunt':
        return <StagHuntView state={state} />;
      case 'tragedy_of_commons':
        return <TragedyCommonsView state={state} />;
      case 'schelling_point':
        return <SchellingPointView state={state} />;
      default:
        return <div style={{ color: 'var(--crt-red)' }}>UNKNOWN GAME TYPE: {gameType}</div>;
    }
  };

  const formatType = (type: string) => type.replace(/_/g, ' ').toUpperCase();

  return (
    <div style={{ width: '100%', height: '100%', padding: '30px', overflow: 'auto', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
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
              marginBottom: '6px',
              letterSpacing: '2px',
            }}
          >
            &larr; BACK TO LOBBY
          </button>
          <h2 style={{ letterSpacing: '4px', fontSize: '1.3rem' }}>
            {formatType(gameType)}
          </h2>
        </div>
        {state && (
          <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--crt-text-dim)' }}>
            <div>GAME {gameId.slice(0, 16).toUpperCase()}</div>
            <div style={{
              color: state.phase === 'playing' ? 'var(--crt-green)' :
                     state.phase === 'complete' ? 'var(--crt-amber)' : 'var(--crt-text-dim)',
              marginTop: '2px',
            }}>
              {state.phase === 'playing' ? '● LIVE' :
               state.phase === 'complete' ? '■ COMPLETE' : '○ WAITING'}
            </div>
          </div>
        )}
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

      {!state ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px' }}>
          LOADING GAME STATE...
        </div>
      ) : (
        renderView()
      )}

      {/* Game Over Overlay */}
      {isComplete && state && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}>
          <div className="panel" style={{
            padding: '32px 48px',
            textAlign: 'center',
            border: '1px solid var(--crt-amber)',
            maxWidth: '500px',
          }}>
            <h2 style={{ letterSpacing: '6px', color: 'var(--crt-amber)', marginBottom: '20px' }}>
              GAME COMPLETE
            </h2>
            <div style={{ marginBottom: '20px' }}>
              {Object.entries(state.scores as Record<string, number>)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([playerId, score], idx) => (
                  <div key={playerId} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--crt-border)',
                    color: idx === 0 ? 'var(--crt-green)' : 'var(--crt-text-dim)',
                    fontSize: '1rem',
                  }}>
                    <span style={{ letterSpacing: '2px' }}>
                      {idx === 0 ? '>> ' : '   '}{playerId.slice(0, 12).toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 'bold' }}>{((score ?? 0) as number).toFixed(1)} PTS</span>
                  </div>
                ))}
            </div>
            <button
              onClick={onBack}
              style={{
                background: 'rgba(255, 170, 0, 0.1)',
                color: 'var(--crt-amber)',
                border: '1px solid var(--crt-amber)',
                padding: '10px 32px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9rem',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '3px',
              }}
            >
              RETURN TO LOBBY
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
