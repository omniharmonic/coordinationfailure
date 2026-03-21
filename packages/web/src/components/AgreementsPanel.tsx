import React from 'react';

interface Agreement {
  id?: string;
  parties: string[];
  type: string;
  status: string;
  description?: string;
}

export function AgreementsPanel({ agreements }: { agreements: Agreement[] }) {
  const statusColor = (status: string) => {
    if (status === 'violated' || status === 'broken') return 'var(--crt-red)';
    if (status === 'active' || status === 'honored') return 'var(--crt-green)';
    if (status === 'pending') return 'var(--crt-amber)';
    return 'var(--crt-text-dim)';
  };

  return (
    <div className="panel agreements-panel" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      <div className="panel-header" style={{ marginBottom: '4px' }}>
        AGREEMENTS
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        fontSize: '0.75rem',
      }}>
        {(!agreements || agreements.length === 0) ? (
          <div style={{ color: 'var(--crt-text-dim)', padding: '4px 0' }}>
            NO ACTIVE AGREEMENTS
          </div>
        ) : (
          agreements.map((a, i) => (
            <div
              key={`${a.id ?? ''}_${i}`}
              style={{
                padding: '3px 0',
                borderBottom: '1px solid var(--crt-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--crt-amber)', letterSpacing: '1px' }}>
                  {a.type?.toUpperCase()}
                </span>
                <span style={{ color: 'var(--crt-text-dim)', margin: '0 4px' }}>—</span>
                <span style={{ color: 'var(--crt-text-dim)' }}>
                  {a.parties?.map(p => p.toUpperCase()).join(' / ')}
                </span>
              </div>
              <span style={{
                color: statusColor(a.status),
                letterSpacing: '1px',
                fontSize: '0.7rem',
                flexShrink: 0,
              }}>
                {a.status?.toUpperCase()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
