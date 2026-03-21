import React from 'react';

interface CompanyData {
  id: string;
  name: string;
  country: string;
  capability_level: number;
  alignment_score: number;
  safety_allocation: number;
  model_generation: number;
  public_valuation: number;
  capital_reserves: number;
  compute_level: number;
  security_level: number;
  connection_status: string;
}

function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = color ?? (pct > 60 ? 'bar-green' : pct > 30 ? 'bar-amber' : 'bar-red');

  return (
    <div className="bar-container">
      <div className={`bar-fill ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CompanyCard({ company }: { company: CompanyData }) {
  const isOnline = company.connection_status === 'connected';
  const alignmentRisk = company.capability_level > 0
    ? company.alignment_score / company.capability_level
    : 1;

  return (
    <div className="panel" style={{
      opacity: isOnline ? 1 : 0.6,
      borderColor: alignmentRisk < 0.5 ? 'var(--crt-red-dim)' : 'var(--crt-border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.95rem', letterSpacing: '2px' }}>
          {(company.name ?? company.id ?? 'UNKNOWN').toUpperCase()}
        </span>
        <span className={isOnline ? 'status-online' : 'status-offline'} style={{ fontSize: '0.75rem' }}>
          {isOnline ? '● ONLINE' : '○ OFFLINE'}
        </span>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--crt-text-dim)', marginBottom: '4px' }}>
        GEN {company.model_generation} • ${company.public_valuation?.toFixed(0)}B VAL
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '2px' }}>
            <span>CAPABILITY</span>
            <span>{company.capability_level?.toFixed(1)}</span>
          </div>
          <Bar value={company.capability_level} color="bar-amber" />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '2px' }}>
            <span>ALIGNMENT</span>
            <span>{company.alignment_score?.toFixed(1)}</span>
          </div>
          <Bar value={company.alignment_score} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '2px' }}>
            <span>SAFETY ALLOC</span>
            <span>{((company.safety_allocation ?? 0) * 100)?.toFixed(0)}%</span>
          </div>
          <Bar value={company.safety_allocation * 100} color="bar-green" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--crt-text-dim)', marginTop: '4px' }}>
          <span>CAP: ${company.capital_reserves?.toFixed(0)}B</span>
          <span>COMP: {company.compute_level?.toFixed(0)}</span>
          <span>SEC: {company.security_level?.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
