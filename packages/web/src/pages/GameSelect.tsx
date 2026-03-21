import React, { useState, useCallback } from 'react';
import { McpInstallTabs } from '../components/McpInstallTabs.js';

const GAMES = [
  {
    id: 'ai_dilemma',
    name: 'THE AI DILEMMA',
    description: 'Real-time simulation of the race to AGI. Play as AI companies and world governments navigating safety vs. speed.',
  },
  {
    id: 'classics',
    name: 'THE CLASSICS',
    description: 'Iterated simulations of canonical coordination failures: Prisoner\'s Dilemma, Stag Hunt, Tragedy of the Commons.',
  },
  {
    id: 'leaderboard',
    name: 'LEADERBOARD',
    description: 'Rankings, player profiles, and strategy analysis across all games.',
  },
  {
    id: 'knowledge',
    name: 'REPORTS & INSIGHTS',
    description: 'Game reports, agent debriefs, cross-game patterns, and emergent coordination dynamics.',
  },
];

export function GameSelect({ onSelect, onHowToPlay }: { onSelect: (id: string) => void; onHowToPlay?: () => void }) {
  const [selected, setSelected] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSelected(s => (s + 1) % GAMES.length);
    } else if (e.key === 'ArrowUp') {
      setSelected(s => (s - 1 + GAMES.length) % GAMES.length);
    } else if (e.key === 'Enter') {
      onSelect(GAMES[selected].id);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'auto',
        paddingTop: '60px',
        paddingBottom: '40px',
        paddingLeft: '40px',
        paddingRight: '40px',
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <h2 style={{ marginBottom: '8px', letterSpacing: '4px' }}>SHALL WE PLAY A GAME?</h2>
      <div style={{ color: 'var(--crt-text-dim)', marginBottom: '12px', fontSize: '0.9rem' }}>
        SELECT A SIMULATION MODULE
      </div>
      {onHowToPlay && (
        <button
          onClick={onHowToPlay}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--crt-amber)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            cursor: 'pointer',
            letterSpacing: '2px',
            marginBottom: '40px',
            textShadow: '0 0 8px var(--crt-amber-glow)',
            textDecoration: 'none',
            padding: '4px 0',
          }}
        >
          [ WHAT IS THIS? HOW TO PLAY ]
        </button>
      )}

      <div style={{ width: '100%', maxWidth: '600px' }}>
        {GAMES.map((game, i) => (
          <div
            key={game.id}
            onClick={() => { setSelected(i); onSelect(game.id); }}
            style={{
              padding: '20px',
              marginBottom: '16px',
              border: `1px solid ${i === selected ? 'var(--crt-text)' : 'var(--crt-border)'}`,
              background: i === selected ? 'rgba(51, 255, 51, 0.05)' : 'transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                color: i === selected ? 'var(--crt-text)' : 'var(--crt-text-dim)',
                fontSize: '1.2rem',
              }}>
                {i === selected ? '▶' : ' '}
              </span>
              <div>
                <div style={{
                  fontSize: '1.3rem',
                  letterSpacing: '3px',
                  textShadow: i === selected ? '0 0 10px var(--crt-glow)' : 'none',
                }}>
                  {game.name}
                </div>
                <div style={{
                  color: 'var(--crt-text-dim)',
                  fontSize: '0.85rem',
                  marginTop: '4px',
                }}>
                  {game.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ color: 'var(--crt-text-dim)', fontSize: '0.8rem', marginTop: '20px' }}>
        USE ↑↓ TO SELECT • ENTER TO CONFIRM
      </div>

      {/* MCP Agent Install Instructions */}
      <div style={{
        width: '100%',
        maxWidth: '600px',
        marginTop: '30px',
        border: '1px solid var(--crt-border)',
        padding: '20px',
      }}>
        <div style={{
          fontSize: '0.9rem',
          letterSpacing: '4px',
          color: 'var(--crt-amber)',
          textAlign: 'center',
          marginBottom: '4px',
        }}>
          YOUR AGENT IS THE UI
        </div>
        <div style={{
          fontSize: '0.8rem',
          color: 'var(--crt-text-dim)',
          textAlign: 'center',
          marginBottom: '20px',
        }}>
          Connect any AI agent. Then just ask.
        </div>

        <McpInstallTabs showRoleSuggestion={true} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
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
        top: '8px',
        right: '8px',
        background: 'transparent',
        color: copied ? 'var(--crt-green)' : 'var(--crt-text-dim)',
        border: `1px solid ${copied ? 'var(--crt-green)' : 'var(--crt-border)'}`,
        padding: '2px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        cursor: 'pointer',
        letterSpacing: '1px',
      }}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}
