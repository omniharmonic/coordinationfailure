import React from 'react';

interface RoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
  resource_after?: number;
}

export function TragedyCommonsView({ state }: { state: any }) {
  const playerIds: string[] = state.player_ids ?? [];
  const scores: Record<string, number> = state.scores ?? {};
  const history: RoundResult[] = state.history ?? [];
  const currentRound: number = state.current_round ?? 1;
  const totalRounds: number = state.total_rounds ?? 10;
  const pendingCount: number = state.pending_count ?? 0;

  // Use server-provided resource_level if available, otherwise compute from history
  const computeResourceLevels = (): number[] => {
    const levels: number[] = [100]; // initial resource
    for (const round of history) {
      if (round.resource_after !== undefined) {
        levels.push(Math.round(round.resource_after));
      } else {
        // Fallback: estimate from extraction rates using logistic model
        const prev = levels[levels.length - 1];
        const n = playerIds.length || 1;
        let totalExtraction = 0;
        for (const pid of playerIds) {
          const rate = parseFloat(round.choices[pid] ?? '0');
          totalExtraction += (isNaN(rate) ? 0 : rate) * prev / n;
        }
        const growth = 0.3 * prev * (1 - prev / 100);
        const next = Math.max(0, Math.round(prev + growth - totalExtraction));
        levels.push(next);
      }
    }
    return levels;
  };

  const resourceLevels = computeResourceLevels();

  // Prefer server resource_level for current display
  const currentResource: number = state.resource_level !== undefined
    ? Math.round(state.resource_level)
    : resourceLevels[resourceLevels.length - 1];

  const resourceColor = currentResource > 60 ? 'var(--crt-green)' :
                         currentResource > 30 ? 'var(--crt-amber)' : 'var(--crt-red)';
  const resourceBarClass = currentResource > 60 ? 'bar-green' :
                           currentResource > 30 ? 'bar-amber' : 'bar-red';

  const avgExtractionRate = (pid: string) => {
    if (history.length === 0) return 0;
    const total = history.reduce((sum, r) => {
      const rate = parseFloat(r.choices[pid] ?? '0');
      return sum + (isNaN(rate) ? 0 : rate);
    }, 0);
    return Math.round((total / history.length) * 100);
  };

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
          {state.ended_by_depletion && (
            <span style={{ color: 'var(--crt-red)', fontSize: '0.85rem', letterSpacing: '2px' }}>
              RESOURCE DEPLETED
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

      {/* Resource level - main display */}
      <div className="panel" style={{ borderColor: resourceColor === 'var(--crt-green)' ? 'var(--crt-green-dim)' :
                                                     resourceColor === 'var(--crt-amber)' ? 'var(--crt-amber-dim)' : 'var(--crt-red-dim)' }}>
        <div className="panel-header">SHARED RESOURCE POOL</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '2rem', letterSpacing: '3px', color: resourceColor }}>
            {currentResource}%
          </span>
          <span style={{
            fontSize: '0.85rem',
            letterSpacing: '2px',
            color: resourceColor,
          }}>
            {currentResource > 60 ? 'HEALTHY' :
             currentResource > 30 ? 'STRAINED' : 'CRITICAL'}
          </span>
        </div>
        <div className="bar-container" style={{ height: '24px' }}>
          <div
            className={`bar-fill ${resourceBarClass}`}
            style={{ width: `${currentResource}%` }}
          />
        </div>
      </div>

      {/* Resource history chart (ASCII-style bar chart) */}
      <div className="panel">
        <div className="panel-header">RESOURCE LEVEL HISTORY</div>
        {resourceLevels.length <= 1 ? (
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            NO ROUNDS COMPLETED YET
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '80px', padding: '4px 0' }}>
            {resourceLevels.map((level, idx) => {
              const color = level > 60 ? 'var(--crt-green)' :
                            level > 30 ? 'var(--crt-amber)' : 'var(--crt-red)';
              return (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    height: `${level}%`,
                    background: color,
                    opacity: 0.7,
                    minWidth: '4px',
                    transition: 'height 0.3s ease',
                  }}
                  title={`Round ${idx}: ${level}%`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Player extraction rates & scores */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(playerIds.length, 3)}, 1fr)`, gap: '12px' }}>
        {playerIds.map((pid, idx) => {
          const avgRate = avgExtractionRate(pid);
          return (
            <div key={pid} className="panel">
              <div className="panel-header">PLAYER {idx + 1}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--crt-text-dim)', marginBottom: '6px', letterSpacing: '1px' }}>
                {pid.slice(0, 16).toUpperCase()}
              </div>
              <div style={{ fontSize: '1.6rem', letterSpacing: '2px', marginBottom: '8px' }}>
                {(scores[pid] ?? 0).toFixed(1)} <span style={{ fontSize: '0.85rem', color: 'var(--crt-text-dim)' }}>PTS</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
                <span>AVG EXTRACTION</span>
                <span style={{ color: avgRate > 60 ? 'var(--crt-red)' : avgRate > 30 ? 'var(--crt-amber)' : 'var(--crt-green)' }}>
                  {avgRate}%
                </span>
              </div>
              <div className="bar-container">
                <div
                  className={`bar-fill ${avgRate > 60 ? 'bar-red' : avgRate > 30 ? 'bar-amber' : 'bar-green'}`}
                  style={{ width: `${avgRate}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Round-by-round detail */}
      <div className="panel">
        <div className="panel-header">ROUND HISTORY (LAST 10)</div>
        {history.length === 0 ? (
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            NO ROUNDS COMPLETED YET
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {history.slice(-10).map((round, idx) => {
              const resAfter = round.resource_after !== undefined
                ? Math.round(round.resource_after)
                : (resourceLevels[round.round] ?? '?');
              return (
                <div
                  key={round.round}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '5px 8px',
                    borderLeft: `3px solid var(--crt-amber)`,
                    fontSize: '0.8rem',
                  }}
                >
                  <span style={{ color: 'var(--crt-text-dim)', minWidth: '50px' }}>
                    RND {round.round.toString().padStart(2, '0')}
                  </span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {playerIds.map((pid) => {
                      const rate = parseFloat(round.choices[pid] ?? '0');
                      const rateColor = rate > 0.6 ? 'var(--crt-red)' : rate > 0.3 ? 'var(--crt-amber)' : 'var(--crt-green)';
                      return (
                        <span
                          key={pid}
                          style={{
                            color: rateColor,
                            letterSpacing: '1px',
                            fontSize: '0.75rem',
                          }}
                        >
                          {isNaN(rate) ? '?' : rate.toFixed(2)}
                        </span>
                      );
                    })}
                  </div>
                  <span style={{ color: 'var(--crt-text-dim)', fontSize: '0.75rem', minWidth: '80px', textAlign: 'right' }}>
                    RES: {resAfter}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="panel" style={{ opacity: 0.7 }}>
        <div className="panel-header">GAME RULES</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--crt-text-dim)', lineHeight: '1.6' }}>
          EXTRACTION RATE 0.0 (CONSERVE) TO 1.0 (FULL EXPLOIT) &bull;
          PAYOFF = RATE &times; RESOURCE / PLAYERS &bull;
          RESOURCE REGENERATES VIA LOGISTIC GROWTH (RATE 0.3, CAPACITY 100) &bull;
          GAME ENDS IF RESOURCE HITS 0
        </div>
      </div>
    </div>
  );
}
