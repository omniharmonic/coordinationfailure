import React, { useState, useEffect } from 'react';

interface Pattern {
  id: string;
  type: 'strategy' | 'correlation' | 'insight';
  description: string;
  supporting_games: string[];
  confidence: number;
  created_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  strategy: 'var(--crt-green)',
  correlation: 'var(--crt-amber)',
  insight: 'var(--crt-green-dim)',
};

const TYPE_LABELS: Record<string, string> = {
  strategy: 'STRATEGY',
  correlation: 'CORRELATION',
  insight: 'INSIGHT',
};

export function Knowledge({ onBack }: { onBack: () => void }) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPatterns() {
      try {
        const url = filterType ? `/api/knowledge?type=${filterType}` : '/api/knowledge';
        const res = await fetch(url);
        if (res.ok) {
          setPatterns(await res.json());
        }
      } catch (_e) { /* ignore */ }
      setLoading(false);
    }
    fetchPatterns();
    const interval = setInterval(fetchPatterns, 15000);
    return () => clearInterval(interval);
  }, [filterType]);

  const grouped = {
    strategy: patterns.filter(p => p.type === 'strategy'),
    correlation: patterns.filter(p => p.type === 'correlation'),
    insight: patterns.filter(p => p.type === 'insight'),
  };

  return (
    <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
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
          <h2 style={{ letterSpacing: '4px' }}>KNOWLEDGE BASE</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setFilterType(null)}
            style={{
              background: !filterType ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
              color: !filterType ? 'var(--crt-green)' : 'var(--crt-text-dim)',
              border: `1px solid ${!filterType ? 'var(--crt-green)' : 'var(--crt-border)'}`,
              padding: '4px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              letterSpacing: '1px',
            }}
          >
            ALL
          </button>
          {['strategy', 'correlation', 'insight'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              style={{
                background: filterType === t ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
                color: filterType === t ? TYPE_COLORS[t] : 'var(--crt-text-dim)',
                border: `1px solid ${filterType === t ? TYPE_COLORS[t] : 'var(--crt-border)'}`,
                padding: '4px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.8rem', marginBottom: '20px' }}>
        CROSS-GAME PATTERNS EXTRACTED FROM {patterns.length > 0 ? patterns[0].supporting_games?.length ?? 0 : 0}+ SIMULATIONS
      </div>

      {loading ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px' }}>
          SCANNING KNOWLEDGE BASE...
        </div>
      ) : patterns.length === 0 ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
          <div>NO PATTERNS DETECTED</div>
          <div style={{ fontSize: '0.85rem' }}>PLAY MORE GAMES TO BUILD THE KNOWLEDGE BASE</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {(filterType ? [[filterType, grouped[filterType as keyof typeof grouped]]] : Object.entries(grouped))
            .filter(([_, pats]) => (pats as Pattern[]).length > 0)
            .map(([type, pats]) => (
              <div key={type as string}>
                <div style={{
                  color: TYPE_COLORS[type as string] ?? 'var(--crt-text)',
                  fontSize: '0.85rem',
                  letterSpacing: '3px',
                  marginBottom: '10px',
                  borderBottom: `1px solid ${TYPE_COLORS[type as string] ?? 'var(--crt-border)'}`,
                  paddingBottom: '4px',
                }}>
                  {TYPE_LABELS[type as string] ?? (type as string).toUpperCase()} ({(pats as Pattern[]).length})
                </div>
                {(pats as Pattern[]).map(p => (
                  <div key={p.id} className="panel" style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.9rem', marginBottom: '4px' }}>{p.description}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--crt-text-dim)' }}>
                          OBSERVED IN {p.supporting_games?.length ?? 0} GAME{(p.supporting_games?.length ?? 0) !== 1 ? 'S' : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--crt-text-dim)', marginBottom: '2px' }}>CONFIDENCE</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '60px',
                            height: '8px',
                            background: 'var(--crt-bg)',
                            border: '1px solid var(--crt-border)',
                          }}>
                            <div style={{
                              width: `${(p.confidence * 100)}%`,
                              height: '100%',
                              background: p.confidence > 0.7 ? 'var(--crt-green)' : p.confidence > 0.4 ? 'var(--crt-amber)' : 'var(--crt-red)',
                            }} />
                          </div>
                          <span style={{ fontSize: '0.75rem' }}>{(p.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
