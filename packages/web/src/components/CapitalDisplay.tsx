import React from 'react';

interface CompanyValuation {
  id: string;
  name: string;
  country: string;
  public_valuation: number;
  capital_reserves: number;
}

interface CapitalDisplayProps {
  companies: Record<string, CompanyValuation>;
  marketSentiment: number;
}

export function CapitalDisplay({ companies, marketSentiment }: CapitalDisplayProps) {
  const companyList = Object.values(companies);
  const totalPool = companyList.reduce((sum, c) => sum + (c?.capital_reserves ?? 0), 0);
  const maxValuation = Math.max(...companyList.map(c => c?.public_valuation ?? 0), 1);

  const sentimentColor = marketSentiment > 60
    ? 'var(--crt-green)'
    : marketSentiment > 30
      ? 'var(--crt-amber)'
      : 'var(--crt-red)';

  const sentimentGlow = marketSentiment > 60
    ? 'var(--crt-green-glow)'
    : marketSentiment > 30
      ? 'var(--crt-amber-glow)'
      : 'var(--crt-red-glow)';

  return (
    <div className="panel" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      <div className="panel-header" style={{ marginBottom: '4px' }}>
        CAPITAL MARKETS
      </div>

      {/* Summary stats */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.75rem',
        marginBottom: '8px',
      }}>
        <div>
          <span style={{ color: 'var(--crt-text-dim)' }}>TOTAL POOL: </span>
          <span>${totalPool?.toFixed(0)}B</span>
        </div>
        <div>
          <span style={{ color: 'var(--crt-text-dim)' }}>SENTIMENT: </span>
          <span style={{ color: sentimentColor, textShadow: `0 0 6px ${sentimentGlow}` }}>
            {(marketSentiment ?? 0).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Mini bar chart of valuations */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'flex-end',
        gap: '6px',
        minHeight: '60px',
        padding: '4px 0',
      }}>
        {companyList.map(c => {
          const pct = Math.max(2, ((c?.public_valuation ?? 0) / maxValuation) * 100);
          const barColor = c.country === 'us' ? 'var(--crt-green)' : 'var(--crt-amber)';
          const barGlow = c.country === 'us' ? 'var(--crt-green-glow)' : 'var(--crt-amber-glow)';

          return (
            <div key={c.id} style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              height: '100%',
              justifyContent: 'flex-end',
            }}>
              <div style={{
                fontSize: '0.65rem',
                color: 'var(--crt-text-dim)',
                marginBottom: '2px',
                whiteSpace: 'nowrap',
              }}>
                ${(c?.public_valuation ?? 0).toFixed(0)}B
              </div>
              <div style={{
                width: '100%',
                height: `${pct}%`,
                background: barColor,
                boxShadow: `0 0 6px ${barGlow}`,
                minHeight: '2px',
                transition: 'height 0.5s ease',
              }} />
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--crt-text-dim)',
                marginTop: '3px',
                textAlign: 'center',
                letterSpacing: '0.5px',
                whiteSpace: 'nowrap',
                overflow: 'visible',
              }}>
                {c.name?.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
