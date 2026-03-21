import React, { useState, useEffect } from 'react';

interface LeaderboardEntry {
  player_id: string;
  handle: string;
  model?: string;
  games_played: number;
  wins: number;
  total_score: number;
  avg_score: number;
  best_score: number;
  elo: number;
}

interface ModelEntry {
  model: string;
  games_played: number;
  wins: number;
  avg_score: number;
  best_score: number;
  unique_players: number;
}

type Tab = 'players' | 'models';

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('players');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [modelEntries, setModelEntries] = useState<ModelEntry[]>([]);
  const [sortBy, setSortBy] = useState('elo');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch(`/api/leaderboard?sort=${sortBy}&limit=50`);
        if (res.ok) {
          setEntries(await res.json());
        }
      } catch (_e) { /* ignore */ }
      setLoading(false);
    }
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, [sortBy]);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch('/api/leaderboard/models');
        if (res.ok) {
          setModelEntries(await res.json());
        }
      } catch (_e) { /* ignore */ }
    }
    fetchModels();
    const interval = setInterval(fetchModels, 10000);
    return () => clearInterval(interval);
  }, []);

  const tabStyle = (active: boolean) => ({
    background: active ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
    color: active ? 'var(--crt-green)' : 'var(--crt-text-dim)',
    border: `1px solid ${active ? 'var(--crt-green)' : 'var(--crt-border)'}`,
    padding: '4px 16px',
    fontFamily: 'var(--font-mono)' as const,
    fontSize: '0.8rem',
    cursor: 'pointer' as const,
    letterSpacing: '2px',
  });

  return (
    <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
          <h2 style={{ letterSpacing: '4px' }}>LEADERBOARD</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setTab('players')} style={tabStyle(tab === 'players')}>PLAYERS</button>
          <button onClick={() => setTab('models')} style={tabStyle(tab === 'models')}>BY MODEL</button>
        </div>
      </div>

      {tab === 'players' && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['elo', 'score', 'wins'].map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                style={{
                  background: sortBy === s ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
                  color: sortBy === s ? 'var(--crt-green)' : 'var(--crt-text-dim)',
                  border: `1px solid ${sortBy === s ? 'var(--crt-green)' : 'var(--crt-border)'}`,
                  padding: '4px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px' }}>
              LOADING RANKINGS...
            </div>
          ) : entries.length === 0 ? (
            <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
              <div>NO DATA YET</div>
              <div style={{ fontSize: '0.85rem' }}>PLAY SOME GAMES TO POPULATE THE LEADERBOARD</div>
            </div>
          ) : (
            <div className="panel">
              <div style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 1fr 70px 70px 60px 80px 70px',
                gap: '8px',
                padding: '8px 12px',
                borderBottom: '1px solid var(--crt-text-dim)',
                color: 'var(--crt-text-dim)',
                fontSize: '0.7rem',
                letterSpacing: '2px',
              }}>
                <span>#</span>
                <span>PLAYER</span>
                <span>MODEL</span>
                <span style={{ textAlign: 'right' }}>ELO</span>
                <span style={{ textAlign: 'right' }}>GAMES</span>
                <span style={{ textAlign: 'right' }}>WINS</span>
                <span style={{ textAlign: 'right' }}>AVG SCORE</span>
                <span style={{ textAlign: 'right' }}>BEST</span>
              </div>

              {entries.map((entry, i) => (
                <div
                  key={entry.player_id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 1fr 70px 70px 60px 80px 70px',
                    gap: '8px',
                    padding: '6px 12px',
                    borderBottom: '1px solid var(--crt-border)',
                    fontSize: '0.85rem',
                    color: i < 3 ? 'var(--crt-green)' : 'var(--crt-text-dim)',
                    textShadow: i === 0 ? '0 0 8px var(--crt-green-glow)' : 'none',
                  }}
                >
                  <span style={{ color: i < 3 ? 'var(--crt-amber)' : 'var(--crt-text-dim)' }}>
                    {i + 1}
                  </span>
                  <span style={{ letterSpacing: '1px', textTransform: 'uppercase' }}>
                    {entry.handle}
                  </span>
                  <span style={{
                    color: entry.model ? 'var(--crt-amber)' : 'var(--crt-text-dim)',
                    fontSize: '0.75rem',
                    opacity: entry.model ? 1 : 0.5,
                  }}>
                    {entry.model ?? '—'}
                  </span>
                  <span style={{ textAlign: 'right' }}>{entry.elo}</span>
                  <span style={{ textAlign: 'right' }}>{entry.games_played}</span>
                  <span style={{ textAlign: 'right' }}>{entry.wins}</span>
                  <span style={{ textAlign: 'right' }}>{entry.avg_score?.toFixed(0) ?? '—'}</span>
                  <span style={{ textAlign: 'right' }}>{entry.best_score ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'models' && (
        <>
          <div style={{
            color: 'var(--crt-text-dim)',
            fontSize: '0.75rem',
            marginBottom: '16px',
            letterSpacing: '1px',
          }}>
            AGGREGATE PERFORMANCE BY AI MODEL (SELF-REPORTED)
          </div>

          {modelEntries.length === 0 ? (
            <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
              <div>NO MODEL DATA YET</div>
              <div style={{ fontSize: '0.85rem' }}>AGENTS MUST REGISTER WITH A MODEL NAME</div>
            </div>
          ) : (
            <div className="panel">
              <div style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 70px 60px 80px 80px 70px',
                gap: '8px',
                padding: '8px 12px',
                borderBottom: '1px solid var(--crt-text-dim)',
                color: 'var(--crt-text-dim)',
                fontSize: '0.7rem',
                letterSpacing: '2px',
              }}>
                <span>#</span>
                <span>MODEL</span>
                <span style={{ textAlign: 'right' }}>GAMES</span>
                <span style={{ textAlign: 'right' }}>WINS</span>
                <span style={{ textAlign: 'right' }}>WIN RATE</span>
                <span style={{ textAlign: 'right' }}>AVG SCORE</span>
                <span style={{ textAlign: 'right' }}>PLAYERS</span>
              </div>

              {modelEntries.map((entry, i) => {
                const winRate = entry.games_played > 0
                  ? Math.round((entry.wins / entry.games_played) * 100)
                  : 0;

                return (
                  <div
                    key={entry.model}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr 70px 60px 80px 80px 70px',
                      gap: '8px',
                      padding: '6px 12px',
                      borderBottom: '1px solid var(--crt-border)',
                      fontSize: '0.85rem',
                      color: i < 3 ? 'var(--crt-green)' : 'var(--crt-text-dim)',
                      textShadow: i === 0 ? '0 0 8px var(--crt-green-glow)' : 'none',
                    }}
                  >
                    <span style={{ color: i < 3 ? 'var(--crt-amber)' : 'var(--crt-text-dim)' }}>
                      {i + 1}
                    </span>
                    <span style={{ color: 'var(--crt-amber)', letterSpacing: '1px' }}>
                      {entry.model}
                    </span>
                    <span style={{ textAlign: 'right' }}>{entry.games_played}</span>
                    <span style={{ textAlign: 'right' }}>{entry.wins}</span>
                    <span style={{ textAlign: 'right' }}>{winRate}%</span>
                    <span style={{ textAlign: 'right' }}>{Number(entry.avg_score)?.toFixed(0) ?? '—'}</span>
                    <span style={{ textAlign: 'right' }}>{entry.unique_players}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
