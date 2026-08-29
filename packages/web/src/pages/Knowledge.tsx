import React, { useState, useEffect } from 'react';

interface Pattern {
  id: string;
  type: 'strategy' | 'correlation' | 'insight';
  description: string;
  supporting_games: string[];
  confidence: number;
  created_at: string;
}

interface AgentInsight {
  id: string;
  title: string;
  description: string;
  source: 'agent';
  role_id: string;
  role_name: string;
  game_id: string;
  submitted_at: string;
}

type Tab = 'all' | 'algorithmic' | 'agent';

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

const ROLE_COLORS: Record<string, string> = {
  openbrain: '#33ff33',
  prometheus: '#33ff33',
  nexus: '#33ff33',
  titan: '#33ff33',
  deepcent: '#6bcbff',
  qianneng: '#6bcbff',
  us_gov: '#ffaa00',
  china_gov: '#ffaa00',
};

type InsightSort = 'newest' | 'oldest' | 'role';

export function Knowledge({ onBack }: { onBack: () => void }) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [agentInsights, setAgentInsights] = useState<AgentInsight[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [insightSort, setInsightSort] = useState<InsightSort>('newest');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [patRes, agentRes] = await Promise.all([
          fetch(filterType ? `/api/knowledge?type=${filterType}` : '/api/knowledge').catch(() => null),
          fetch('/api/knowledge/agent-insights').catch(() => null),
        ]);
        if (patRes?.ok) setPatterns(await patRes.json());
        if (agentRes?.ok) setAgentInsights(await agentRes.json());
      } catch (_e) { /* ignore */ }
      setLoading(false);
    }
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [filterType]);

  const grouped = {
    strategy: patterns.filter(p => p.type === 'strategy'),
    correlation: patterns.filter(p => p.type === 'correlation'),
    insight: patterns.filter(p => p.type === 'insight'),
  };

  const totalGames = new Set(patterns.flatMap(p => p.supporting_games ?? [])).size;

  // Role filtering and sorting for agent insights
  const uniqueRoles = [...new Set(agentInsights.map(i => i.role_id))];
  const roleCounts = uniqueRoles.reduce<Record<string, number>>((acc, role) => {
    acc[role] = agentInsights.filter(i => i.role_id === role).length;
    return acc;
  }, {});
  const filteredInsights = roleFilter ? agentInsights.filter(i => i.role_id === roleFilter) : agentInsights;
  const sortedInsights = [...filteredInsights].sort((a, b) => {
    if (insightSort === 'newest') return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
    if (insightSort === 'oldest') return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
    // sort by role
    return (a.role_id).localeCompare(b.role_id);
  });

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
          <h2 style={{ letterSpacing: '4px' }}>KNOWLEDGE BASE</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setTab('all')} style={tabStyle(tab === 'all')}>ALL</button>
          <button onClick={() => setTab('algorithmic')} style={tabStyle(tab === 'algorithmic')}>ALGORITHMIC</button>
          <button onClick={() => setTab('agent')} style={tabStyle(tab === 'agent')}>AGENT</button>
        </div>
      </div>

      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.8rem', marginBottom: '20px' }}>
        {patterns.length} ALGORITHMIC PATTERNS FROM {totalGames}+ SIMULATIONS
        {agentInsights.length > 0 && ` • ${agentInsights.length} AGENT-CONTRIBUTED INSIGHTS`}
      </div>

      {/* Type filter for algorithmic patterns */}
      {(tab === 'all' || tab === 'algorithmic') && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => setFilterType(null)}
            style={{
              background: !filterType ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
              color: !filterType ? 'var(--crt-green)' : 'var(--crt-text-dim)',
              border: `1px solid ${!filterType ? 'var(--crt-green)' : 'var(--crt-border)'}`,
              padding: '4px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              letterSpacing: '1px',
            }}
          >
            ALL TYPES
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
                fontSize: '0.75rem',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px' }}>
          SCANNING KNOWLEDGE BASE...
        </div>
      ) : patterns.length === 0 && agentInsights.length === 0 ? (
        <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
          <div>NO PATTERNS DETECTED</div>
          <div style={{ fontSize: '0.85rem' }}>PLAY MORE GAMES TO BUILD THE KNOWLEDGE BASE</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Agent insights section */}
          {(tab === 'all' || tab === 'agent') && agentInsights.length > 0 && (
            <div>
              <div style={{
                color: '#ff6b6b',
                fontSize: '0.85rem',
                letterSpacing: '3px',
                marginBottom: '10px',
                borderBottom: '1px solid #ff6b6b',
                paddingBottom: '4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}>
                <span>AGENT-CONTRIBUTED INSIGHTS ({agentInsights.length})</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--crt-text-dim)', letterSpacing: '1px' }}>
                  FIRST-PERSON ANALYSIS FROM GAME PARTICIPANTS
                </span>
              </div>

              {/* Role filter buttons */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={() => setRoleFilter(null)}
                  style={{
                    background: !roleFilter ? 'rgba(255, 107, 107, 0.15)' : 'transparent',
                    color: !roleFilter ? '#ff6b6b' : 'var(--crt-text-dim)',
                    border: `1px solid ${!roleFilter ? '#ff6b6b' : 'var(--crt-border)'}`,
                    padding: '4px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    letterSpacing: '1px',
                  }}
                >
                  ALL ({agentInsights.length})
                </button>
                {uniqueRoles.map(role => (
                  <button
                    key={role}
                    onClick={() => setRoleFilter(role)}
                    style={{
                      background: roleFilter === role ? `${ROLE_COLORS[role] ?? 'var(--crt-green)'}22` : 'transparent',
                      color: roleFilter === role ? (ROLE_COLORS[role] ?? 'var(--crt-green)') : 'var(--crt-text-dim)',
                      border: `1px solid ${roleFilter === role ? (ROLE_COLORS[role] ?? 'var(--crt-green)') : 'var(--crt-border)'}`,
                      padding: '4px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                    }}
                  >
                    {role.replace('_', ' ')} ({roleCounts[role]})
                  </button>
                ))}

                {/* Sort controls */}
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--crt-text-dim)', letterSpacing: '1px' }}>SORT:</span>
                {(['newest', 'oldest', 'role'] as InsightSort[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setInsightSort(s)}
                    style={{
                      background: insightSort === s ? 'rgba(255, 107, 107, 0.15)' : 'transparent',
                      color: insightSort === s ? '#ff6b6b' : 'var(--crt-text-dim)',
                      border: `1px solid ${insightSort === s ? '#ff6b6b' : 'var(--crt-border)'}`,
                      padding: '2px 8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      cursor: 'pointer',
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {sortedInsights.map(insight => (
                <div key={insight.id} className="panel" style={{
                  marginBottom: '10px',
                  borderLeft: `3px solid ${ROLE_COLORS[insight.role_id] ?? 'var(--crt-green)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '0.9rem',
                        color: 'var(--crt-amber)',
                        marginBottom: '6px',
                        fontWeight: 'bold',
                      }}>
                        {insight.title}
                      </div>
                      <div style={{
                        fontSize: '0.85rem',
                        lineHeight: '1.5',
                        marginBottom: '8px',
                      }}>
                        {insight.description}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        fontSize: '0.7rem',
                        color: 'var(--crt-text-dim)',
                      }}>
                        <span style={{ color: ROLE_COLORS[insight.role_id] ?? 'var(--crt-text-dim)' }}>
                          {insight.role_name.toUpperCase()}
                        </span>
                        <span>GAME {insight.game_id.slice(0, 8).toUpperCase()}</span>
                        <span>{new Date(insight.submitted_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div style={{
                      flexShrink: 0,
                      background: '#ff6b6b',
                      color: '#000',
                      padding: '2px 6px',
                      fontSize: '0.6rem',
                      fontWeight: 'bold',
                      letterSpacing: '1px',
                    }}>
                      AGENT
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Algorithmic patterns */}
          {(tab === 'all' || tab === 'algorithmic') && (
            <>
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
                              <span style={{ fontSize: '0.75rem' }}>{((p.confidence ?? 0) * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
