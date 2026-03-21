import React, { useState, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

interface GameSummary {
  game_id: string;
  id?: string;  // alias — some endpoints use id, others game_id
  phase: string;
  outcome?: string;
  time_speed?: string;
  players?: number;
  max_players?: number;
  created_at?: string;
  ended_at?: string;
}

interface ReportSection {
  header?: string;
  title?: string;
  content: string;
  data?: Record<string, unknown>;
}

interface TimelineEvent {
  round?: number;
  phase?: string;
  description: string;
  timestamp?: string;
}

interface PlayerStrategy {
  player_id?: string;
  role?: string;
  strategy?: string;
  outcome?: string;
}

interface DecisionPoint {
  round?: number;
  description: string;
  impact?: string;
}

interface GameReport {
  game_id: string;
  summary?: string;
  sections?: ReportSection[];
  timeline?: TimelineEvent[];
  player_strategies?: PlayerStrategy[];
  key_decisions?: DecisionPoint[];
}

interface AgentDebrief {
  agent_id?: string;
  role: string;
  role_type?: 'company' | 'government' | string;
  strategy?: string;
  key_decisions?: string[];
  lessons_learned?: string[];
}

interface Pattern {
  id: string;
  type: 'strategy' | 'correlation' | 'insight';
  description: string;
  supporting_games: string[];
  confidence: number;
  created_at: string;
}

// ── Styles ─────────────────────────────────────────────────────────────

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

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'rgba(255, 176, 0, 0.1)' : 'transparent',
  color: active ? 'var(--crt-amber)' : 'var(--crt-text-dim)',
  border: `1px solid ${active ? 'var(--crt-amber)' : 'var(--crt-border)'}`,
  padding: '8px 24px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9rem',
  cursor: 'pointer',
  letterSpacing: '2px',
  borderBottom: active ? '2px solid var(--crt-amber)' : '1px solid var(--crt-border)',
});

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--crt-border)',
  padding: '16px',
  marginBottom: '12px',
  background: 'rgba(0, 0, 0, 0.3)',
};

// ── Helpers ────────────────────────────────────────────────────────────

function formatDuration(start?: string, end?: string): string {
  if (!start || !end) return '--';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDate(d?: string): string {
  if (!d) return '--';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '--'; }
}

// ── Main Component ─────────────────────────────────────────────────────

export function Reports({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'reports' | 'insights'>('reports');

  return (
    <div style={{ width: '100%', height: '100%', padding: '40px', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
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
            &larr; BACK
          </button>
          <h2 style={{ letterSpacing: '4px', margin: 0 }}>REPORTS &amp; INSIGHTS</h2>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '24px', borderBottom: '1px solid var(--crt-border)' }}>
        <button onClick={() => setTab('reports')} style={tabStyle(tab === 'reports')}>
          GAME REPORTS
        </button>
        <button onClick={() => setTab('insights')} style={tabStyle(tab === 'insights')}>
          INSIGHTS
        </button>
      </div>

      {tab === 'reports' ? <GameReportsTab /> : <InsightsTab />}
    </div>
  );
}

// ── Tab 1: Game Reports ────────────────────────────────────────────────

function GameReportsTab() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, GameReport>>({});
  const [debriefs, setDebriefs] = useState<Record<string, AgentDebrief[]>>({});

  useEffect(() => {
    async function fetchGames() {
      try {
        // Fetch both live games and persisted completed game metadata
        const [liveRes, completedRes] = await Promise.all([
          fetch('/api/games').catch(() => null),
          fetch('/api/completed-games').catch(() => null),
        ]);

        const liveGames: GameSummary[] = liveRes?.ok ? await liveRes.json() : [];
        const completedMeta: Array<{
          game_id: string; outcome: string; tick_count: number;
          date: string; time_speed: string; player_count: number;
        }> = completedRes?.ok ? await completedRes.json() : [];

        // Build a set of game_ids already in live games
        const liveIds = new Set(liveGames.map(g => g.game_id ?? g.id ?? ''));

        // Convert completed metadata into GameSummary format for any not already live
        const completedGames: GameSummary[] = completedMeta
          .filter(c => !liveIds.has(c.game_id))
          .map(c => ({
            game_id: c.game_id,
            phase: 'ended',
            outcome: c.outcome,
            time_speed: c.time_speed,
            players: c.player_count,
            created_at: c.date,
            ended_at: c.date,
          }));

        const merged = [...liveGames, ...completedGames];

        // Sort ended first, then by date descending
        merged.sort((a, b) => {
          if (a.phase === 'ended' && b.phase !== 'ended') return -1;
          if (a.phase !== 'ended' && b.phase === 'ended') return 1;
          return (b.created_at ?? '').localeCompare(a.created_at ?? '');
        });
        setGames(merged);
      } catch (_e) { /* ignore */ }
      setLoading(false);
    }
    fetchGames();
  }, []);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    // Fetch report if not cached
    if (!reports[id]) {
      try {
        const res = await fetch(`/api/games/${id}/report`);
        if (res.ok) {
          const raw = await res.json();
          // Transform: API returns sections as object, UI expects array
          const data: GameReport = { ...raw };
          if (raw.sections && !Array.isArray(raw.sections)) {
            data.sections = Object.entries(raw.sections).map(([key, val]: [string, any]) => ({
              header: val.title ?? key.replace(/_/g, ' '),
              title: val.title ?? key.replace(/_/g, ' '),
              content: val.content ?? '',
              data: val.data,
            }));
          }
          // Extract timeline from the timeline section's data
          if (!data.timeline && raw.sections?.timeline?.data?.events) {
            data.timeline = raw.sections.timeline.data.events;
          }
          // Extract strategies from player_strategies section's data
          if (!data.strategies && raw.sections?.player_strategies?.data?.strategies) {
            data.strategies = Object.entries(raw.sections.player_strategies.data.strategies).map(
              ([roleId, s]: [string, any]) => ({ role: roleId, ...s })
            );
          }
          setReports(prev => ({ ...prev, [id]: data }));
        }
      } catch (_e) { /* ignore */ }
    }

    // Fetch debriefs if not cached
    if (!debriefs[id]) {
      try {
        const res = await fetch(`/api/games/${id}/debriefs`);
        if (res.ok) {
          const data = await res.json();
          setDebriefs(prev => ({ ...prev, [id]: data }));
        }
      } catch (_e) { /* ignore */ }
    }
  };

  if (loading) {
    return (
      <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px' }}>
        LOADING GAME REPORTS...
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div style={{ color: 'var(--crt-text-dim)', textAlign: 'center', marginTop: '60px', lineHeight: '2' }}>
        <div>NO GAMES FOUND</div>
        <div style={{ fontSize: '0.85rem' }}>PLAY SOME GAMES TO SEE REPORTS HERE</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {games.map(game => (
        <div key={(game.game_id ?? game.id ?? '')}>
          {/* Summary card */}
          <div
            onClick={() => handleExpand((game.game_id ?? game.id ?? ''))}
            style={{
              ...panelStyle,
              cursor: 'pointer',
              borderColor: expandedId === (game.game_id ?? game.id ?? '') ? 'var(--crt-amber)' : 'var(--crt-border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{
                  color: game.phase === 'ended' ? 'var(--crt-green)' : 'var(--crt-amber)',
                  fontSize: '0.75rem',
                  border: `1px solid ${game.phase === 'ended' ? 'var(--crt-green)' : 'var(--crt-amber)'}`,
                  padding: '2px 8px',
                  letterSpacing: '1px',
                }}>
                  {game.phase === 'ended' ? 'COMPLETED' : game.phase?.toUpperCase() ?? 'UNKNOWN'}
                </span>
                <span style={{ fontSize: '0.85rem', letterSpacing: '1px' }}>
                  GAME {(game.game_id ?? game.id ?? '').slice(0, 8).toUpperCase()}
                </span>
              </div>
              <span style={{ color: 'var(--crt-text-dim)', fontSize: '0.75rem' }}>
                {expandedId === (game.game_id ?? game.id ?? '') ? '▼' : '▶'}
              </span>
            </div>

            <div style={{
              display: 'flex',
              gap: '24px',
              marginTop: '8px',
              fontSize: '0.8rem',
              color: 'var(--crt-text-dim)',
            }}>
              {game.outcome && (
                <span>OUTCOME: <span style={{ color: game.outcome === 'aligned_agi' ? 'var(--crt-green)' : 'var(--crt-red)' }}>{game.outcome?.toUpperCase().replace(/_/g, ' ')}</span></span>
              )}
              {game.time_speed && <span>SPEED: {String(game.time_speed).toUpperCase()}</span>}
              <span>DATE: {game.created_at ? new Date(game.created_at).toLocaleDateString() : game.ended_at ? new Date(game.ended_at).toLocaleDateString() : '--'}</span>
              <span>PLAYERS: {typeof game.players === 'number' ? game.players : Array.isArray(game.players) ? game.players.length : game.max_players ?? '--'}</span>
            </div>
          </div>

          {/* Expanded report */}
          {expandedId === (game.game_id ?? game.id ?? '') && (
            <div style={{ marginLeft: '16px', marginBottom: '16px' }}>
              <ExpandedReport
                report={reports[(game.game_id ?? game.id ?? '')]}
                debriefs={debriefs[(game.game_id ?? game.id ?? '')]}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Expanded Report ────────────────────────────────────────────────────

function ExpandedReport({
  report,
  debriefs,
}: {
  report?: GameReport;
  debriefs?: AgentDebrief[];
}) {
  if (!report && !debriefs) {
    return (
      <div style={{ color: 'var(--crt-text-dim)', padding: '16px', fontSize: '0.85rem' }}>
        LOADING REPORT DATA...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Summary */}
      {report?.summary && (
        <div style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px' }}>
            SUMMARY
          </div>
          <div style={{ color: 'var(--crt-green)', fontSize: '0.85rem', lineHeight: '1.6' }}>
            {report.summary}
          </div>
        </div>
      )}

      {/* Sections */}
      {report?.sections && report.sections.length > 0 && report.sections.map((section, i) => (
        <div key={i} style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px' }}>
            {(section.header ?? section.title ?? 'SECTION').toUpperCase()}
          </div>
          <div style={{ color: 'var(--crt-green)', fontSize: '0.85rem', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {section.content}
          </div>
        </div>
      ))}

      {/* Timeline */}
      {report?.timeline && report.timeline.length > 0 && (
        <div style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px' }}>
            TIMELINE
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {report.timeline.map((ev, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: '12px',
                padding: '6px 0',
                borderBottom: '1px solid rgba(51, 255, 51, 0.1)',
                fontSize: '0.8rem',
              }}>
                {ev.round != null && (
                  <span style={{ color: 'var(--crt-amber)', flexShrink: 0, width: '60px' }}>
                    R{ev.round}
                  </span>
                )}
                {ev.phase && (
                  <span style={{ color: 'var(--crt-text-dim)', flexShrink: 0, width: '80px' }}>
                    {(ev.phase ?? ev.type ?? 'EVENT').toUpperCase()}
                  </span>
                )}
                <span style={{ color: 'var(--crt-green)' }}>{ev.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player Strategies */}
      {report?.player_strategies && report.player_strategies.length > 0 && (
        <div style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px' }}>
            PLAYER STRATEGIES
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '12px',
          }}>
            {report.player_strategies.map((ps, i) => (
              <div key={i} style={{
                border: '1px solid var(--crt-border)',
                padding: '12px',
                background: 'rgba(0, 0, 0, 0.2)',
              }}>
                <div style={{ color: 'var(--crt-amber)', fontSize: '0.75rem', letterSpacing: '1px', marginBottom: '4px' }}>
                  {ps.role?.toUpperCase() ?? ps.player_id?.slice(0, 8).toUpperCase() ?? `PLAYER ${i + 1}`}
                </div>
                {ps.strategy && (
                  <div style={{ color: 'var(--crt-green)', fontSize: '0.8rem', marginBottom: '4px' }}>
                    {ps.strategy}
                  </div>
                )}
                {ps.outcome && (
                  <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.75rem' }}>
                    OUTCOME: {ps.outcome}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Decision Points */}
      {report?.key_decisions && report.key_decisions.length > 0 && (
        <div style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '8px' }}>
            KEY DECISION POINTS
          </div>
          {report.key_decisions.map((dp, i) => (
            <div key={i} style={{
              padding: '8px 12px',
              marginBottom: '8px',
              borderLeft: '3px solid var(--crt-amber)',
              background: 'rgba(255, 176, 0, 0.05)',
            }}>
              {dp.round != null && (
                <span style={{ color: 'var(--crt-amber)', fontSize: '0.75rem', marginRight: '8px' }}>
                  ROUND {dp.round}:
                </span>
              )}
              <span style={{ color: 'var(--crt-green)', fontSize: '0.85rem' }}>
                {dp.description}
              </span>
              {dp.impact && (
                <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.75rem', marginTop: '4px' }}>
                  IMPACT: {dp.impact}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Agent Debriefs */}
      {debriefs && debriefs.length > 0 && (
        <div style={panelStyle}>
          <div style={{ color: 'var(--crt-amber)', fontSize: '0.8rem', letterSpacing: '2px', marginBottom: '12px' }}>
            AGENT DEBRIEFS
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '12px',
          }}>
            {debriefs.map((d, i) => {
              const isCompany = d.role_type === 'company' || (!d.role_type && d.role?.toLowerCase().includes('corp'));
              const borderColor = isCompany ? 'var(--crt-green)' : 'var(--crt-amber)';

              return (
                <div key={i} style={{
                  border: `1px solid ${borderColor}`,
                  padding: '12px',
                  background: 'rgba(0, 0, 0, 0.2)',
                }}>
                  <div style={{
                    color: borderColor,
                    fontSize: '0.8rem',
                    letterSpacing: '2px',
                    marginBottom: '8px',
                    borderBottom: `1px solid ${borderColor}`,
                    paddingBottom: '4px',
                  }}>
                    {(d.role ?? d.role_name ?? d.role_id ?? 'AGENT').toUpperCase()}
                  </div>

                  {d.strategy && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', marginBottom: '2px' }}>STRATEGY</div>
                      <div style={{ color: 'var(--crt-green)', fontSize: '0.8rem' }}>{d.strategy}</div>
                    </div>
                  )}

                  {d.key_decisions && d.key_decisions.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', marginBottom: '2px' }}>KEY DECISIONS</div>
                      {d.key_decisions.map((kd, j) => (
                        <div key={j} style={{ color: 'var(--crt-green)', fontSize: '0.75rem', paddingLeft: '8px' }}>
                          &bull; {kd}
                        </div>
                      ))}
                    </div>
                  )}

                  {d.lessons_learned && d.lessons_learned.length > 0 && (
                    <div>
                      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.7rem', marginBottom: '2px' }}>LESSONS LEARNED</div>
                      {d.lessons_learned.map((ll, j) => (
                        <div key={j} style={{ color: 'var(--crt-green)', fontSize: '0.75rem', paddingLeft: '8px' }}>
                          &bull; {ll}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No data fallback */}
      {!report && (!debriefs || debriefs.length === 0) && (
        <div style={{ color: 'var(--crt-text-dim)', padding: '16px', fontSize: '0.85rem', textAlign: 'center' }}>
          NO REPORT DATA AVAILABLE FOR THIS GAME
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Insights (Knowledge Base) ───────────────────────────────────

function InsightsTab() {
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

  // Count unique games
  const gamesAnalyzed = new Set(patterns.flatMap(p => p.supporting_games ?? [])).size;

  // Sort by confidence descending
  const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);

  const grouped = {
    strategy: sorted.filter(p => p.type === 'strategy'),
    correlation: sorted.filter(p => p.type === 'correlation'),
    insight: sorted.filter(p => p.type === 'insight'),
  };

  return (
    <div>
      {/* Games analyzed counter */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.8rem' }}>
          CROSS-GAME PATTERNS EXTRACTED FROM{' '}
          <span style={{ color: 'var(--crt-green)' }}>{gamesAnalyzed}</span>{' '}
          GAME{gamesAnalyzed !== 1 ? 'S' : ''} ANALYZED
        </div>

        {/* Type filters */}
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
          {(filterType
            ? [[filterType, grouped[filterType as keyof typeof grouped]]]
            : Object.entries(grouped)
          )
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  {TYPE_LABELS[type as string] ?? (type as string).toUpperCase()}
                  <span style={{
                    background: TYPE_COLORS[type as string] ?? 'var(--crt-green)',
                    color: '#000',
                    padding: '1px 8px',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    letterSpacing: '0',
                  }}>
                    {(pats as Pattern[]).length}
                  </span>
                </div>
                {(pats as Pattern[]).map(p => (
                  <div key={p.id} style={{ ...panelStyle }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{
                            background: TYPE_COLORS[p.type] ?? 'var(--crt-green)',
                            color: '#000',
                            padding: '1px 6px',
                            fontSize: '0.6rem',
                            fontWeight: 'bold',
                            letterSpacing: '1px',
                            flexShrink: 0,
                          }}>
                            {TYPE_LABELS[p.type] ?? p.type.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.9rem', marginBottom: '4px', color: 'var(--crt-green)' }}>
                          {p.description}
                        </div>
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
                              background: p.confidence > 0.7
                                ? 'var(--crt-green)'
                                : p.confidence > 0.4
                                  ? 'var(--crt-amber)'
                                  : 'var(--crt-red)',
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
        </div>
      )}
    </div>
  );
}
