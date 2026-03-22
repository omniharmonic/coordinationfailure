import React, { useState, useEffect, useRef } from 'react';

interface SurveillanceMessage {
  id: string;
  type: 'dm' | 'group' | 'country' | 'public' | 'espionage' | 'agreement';
  from?: string;
  content: string;
  timestamp: number;
  channel_name?: string;
  participants?: string[];
  target?: string;
  status?: string;
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

// Extract readable participants from channel name like "DM: titan, openbrain"
function formatChannelParticipants(channelName: string, fromRole?: string): string {
  const match = channelName.match(/^(?:DM|Group): (.+)$/i);
  if (!match) return '';
  const participants = match[1].split(',').map(p => p.trim());
  // Show the "TO" side — filter out the sender
  const others = participants
    .filter(p => p !== fromRole)
    .map(p => ROLE_LABELS[p] ?? p.toUpperCase());
  return others.length > 0 ? `→ ${others.join(', ')}` : '';
}

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
  const [covertOpsCount, setCovertOpsCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Refs to avoid stale closures — these change frequently but shouldn't restart the polling interval
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!gameId) return;

    async function fetchAll() {
      try {
        // Fetch messages and covert ops in parallel
        const [msgRes, covertRes] = await Promise.all([
          fetch(`/api/games/${gameId}/messages/all`).catch(() => null),
          fetch(`/api/games/${gameId}/covert`).catch(() => null),
        ]);

        const mapped: SurveillanceMessage[] = [];

        // Process messages
        if (msgRes?.ok) {
          const data = await msgRes.json();
          for (const m of data as any[]) {
            if (m.channel_type === 'public') continue;
            mapped.push({
              id: m.id,
              type: m.channel_type === 'dm' ? 'dm' : m.channel_type === 'group' ? 'group' : m.channel_type === 'country' ? 'country' : 'public',
              from: m.from,
              content: m.content,
              timestamp: m.timestamp,
              channel_name: m.channel_name,
            });
          }
        }

        // Process covert operations (espionage)
        let activeOps = 0;
        if (covertRes?.ok) {
          const covertData = await covertRes.json();
          for (const op of covertData as any[]) {
            if (op.type === 'espionage_active') {
              activeOps++;
              mapped.push({
                id: `esp-active-${op.initiator_id}-${op.target_id}`,
                type: 'espionage',
                from: op.initiator_id,
                content: `ACTIVE OPERATION targeting ${ROLE_LABELS[op.target_id] ?? op.target_id} — ${op.ticks_remaining}/${op.ticks_total} ticks remaining${op.detected ? ' ⚠ DETECTED' : ''}`,
                timestamp: op.timestamp,
                target: op.target_id,
                status: op.detected ? 'detected' : 'covert',
              });
            } else if (op.type === 'espionage_completed') {
              mapped.push({
                id: `esp-done-${op.operation_id ?? op.tick}`,
                type: 'espionage',
                from: op.initiator_id ?? op.government_id,
                content: `OPERATION ${op.success ? 'SUCCESSFUL' : 'FAILED'}${op.detected ? ' — DETECTED by target' : ' — undetected'} (tick ${op.tick})`,
                timestamp: op.timestamp,
                target: op.target_id,
                status: op.success ? 'success' : 'failed',
              });
            }
          }
        }
        setCovertOpsCount(activeOps);

        // Add agreement events from current game state (via ref to avoid dependency)
        const currentState = gameStateRef.current;
        if (currentState?.agreements) {
          for (const ag of currentState.agreements) {
            if (ag.status === 'pending') {
              mapped.push({
                id: `ag-${ag.id}`,
                type: 'agreement',
                from: ag.proposed_by,
                content: `PROPOSAL: ${ag.type?.replace(/_/g, ' ').toUpperCase()} — awaiting: ${(ag.pending_acceptances ?? []).map((p: string) => ROLE_LABELS[p] ?? p).join(', ')}`,
                timestamp: Date.now() - ((currentState.world?.tick_count - ag.proposed_at_tick) * 2000),
                agreement_type: ag.type,
                parties: ag.parties,
              });
            }
            if (ag.status === 'active') {
              mapped.push({
                id: `ag-a-${ag.id}`,
                type: 'agreement',
                from: ag.proposed_by,
                content: `ACTIVE: ${ag.type?.replace(/_/g, ' ').toUpperCase()} — parties: ${(ag.parties ?? []).map((p: string) => ROLE_LABELS[p] ?? p).join(', ')}`,
                timestamp: Date.now() - ((currentState.world?.tick_count - (ag.activated_at_tick ?? ag.proposed_at_tick)) * 2000),
                agreement_type: ag.type,
                parties: ag.parties,
              });
            }
            if (ag.status === 'violated') {
              mapped.push({
                id: `ag-v-${ag.id}`,
                type: 'agreement',
                from: ag.violator_id ?? ag.proposed_by,
                content: `⚠ VIOLATION: ${ag.type?.replace(/_/g, ' ').toUpperCase()} breached`,
                timestamp: Date.now(),
                agreement_type: ag.type,
                parties: ag.parties,
              });
            }
          }
        }

        // Sort by timestamp, keep only the last 200 entries
        mapped.sort((a, b) => a.timestamp - b.timestamp);
        const capped = mapped.slice(-200);
        setMessages(capped);

        // Track unread
        if (!openRef.current && capped.length > prevCountRef.current) {
          setUnreadCount(c => c + (capped.length - prevCountRef.current));
        }
        prevCountRef.current = capped.length;
      } catch (_e) { /* ignore */ }
    }

    fetchAll();
    const interval = setInterval(fetchAll, 4000);
    return () => clearInterval(interval);
  }, [gameId]);

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
        fontSize: '0.7rem',
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
              const toLabel = m.channel_name ? formatChannelParticipants(m.channel_name, m.from) : '';

              return (
                <div
                  key={m.id}
                  style={{
                    marginBottom: '6px',
                    padding: '6px 8px',
                    borderLeft: `2px solid ${badge.color}`,
                    background: 'rgba(10, 20, 10, 0.5)',
                    fontSize: '0.8rem',
                    lineHeight: '1.4',
                  }}
                >
                  {/* Meta line */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '3px',
                    flexWrap: 'wrap',
                  }}>
                    <span style={{
                      background: badge.color,
                      color: '#000',
                      padding: '1px 5px',
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                      letterSpacing: '1px',
                      whiteSpace: 'nowrap',
                    }}>
                      {badge.label}
                    </span>
                    <span style={{ color: '#1a8c1a', fontSize: '0.7rem' }}>
                      {timeStr}
                    </span>
                    {m.from && (
                      <span style={{ color: '#ffaa00', fontSize: '0.75rem', letterSpacing: '1px' }}>
                        {ROLE_LABELS[m.from] ?? m.from.toUpperCase()}
                      </span>
                    )}
                    {toLabel && (
                      <span style={{ color: '#6bcbff', fontSize: '0.7rem', letterSpacing: '1px' }}>
                        {toLabel}
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
          fontSize: '0.65rem',
          color: '#1a8c1a',
          display: 'flex',
          justifyContent: 'space-between',
          letterSpacing: '1px',
        }}>
          <span>{filtered.length} INTERCEPTS</span>
          <span style={{ color: covertOpsCount > 0 ? '#ff3333' : '#1a8c1a' }}>
            {covertOpsCount} ACTIVE OPS
          </span>
        </div>
      </div>
    </>
  );
}
