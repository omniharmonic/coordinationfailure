import React from 'react';

interface GovData {
  id: string;
  name: string;
  country: string;
  safety_regulation_level: number;
  nationalization_status: string;
  treasury: number;
  intelligence_budget: number;
  domestic_approval: number;
  connection_status: string;
}

export function GovernmentPanel({ gov }: { gov: GovData }) {
  const isOnline = gov.connection_status === 'connected';

  return (
    <div className="panel" style={{ opacity: isOnline ? 1 : 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.85rem', letterSpacing: '2px', color: 'var(--crt-text-dim)' }}>
          {gov.country === 'us' ? 'US GOVERNMENT' : 'CHINESE GOVERNMENT'}
        </span>
        <span className={isOnline ? 'status-online' : 'status-offline'} style={{ fontSize: '0.7rem' }}>
          {isOnline ? '● ONLINE' : '○ OFFLINE'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', fontSize: '0.75rem' }}>
        <div>
          <div style={{ color: 'var(--crt-text-dim)' }}>REGULATION</div>
          <div style={{ fontSize: '1rem' }}>{((gov.safety_regulation_level ?? 0) * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ color: 'var(--crt-text-dim)' }}>NATIONAL.</div>
          <div style={{ fontSize: '0.85rem', textTransform: 'uppercase' }}>{gov.nationalization_status}</div>
        </div>
        <div>
          <div style={{ color: 'var(--crt-text-dim)' }}>TREASURY</div>
          <div style={{ fontSize: '1rem' }}>${(gov.treasury ?? 0).toFixed(0)}B</div>
        </div>
        <div>
          <div style={{ color: 'var(--crt-text-dim)' }}>APPROVAL</div>
          <div style={{
            fontSize: '1rem',
            color: gov.domestic_approval > 50 ? 'var(--crt-green)' : 'var(--crt-red)',
          }}>
            {(gov.domestic_approval ?? 0).toFixed(0)}%
          </div>
        </div>
      </div>
    </div>
  );
}
