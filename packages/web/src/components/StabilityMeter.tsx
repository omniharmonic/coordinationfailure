import React from 'react';

export function StabilityMeter({ stability = 0 }: { stability: number }) {
  const color = stability > 60 ? 'var(--crt-green)' : stability > 30 ? 'var(--crt-amber)' : 'var(--crt-red)';
  const label = stability > 60 ? 'STABLE' : stability > 30 ? 'UNSTABLE' : 'CRITICAL';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--crt-text-dim)' }}>STABILITY:</span>
      <div style={{
        width: '80px',
        height: '10px',
        background: 'var(--crt-bg)',
        border: '1px solid var(--crt-border)',
        position: 'relative',
      }}>
        <div style={{
          width: `${stability}%`,
          height: '100%',
          background: color,
          boxShadow: `0 0 6px ${color}`,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{
        fontSize: '0.75rem',
        color,
        letterSpacing: '1px',
        animation: stability < 30 ? 'blink 1s step-end infinite' : 'none',
      }}>
        {(stability ?? 0).toFixed(0)}% {label}
      </span>
    </div>
  );
}
