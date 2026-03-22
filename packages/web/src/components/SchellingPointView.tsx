import React from 'react';

type CellType =
  | 'road' | 'bridge' | 'water' | 'school' | 'church' | 'gas_station'
  | 'parking_garage' | 'train_station' | 'park' | 'hospital' | 'library'
  | 'intersection' | 'empty';

interface RoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
  board?: { width: number; height: number; cells: CellType[][] };
}

const CELL_STYLES: Record<CellType, { bg: string; fg: string; char: string }> = {
  empty:          { bg: 'rgba(255,255,255,0.03)', fg: 'var(--crt-text-dim)',  char: '·' },
  road:           { bg: 'rgba(128,128,128,0.2)',  fg: 'var(--crt-text-dim)',  char: '─' },
  intersection:   { bg: 'rgba(128,128,128,0.35)', fg: 'var(--crt-text)',      char: '╋' },
  bridge:         { bg: 'rgba(100,149,237,0.2)',   fg: 'var(--crt-cyan, #66ccff)', char: '═' },
  water:          { bg: 'rgba(30,100,200,0.25)',   fg: 'var(--crt-cyan, #4499ff)', char: '~' },
  park:           { bg: 'rgba(51,255,51,0.12)',    fg: 'var(--crt-green)',     char: '♣' },
  school:         { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'S' },
  church:         { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'C' },
  hospital:       { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'H' },
  library:        { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'L' },
  train_station:  { bg: 'rgba(255,170,0,0.2)',     fg: 'var(--crt-amber)',     char: 'T' },
  gas_station:    { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'G' },
  parking_garage: { bg: 'rgba(255,170,0,0.15)',    fg: 'var(--crt-amber)',     char: 'P' },
};

const PLAYER_COLORS = [
  '#33ff33', '#ff6633', '#6699ff', '#ffcc00', '#ff33ff', '#33ffcc',
];

export function SchellingPointView({ state }: { state: any }) {
  const playerIds: string[] = state.player_ids ?? [];
  const scores: Record<string, number> = state.scores ?? {};
  const history: RoundResult[] = state.history ?? [];
  const currentRound: number = state.current_round ?? 1;
  const totalRounds: number = state.total_rounds ?? 5;
  const pendingCount: number = state.pending_count ?? 0;
  const boardGrid: CellType[][] | undefined = state.current_board?.cells;

  // Get the latest resolved round's choices for overlay
  const lastRound = history.length > 0 ? history[history.length - 1] : null;

  // Parse choices into coordinates
  const parseCoord = (choice: string): [number, number] | null => {
    const parts = choice.split(',');
    if (parts.length !== 2) return null;
    const r = parseInt(parts[0], 10);
    const c = parseInt(parts[1], 10);
    if (isNaN(r) || isNaN(c)) return null;
    return [r, c];
  };

  // Build player positions from last resolved round
  const playerPositions: Map<string, [number, number]> = new Map();
  if (lastRound && pendingCount === 0) {
    for (const [pid, choice] of Object.entries(lastRound.choices)) {
      const coord = parseCoord(choice);
      if (coord) playerPositions.set(pid, coord);
    }
  }

  // Group players by cell for stacking
  const cellPlayers: Map<string, string[]> = new Map();
  for (const [pid, [r, c]] of playerPositions) {
    const key = `${r},${c}`;
    if (!cellPlayers.has(key)) cellPlayers.set(key, []);
    cellPlayers.get(key)!.push(pid);
  }

  const renderBoard = (grid: CellType[][]) => {
    const height = grid.length;
    const width = grid[0]?.length ?? 0;

    return (
      <div style={{ display: 'inline-block' }}>
        {/* Column labels */}
        <div style={{ display: 'flex', marginLeft: '24px' }}>
          {Array.from({ length: width }, (_, c) => (
            <div key={c} style={{
              width: '36px', textAlign: 'center',
              fontSize: '0.7rem', color: 'var(--crt-text-dim)', letterSpacing: '1px',
            }}>
              {c}
            </div>
          ))}
        </div>

        {grid.map((row, r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Row label */}
            <div style={{
              width: '24px', textAlign: 'right', paddingRight: '4px',
              fontSize: '0.7rem', color: 'var(--crt-text-dim)',
            }}>
              {r}
            </div>

            {row.map((cell, c) => {
              const style = CELL_STYLES[cell] ?? CELL_STYLES.empty;
              const key = `${r},${c}`;
              const players = cellPlayers.get(key) ?? [];

              return (
                <div
                  key={c}
                  style={{
                    width: '36px',
                    height: '36px',
                    background: style.bg,
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    color: style.fg,
                  }}
                >
                  {style.char}

                  {/* Player markers overlay */}
                  {players.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '1px',
                      right: '1px',
                      display: 'flex',
                      gap: '1px',
                      flexWrap: 'wrap',
                      maxWidth: '34px',
                      justifyContent: 'flex-end',
                    }}>
                      {players.map((pid, i) => {
                        const pidx = playerIds.indexOf(pid);
                        const color = PLAYER_COLORS[pidx % PLAYER_COLORS.length];
                        return (
                          <div
                            key={pid}
                            title={pid.slice(0, 12)}
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: color,
                              border: '1px solid rgba(0,0,0,0.5)',
                              fontSize: '0',
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Round progress */}
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
      </div>

      {/* Board */}
      {boardGrid && (
        <div className="panel" style={{ padding: '16px', overflowX: 'auto' }}>
          <div className="panel-header">MAP</div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            {renderBoard(boardGrid)}
          </div>
          {/* Legend */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center',
            marginTop: '12px', fontSize: '0.7rem', color: 'var(--crt-text-dim)',
          }}>
            {[
              ['~', 'WATER', 'var(--crt-cyan, #4499ff)'],
              ['─', 'ROAD', 'var(--crt-text-dim)'],
              ['╋', 'INTERSECTION', 'var(--crt-text)'],
              ['═', 'BRIDGE', 'var(--crt-cyan, #66ccff)'],
              ['♣', 'PARK', 'var(--crt-green)'],
              ['S', 'SCHOOL', 'var(--crt-amber)'],
              ['C', 'CHURCH', 'var(--crt-amber)'],
              ['H', 'HOSPITAL', 'var(--crt-amber)'],
              ['L', 'LIBRARY', 'var(--crt-amber)'],
              ['T', 'TRAIN', 'var(--crt-amber)'],
              ['G', 'GAS', 'var(--crt-amber)'],
              ['P', 'PARKING', 'var(--crt-amber)'],
            ].map(([ch, label, color]) => (
              <span key={label as string} style={{ letterSpacing: '1px' }}>
                <span style={{ color: color as string }}>{ch}</span> {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Player scores */}
      <div className="panel">
        <div className="panel-header">PLAYERS</div>
        <div style={{ display: 'grid', gap: '6px' }}>
          {playerIds.map((pid, i) => (
            <div key={pid} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 8px',
              borderBottom: '1px solid var(--crt-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: PLAYER_COLORS[i % PLAYER_COLORS.length],
                }} />
                <span style={{ fontSize: '0.85rem', letterSpacing: '1px' }}>
                  {pid.slice(0, 16).toUpperCase()}
                </span>
              </div>
              <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                {(scores[pid] ?? 0).toFixed(0)} PTS
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Round history */}
      {history.length > 0 && (
        <div className="panel">
          <div className="panel-header">ROUND HISTORY</div>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
            {[...history].reverse().map(round => {
              const choices = Object.entries(round.choices).map(([pid, choice]) => {
                const pidx = playerIds.indexOf(pid);
                const color = PLAYER_COLORS[pidx % PLAYER_COLORS.length];
                return (
                  <span key={pid} style={{ color }}>
                    {pid.slice(0, 8)}→({choice})
                  </span>
                );
              });

              return (
                <div key={round.round} style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--crt-border)',
                  fontSize: '0.8rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ letterSpacing: '2px', color: 'var(--crt-text-dim)' }}>
                      ROUND {round.round}
                    </span>
                    <span style={{ color: 'var(--crt-text-dim)' }}>
                      {Object.values(round.payoffs).map(p => p.toFixed(0)).join(' / ')} pts
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {choices}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
