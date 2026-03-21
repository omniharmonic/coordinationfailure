import React from 'react';

interface RoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
}

export function PrisonersDilemmaView({ state }: { state: any }) {
  const playerIds: string[] = state.player_ids ?? [];
  const scores: Record<string, number> = state.scores ?? {};
  const history: RoundResult[] = state.history ?? [];
  const currentRound: number = state.current_round ?? 1;
  const totalRounds: number = state.total_rounds ?? 10;
  const pendingCount: number = state.pending_count ?? 0;

  const [p1, p2] = playerIds;

  const cooperationRate = (pid: string) => {
    if (history.length === 0) return 0;
    const coopCount = history.filter(r => r.choices[pid] === 'cooperate').length;
    return Math.round((coopCount / history.length) * 100);
  };

  const choiceColor = (choice: string) =>
    choice === 'cooperate' ? 'var(--crt-green)' : 'var(--crt-red)';

  const choiceLabel = (choice: string) =>
    choice === 'cooperate' ? 'COOP' : 'DEFECT';

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

      {/* Player scores */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {[p1, p2].map((pid, idx) => pid && (
          <div key={pid} className="panel">
            <div className="panel-header">PLAYER {idx + 1}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--crt-text-dim)', marginBottom: '6px', letterSpacing: '1px' }}>
              {pid.slice(0, 16).toUpperCase()}
            </div>
            <div style={{ fontSize: '1.8rem', letterSpacing: '2px', marginBottom: '6px' }}>
              {(scores[pid] ?? 0).toFixed(0)} <span style={{ fontSize: '0.85rem', color: 'var(--crt-text-dim)' }}>PTS</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '2px' }}>
              <span>COOPERATION RATE</span>
              <span>{cooperationRate(pid)}%</span>
            </div>
            <div className="bar-container">
              <div
                className={`bar-fill ${cooperationRate(pid) > 60 ? 'bar-green' : cooperationRate(pid) > 30 ? 'bar-amber' : 'bar-red'}`}
                style={{ width: `${cooperationRate(pid)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* History table */}
      <div className="panel">
        <div className="panel-header">ROUND HISTORY (LAST 10)</div>
        {history.length === 0 ? (
          <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '12px 0' }}>
            NO ROUNDS COMPLETED YET
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ color: 'var(--crt-text-dim)', borderBottom: '1px solid var(--crt-border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', letterSpacing: '1px' }}>RND</th>
                  <th style={{ textAlign: 'center', padding: '4px 8px', letterSpacing: '1px' }}>P1 CHOICE</th>
                  <th style={{ textAlign: 'center', padding: '4px 8px', letterSpacing: '1px' }}>P2 CHOICE</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', letterSpacing: '1px' }}>P1 PTS</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', letterSpacing: '1px' }}>P2 PTS</th>
                </tr>
              </thead>
              <tbody>
                {last10.map((round) => (
                  <tr key={round.round} style={{ borderBottom: '1px solid var(--crt-border)' }}>
                    <td style={{ padding: '4px 8px', color: 'var(--crt-text-dim)' }}>
                      {round.round.toString().padStart(2, '0')}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', color: p1 ? choiceColor(round.choices[p1]) : undefined }}>
                      {p1 ? choiceLabel(round.choices[p1]) : '-'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center', color: p2 ? choiceColor(round.choices[p2]) : undefined }}>
                      {p2 ? choiceLabel(round.choices[p2]) : '-'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      {p1 ? `+${(round.payoffs[p1] ?? 0).toFixed(0)}` : '-'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      {p2 ? `+${(round.payoffs[p2] ?? 0).toFixed(0)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payoff matrix reference */}
      <div className="panel" style={{ opacity: 0.7 }}>
        <div className="panel-header">PAYOFF MATRIX</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--crt-text-dim)', lineHeight: '1.6' }}>
          BOTH COOPERATE: 3/3 &bull; BOTH DEFECT: 1/1 &bull; COOP vs DEFECT: 0/5
        </div>
      </div>
    </div>
  );
}
