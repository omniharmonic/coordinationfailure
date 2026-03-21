import React from 'react';
import { useSound } from '../hooks/useSound.js';

/**
 * Sound toggle button — renders inline (not fixed-position).
 * Parent component controls placement.
 */
export function SoundToggle() {
  const { enabled, setEnabled, playKeyClick } = useSound();

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      setTimeout(() => playKeyClick(), 50);
    }
  };

  return (
    <button
      onClick={toggle}
      title={enabled ? 'Mute sounds' : 'Enable sounds'}
      style={{
        background: 'transparent',
        border: '1px solid var(--crt-border)',
        color: enabled ? 'var(--crt-green)' : 'var(--crt-green-dim, #1a3a1a)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.7rem',
        padding: '3px 8px',
        cursor: 'pointer',
        letterSpacing: '1px',
        lineHeight: 1.2,
        flexShrink: 0,
      }}
    >
      {enabled ? 'SOUND ON' : 'SOUND OFF'}
    </button>
  );
}
