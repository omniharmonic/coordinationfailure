import React, { useRef, useEffect } from 'react';

interface WorldEvent {
  id: string;
  tick: number;
  tier: string;
  title: string;
  description: string;
}

const TIER_COLORS: Record<string, string> = {
  tremor: 'var(--crt-green-dim)',
  shock: 'var(--crt-amber)',
  crisis: 'var(--crt-red)',
  catastrophe: '#ff0000',
};

const TIER_LABELS: Record<string, string> = {
  tremor: 'TREMOR',
  shock: 'SHOCK',
  crisis: 'CRISIS',
  catastrophe: '⚠ CATASTROPHE',
};

export function EventTicker({ events, gameEvents }: { events: WorldEvent[]; gameEvents: any[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [events, gameEvents]);

  const allEvents = [
    ...events.map(e => ({ ...e, source: 'world' })),
    ...gameEvents
      .filter(e => e.type === 'game_ending' || e.type === 'generation_reached')
      .map(e => ({
        id: `ge_${e.tick}`,
        tick: e.tick,
        tier: e.type === 'game_ending' ? 'crisis' : 'shock',
        title: e.type === 'game_ending'
          ? `${e.leading_company?.toUpperCase()} APPROACHING AGI (${e.capability?.toFixed(0)})`
          : `${e.company_id?.toUpperCase()} REACHED GEN ${e.generation}`,
        description: '',
        source: 'game',
      })),
  ].sort((a, b) => a.tick - b.tick);

  return (
    <div style={{
      borderTop: '1px solid var(--crt-border)',
      background: 'var(--crt-bg-light)',
      padding: '6px 12px',
      minHeight: '60px',
      maxHeight: '80px',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '4px',
      }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--crt-text-dim)', letterSpacing: '2px' }}>
          WORLD EVENTS
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--crt-text-dim)' }}>
          ({allEvents.length})
        </span>
      </div>
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: '16px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          fontSize: '0.8rem',
        }}
      >
        {allEvents.length === 0 ? (
          <span style={{ color: 'var(--crt-text-dim)' }}>NO EVENTS YET • MONITORING...</span>
        ) : (
          allEvents.slice(-20).map(event => (
            <span key={event.id} style={{ color: TIER_COLORS[event.tier] ?? 'var(--crt-text)' }}>
              [{TIER_LABELS[event.tier] ?? String(event.tier ?? 'INFO').toUpperCase()}] {event.title}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
