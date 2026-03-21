import React from 'react';
import { useSound } from '../hooks/useSound.js';

/**
 * Minimal sound toggle button — positioned absolute top-right.
 * Uses CRT green text styling.
 */
export function SoundToggle() {
  const { enabled, setEnabled, playKeyClick } = useSound();

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    // Play a click after enabling so user gets immediate feedback
    if (next) {
      // Small delay so the AudioContext has time to initialize
      setTimeout(() => playKeyClick(), 50);
    }
  };

  return (
    <button
      onClick={toggle}
      title={enabled ? 'Mute sounds' : 'Enable sounds'}
      style={{
        position: 'fixed',
        top: '6px',
        right: '8px',
        zIndex: 9999,
        background: 'transparent',
        border: '1px solid var(--crt-border)',
        color: enabled ? 'var(--crt-green)' : 'var(--crt-green-dim, #1a3a1a)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.7rem',
        padding: '3px 8px',
        cursor: 'pointer',
        letterSpacing: '1px',
        lineHeight: 1.2,
      }}
    >
      {enabled ? 'SOUND ON' : 'SOUND OFF'}
    </button>
  );
}
