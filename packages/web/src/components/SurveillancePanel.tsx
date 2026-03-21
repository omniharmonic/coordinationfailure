import React, { useState, useEffect, useRef } from 'react';

interface SurveillanceMessage {
  id: string;
  type: 'dm' | 'group' | 'country' | 'public' | 'espionage' | 'agreement';
  from?: string;
  content: string;
  timestamp: number;
  channel_name?: string;
  participants?: string[];
  // Espionage-specific
  target?: string;
  status?: string;
  // Agreement-specific
  agreement_type?: string;
  parties?: string[];
}

type Filter = 'all' | 'dm' | 'group' | 'country' | 'covert';

const ROLE_LABELS: Record<string, string> = {
  openbrain: 'OPENBRAIN',
  prometheus: 'PROMETHEUS',
  nexus: 'NEXUS',
  titan: 'TITAN',
  deepcent: 'DEEPCENT',
  qianneng: 'QIANNENG',
  us_gov: 'US GOV',
  china_gov: 'CHINA GOV',
};

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  dm: { label: 'DM', color: '#ff6b6b' },
  group: { label: 'GRP', color: '#ffd93d' },
  country: { label: 'NATL', color: '#6bcbff' },
  public: { label: 'PUB', color: 'var(--crt-green-dim)' },
  espionage: { label: 'SIGINT', color: '#ff3333' },
  agreement: { label: 'DIPLO', color: '#ffaa00' },
};

export function SurveillancePanel({
  gameId,
  gameState,
}: {
  gameId: string;
  gameState: any;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [messages, setMessages] = useState<SurveillanceMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Fetch all messages
  useEffect(() => {
    if (!gameId) return;

    async function fetchMessages() {
      try {
        const res = await fetch(`/api/games/${gameId}/messages/all`);
        if (!res.ok) return;
        const data = await res.json();

        const mapped: SurveillanceMessage[] = (data as any[])
          .filter((m: any) => m.channel_type !== 'public')
          .map((m: any) => ({
            id: m.id,
            type: m.channel_type === 'dm' ? 'dm' : m.channel_type === 'group' ? 'group' : m.channel_type === 'country' ? 'country' : 'public',
            from: m.from,
            content: m.content,
            timestamp: m.timestamp,
            channel_name: m.channel_name,
          }));

        // Add espionage operations from game state
        if (gameState?.governments) {
          for (const gov of Object.values(gameState.governments) as any[]) {
            if (gov.active_operations) {
              for (const op of gov.active_operations) {
                mapped.push({
                  id: `esp-${op.id}`,
                  type: 'espionage',
                  from: gov.id,
                  content: op.ticks_remaining > 0
                    ? `ACTIVE OPERATION targeting ${ROLE_LABELS[op.target_id] ?? op.target_id} — ${op.ticks_remaining} ticks remaining${op.detected ? ' [DETECTED]' : ''}`
                    : `Operation against ${ROLE_LABELS[op.target_id] ?? op.target_id} complete`,
                  timestamp: Date.now() - (op.ticks_remaining * 2000),
                  target: op.target_id,
                  status: op.detected ? 'detected' : 'covert',
                });
              }
            }
          }
        }

        // Add agreement events
        if (gameState?.agreements) {
          for (const ag of gameState.agreements) {
            if (ag.status === 'pending') {
              mapped.push({
                id: `ag-${ag.id}`,
                type: 'agreement',
                from: ag.proposed_by,
                content: `PROPOSAL: ${ag.type?.replace(/_/g, ' ').toUpperCase()} — awaiting: ${(ag.pending_acceptances ?? []).map((p: string) => ROLE_LABELS[p] ?? p).join(', ')}`,
                timestamp: Date.now() - ((gameState.world?.tick_count - ag.proposed_at_tick) * 2000),
                agreement_type: ag.type,
                parties: ag.parties,
              });
            }
            if (ag.status === 'violated') {
              mapped.push({
                id: `ag-v-${ag.id}`,
                type: 'agreement',
                from: ag.violator_id ?? ag.proposed_by,
                content: `VIOLATION: ${ag.type?.replace(/_/g, ' ').toUpperCase()} breached`,
                timestamp: Date.now(),
                agreement_type: ag.type,
                parties: ag.parties,
              });
            }
          }
        }

        // Sort by timestamp
        mapped.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(mapped);

        // Track unread
        if (!open && mapped.length > prevCountRef.current) {
          setUnreadCount(c => c + (mapped.length - prevCountRef.current));
        }
        prevCountRef.current = mapped.length;
      } catch (_e) { /* ignore */ }
    }

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [gameId, gameState, open]);

  // Auto-scroll
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Clear unread when opening
  useEffect(() => {
    if (open) setUnreadCount(0);
  }, [open]);

  // Filter messages
  const filtered = messages.filter(m => {
    if (filter === 'all') return true;
    if (filter === 'covert') return m.type === 'espionage' || m.type === 'agreement';
    return m.type === filter;
  });

  const filterBtn = (f: Filter, label: string) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      style={{
        background: filter === f ? 'rgba(51, 255, 51, 0.15)' : 'transparent',
        color: filter === f ? '#33ff33' : '#1a8c1a',
        border: `1px solid ${filter === f ? '#33ff33' : '#222'}`,
        padding: '2px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        cursor: 'pointer',
        letterSpacing: '1px',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          right: open ? '380px' : '0',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1000,
          background: 'rgba(10, 10, 10, 0.95)',
          border: '1px solid #333',
          borderRight: open ? 'none' : '1px solid #333',
          borderLeft: open ? '1px solid #333' : 'none',
          color: unreadCount > 0 ? '#ff3333' : '#33ff33',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          padding: '12px 6px',
          cursor: 'pointer',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          letterSpacing: '2px',
          textShadow: unreadCount > 0
            ? '0 0 8px rgba(255, 51, 51, 0.6)'
            : '0 0 8px rgba(51, 255, 51, 0.3)',
          transition: 'right 0.3s ease',
        }}
      >
        {open ? '▶ CLOSE' : `◀ SIGINT${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
      </button>

      {/* Panel */}
      <div style={{
        position: 'fixed',
        right: open ? '0' : '-380px',
        top: 0,
        width: '380px',
        height: '100%',
        background: 'rgba(5, 5, 5, 0.97)',
        borderLeft: '1px solid #1a8c1a',
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        transition: 'right 0.3s ease',
        boxShadow: open ? '-4px 0 20px rgba(0, 0, 0, 0.8)' : 'none',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1a3a1a',
          background: 'rgba(10, 25, 10, 0.8)',
        }}>
          <div style={{
            fontSize: '0.85rem',
            letterSpacing: '4px',
            color: '#33ff33',
            textShadow: '0 0 10px rgba(51, 255, 51, 0.4)',
            marginBottom: '4px',
          }}>
            UBIQUITOUS SURVEILLANCE
          </div>
          <div style={{
            fontSize: '0.6rem',
            color: '#1a8c1a',
            letterSpacing: '2px',
          }}>
            SIGNAL INTELLIGENCE • DIPLOMATIC INTERCEPTS • COVERT OPS
          </div>
        </div>

        {/* Filter bar */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '8px 12px',
          borderBottom: '1px solid #1a3a1a',
          flexWrap: 'wrap',
        }}>
          {filterBtn('all', 'ALL')}
          {filterBtn('dm', 'DM')}
          {filterBtn('group', 'GROUP')}
          {filterBtn('country', 'NATL')}
          {filterBtn('covert', 'COVERT')}
        </div>

        {/* Feed */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '8px',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{
              color: '#1a8c1a',
              textAlign: 'center',
              marginTop: '40px',
              fontSize: '0.75rem',
              letterSpacing: '2px',
            }}>
              {messages.length === 0 ? 'NO INTERCEPTS YET' : 'NO MATCHING INTERCEPTS'}
            </div>
          ) : (
            filtered.map((m) => {
              const badge = TYPE_BADGES[m.type] ?? TYPE_BADGES.public;
              const time = new Date(m.timestamp);
              const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

              return (
                <div
                  key={m.id}
                  style={{
                    marginBottom: '6px',
                    padding: '6px 8px',
                    borderLeft: `2px solid ${badge.color}`,
                    background: 'rgba(10, 20, 10, 0.5)',
                    fontSize: '0.75rem',
                    lineHeight: '1.4',
                  }}
                >
                  {/* Meta line */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '3px',
                  }}>
                    <span style={{
                      background: badge.color,
                      color: '#000',
                      padding: '0 4px',
                      fontSize: '0.55rem',
                      fontWeight: 'bold',
                      letterSpacing: '1px',
                    }}>
                      {badge.label}
                    </span>
                    <span style={{ color: '#1a8c1a', fontSize: '0.65rem' }}>
                      {timeStr}
                    </span>
                    {m.from && (
                      <span style={{ color: '#ffaa00', fontSize: '0.7rem', letterSpacing: '1px' }}>
                        {ROLE_LABELS[m.from] ?? m.from.toUpperCase()}
                      </span>
                    )}
                    {m.channel_name && m.type !== 'espionage' && m.type !== 'agreement' && (
                      <span style={{ color: '#1a8c1a', fontSize: '0.6rem' }}>
                        [{m.channel_name}]
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div style={{
                    color: m.type === 'espionage' ? '#ff6b6b'
                      : m.type === 'agreement' ? '#ffaa00'
                      : '#33ff33',
                    wordBreak: 'break-word',
                  }}>
                    {m.content}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Status bar */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid #1a3a1a',
          fontSize: '0.6rem',
          color: '#1a8c1a',
          display: 'flex',
          justifyContent: 'space-between',
          letterSpacing: '1px',
        }}>
          <span>{filtered.length} INTERCEPTS</span>
          <span>{messages.filter(m => m.type === 'espionage').length} ACTIVE OPS</span>
        </div>
      </div>
    </>
  );
}
