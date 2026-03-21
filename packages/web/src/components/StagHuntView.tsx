import React from 'react';

interface RoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
}

export function StagHuntView({ state }: { state: any }) {
  const playerIds: string[] = state.player_ids ?? [];
  const scores: Record<string, number> = state.scores ?? {};
  const history: RoundResult[] = state.history ?? [];
  const currentRound: number = state.current_round ?? 1;
  const totalRounds: number = state.total_rounds ?? 10;
  const pendingCount: number = state.pending_count ?? 0;

  const allChoseStag = (round: RoundResult) =>
    playerIds.every(pid => round.choices[pid] === 'stag');

  const stagRate = (pid: string) => {
    if (history.length === 0) return 0;
    const count = history.filter(r => r.choices[pid] === 'stag').length;
    return Math.round((count / history.length) * 100);
  };

  const successCount = history.filter(allChoseStag).length;
  const last10 = history.slice(-10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Round indicator */}
      <div className="panel">
        <div className="panel-header">ROUND PROGRESS</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '1.2rem', letterSpacing: '2px' }}>
            ROUND {Math.min(currentRound, totalRounds)} / {totalRounds}
          </span>
          {pendingCount > 0 && state.phase === 'playing' && (
            <span className="blink" style={{ color: 'var(--crt-amber)', fontSize: '0.85rem' }}>
              AWAITING {pendingCount} CHOICE{pendingCount > 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <div className="bar-container" style={{ marginTop: '8px' }}>
          <div
            className="bar-fill bar-green"
            style={{ width: `${(Math.min(currentRound - 1, totalRounds) / totalRounds) * 100}%` }}
          />
        </div>
      </div>

      {/* Stag success indicator */}
      <div className="panel" style={{
        borderColor: history.length === 0 ? 'var(--crt-border)' :
                     successCount === history.length ? 'var(--crt-green-dim)' :
                     successCount > 0 ? 'var(--crt-amber-dim)' : 'var(--crt-red-dim)',
      }}>
        <div className="panel-header">COORDINATION STATUS</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{
              fontSize: '1.3rem',
              letterSpacing: '3px',
              color: history.length === 0 ? 'var(--crt-text-dim)' :
                     successCount === history.length ? 'var(--crt-green)' :
                     successCount > 0 ? 'var(--crt-amber)' : 'var(--crt-red)',
            }}>
              {history.length === 0 ? 'AWAITING FIRST ROUND' :
               successCount === history.length ? 'FULL COORDINATION' :
               successCount > 0 ? 'PARTIAL COORDINATION' : 'NO COORDINATION'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--crt-text-dim)', marginTop: '4px' }}>
              SUCCESSFUL STAG HUNTS: {successCount} / {history.length}
            </div>
          </div>
          {history.length > 0 && (
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: '2px solid',
              borderColor: successCount === history.length ? 'var(--crt-green)' :
                           successCount > 0 ? 'var(--crt-amber)' : 'var(--crt-red)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              color: successCount === history.length ? 'var(--crt-green)' :
                     successCount > 0 ? 'var(--crt-amber)' : 'var(--crt-red)',
            }}>
              {Math.round((successCount / history.length) * 100)}%
            </div>
          )}
        </div>
      </div>

      {/* Player scores */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(playerIds.length, 3)}, 1fr)`, gap: '12px' }}>
        {playerIds.map((pid, idx) => (
          <div key={pid} className="panel">
            <div className="panel-header">PLAYER {idx + 1}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--crt-text-dim)', marginBottom: '6px', letterSpacing: '1px' }}>
              {pid.slice(0, 16).toUpperCase()}
            </div>
            <div style={{ fontSize: '1.6rem', letterSpacing: '2px', marginBottom: '6px' }}>
              {(scores[pid] ?? 0).toFixed(0)} <span style={{ fontSize: '0.85rem', color: 'var(--crt-text-dim)' }}>PTS</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
              <span>STAG RATE</span>
              <span>{stagRate(pid)}%</span>
            </div>
            <div className="bar-container">
              <div
                className={`bar-fill ${stagRate(pid) > 60 ? 'bar-green' : stagRate(pid) > 30 ? 'bar-amber' : 'bar-red'}`}
                style={{ width: `${stagRate(pid)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* History */}
      <div className="panel">
        <div className="panel-header">ROUND HISTORY (LAST 10)</div>
        {history.length === 0 ? (
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            NO ROUNDS COMPLETED YET
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {last10.map((round) => {
              const allStag = allChoseStag(round);
              return (
                <div
                  key={round.round}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    background: allStag ? 'rgba(51, 255, 51, 0.05)' : 'transparent',
                    borderLeft: `3px solid ${allStag ? 'var(--crt-green)' : 'var(--crt-amber)'}`,
                    fontSize: '0.8rem',
                  }}
                >
                  <span style={{ color: 'var(--crt-text-dim)', minWidth: '50px' }}>
                    RND {round.round.toString().padStart(2, '0')}
                  </span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    {playerIds.map((pid) => (
                      <span
                        key={pid}
                        style={{
                          color: round.choices[pid] === 'stag' ? 'var(--crt-green)' : 'var(--crt-amber)',
                          letterSpacing: '1px',
                        }}
                      >
                        {round.choices[pid]?.toUpperCase() ?? '?'}
                      </span>
                    ))}
                  </div>
                  <span style={{
                    color: allStag ? 'var(--crt-green)' : 'var(--crt-amber)',
                    letterSpacing: '1px',
                    minWidth: '60px',
                    textAlign: 'right',
                  }}>
                    {allStag ? 'SUCCESS' : 'FAILED'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payoff reference */}
      <div className="panel" style={{ opacity: 0.7 }}>
        <div className="panel-header">PAYOFF MATRIX</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--crt-text-dim)', lineHeight: '1.6' }}>
          BOTH STAG: 4/4 &bull; BOTH HARE: 2/2 &bull; STAG vs HARE: 0/3
        </div>
      </div>
    </div>
  );
}
