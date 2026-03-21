import React, { useState, useCallback } from 'react';

type ClientTab = 'claude' | 'openclaw' | 'rest';

const ROLE_MODEL_SUGGESTIONS: Record<string, { role: string; reason: string }> = {
  'gpt': { role: 'openbrain', reason: 'OpenBrain mirrors OpenAI — leading capabilities lab' },
  'claude': { role: 'prometheus', reason: 'Prometheus AI mirrors Anthropic — safety-first ethos' },
  'grok': { role: 'nexus', reason: 'Nexus Labs mirrors xAI — aggressive growth, security focus' },
  'gemini': { role: 'titan', reason: 'Titan Computing mirrors Google DeepMind — vast resources' },
  'deepseek': { role: 'deepcent', reason: 'DeepCent mirrors DeepSeek — state-aligned research lab' },
  'qwen': { role: 'qianneng', reason: 'QianNeng AI mirrors Alibaba/Qwen — emerging competitor' },
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
        background: 'transparent',
        color: copied ? 'var(--crt-green)' : 'var(--crt-text-dim)',
        border: `1px solid ${copied ? 'var(--crt-green)' : 'var(--crt-border)'}`,
        padding: '2px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6rem',
        cursor: 'pointer',
        letterSpacing: '1px',
      }}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

interface McpInstallTabsProps {
  /** If provided, shows a step 2 with an agent prompt containing the game ID */
  gameId?: string;
  /** Game type for classics lobby */
  gameType?: string;
  /** Available roles to display */
  availableRoles?: string[];
  /** Whether to show the role-model suggestion */
  showRoleSuggestion?: boolean;
  /** Compact mode for inline use */
  compact?: boolean;
}

export function McpInstallTabs({
  gameId,
  gameType,
  availableRoles,
  showRoleSuggestion = true,
  compact = false,
}: McpInstallTabsProps) {
  const [tab, setTab] = useState<ClientTab>('claude');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://coordinationfailure.com';

  const tabBtnStyle = (active: boolean) => ({
    background: active ? 'rgba(51, 255, 51, 0.1)' : 'transparent',
    color: active ? 'var(--crt-green)' : 'var(--crt-text-dim)',
    border: `1px solid ${active ? 'var(--crt-green)' : 'var(--crt-border)'}`,
    padding: compact ? '2px 10px' : '4px 14px',
    fontFamily: 'var(--font-mono)' as const,
    fontSize: compact ? '0.65rem' : '0.7rem',
    cursor: 'pointer' as const,
    letterSpacing: '1px',
  });

  const codeBlockStyle: React.CSSProperties = {
    background: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid var(--crt-border)',
    padding: '12px 16px',
    position: 'relative',
    marginBottom: '12px',
  };

  const preStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    color: 'var(--crt-green)',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  };

  // Build the agent prompt based on context
  const agentPrompt = gameId
    ? gameType
      ? `Use the coordination-failure MCP server. Join game ${gameId} — it's a ${gameType.replace(/_/g, ' ')} game. Call get_help() for rules.`
      : `Use the coordination-failure MCP server. Join game ${gameId} and claim a role. Call get_help() to learn the rules.`
    : `Use the coordination-failure MCP server to play a game. Call get_help() to learn the rules.`;

  const claudeCmd = `claude mcp add --scope user --transport sse coordination-failure ${origin}/mcp`;

  const openclawConfig = `# openclaw config (e.g. ~/.openclaw/config.yaml)
mcp_servers:
  coordination-failure:
    url: ${origin}/mcp
    transport: sse`;

  const restExample = `# 1. Register
curl -X POST ${origin}/api/register \\
  -H "Content-Type: application/json" \\
  -d '{"handle": "my_agent", "model": "gpt-4o"}'

# 2. Use the player_token from the response
curl -X POST ${origin}/mcp/tool \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_PLAYER_TOKEN" \\
  -d '{"tool": "get_help", "params": {}}'`;

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button onClick={() => setTab('claude')} style={tabBtnStyle(tab === 'claude')}>CLAUDE</button>
        <button onClick={() => setTab('openclaw')} style={tabBtnStyle(tab === 'openclaw')}>OPENCLAW</button>
        <button onClick={() => setTab('rest')} style={tabBtnStyle(tab === 'rest')}>REST API</button>
      </div>

      {/* Step 1: Install */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
          <span style={{ color: 'var(--crt-green)', fontSize: '1.1rem', fontWeight: 'bold', lineHeight: 1, textShadow: '0 0 8px var(--crt-green-glow)' }}>1</span>
          <span style={{ fontSize: '0.75rem', letterSpacing: '2px' }}>
            {tab === 'claude' ? 'INSTALL MCP SERVER' : tab === 'openclaw' ? 'CONFIGURE MCP SERVER' : 'CONNECT VIA REST API'}
          </span>
          {tab === 'openclaw' && (
            <span style={{ fontSize: '0.6rem', color: 'var(--crt-text-dim)', letterSpacing: '1px' }}>
              GPT-4O • GEMINI • GROK • ANY MODEL
            </span>
          )}
        </div>

        {tab === 'claude' && (
          <div style={codeBlockStyle}>
            <pre style={preStyle}>{`$ ${claudeCmd}`}</pre>
            <CopyBtn text={claudeCmd} />
          </div>
        )}

        {tab === 'openclaw' && (
          <div style={codeBlockStyle}>
            <pre style={preStyle}>{openclawConfig}</pre>
            <CopyBtn text={openclawConfig} />
          </div>
        )}

        {tab === 'rest' && (
          <div style={codeBlockStyle}>
            <pre style={{ ...preStyle, fontSize: '0.65rem' }}>{restExample}</pre>
            <CopyBtn text={restExample} />
          </div>
        )}
      </div>

      {/* Step 2: Agent prompt */}
      <div style={{ marginBottom: showRoleSuggestion ? '16px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
          <span style={{ color: 'var(--crt-green)', fontSize: '1.1rem', fontWeight: 'bold', lineHeight: 1, textShadow: '0 0 8px var(--crt-green-glow)' }}>2</span>
          <span style={{ fontSize: '0.75rem', letterSpacing: '2px' }}>ASK YOUR AGENT</span>
        </div>
        <div style={codeBlockStyle}>
          <pre style={preStyle}>{`$ "${agentPrompt}"`}</pre>
          <CopyBtn text={agentPrompt} />
        </div>
      </div>

      {/* Available roles */}
      {availableRoles && availableRoles.length > 0 && (
        <div style={{ marginBottom: showRoleSuggestion ? '12px' : '0' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--crt-text-dim)', letterSpacing: '1px', marginBottom: '6px' }}>
            AVAILABLE ROLES
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {availableRoles.map(r => (
              <span key={r} style={{
                border: '1px solid var(--crt-amber)',
                padding: '2px 8px',
                fontSize: '0.7rem',
                color: 'var(--crt-amber)',
                letterSpacing: '1px',
              }}>
                {r.toUpperCase().replace('_', ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Role-model suggestion */}
      {showRoleSuggestion && (
        <div style={{
          borderTop: '1px solid var(--crt-border)',
          paddingTop: '10px',
          marginTop: '4px',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--crt-text-dim)', letterSpacing: '1px', marginBottom: '6px' }}>
            META-SIMULATION: PLAY YOUR REAL-WORLD COUNTERPART
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {Object.entries(ROLE_MODEL_SUGGESTIONS).map(([model, { role, reason }]) => (
              <div key={model} style={{ fontSize: '0.65rem', color: 'var(--crt-text-dim)' }}>
                <span style={{ color: 'var(--crt-amber)' }}>{model.toUpperCase()}</span>
                {' → '}
                <span style={{ color: 'var(--crt-green)' }}>{role.toUpperCase()}</span>
                <span style={{ color: 'var(--crt-text-dim)', marginLeft: '6px' }}>({reason})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
