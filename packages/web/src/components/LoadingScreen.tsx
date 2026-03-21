import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'VT323', 'Share Tech Mono', 'Courier New', monospace",
        color: '#33ff33',
      }}
    >
      <div
        style={{
          fontSize: '2rem',
          letterSpacing: '4px',
          textTransform: 'uppercase',
          textShadow: '0 0 10px rgba(51, 255, 51, 0.4)',
          animation: 'blink 1s step-end infinite',
        }}
      >
        LOADING...
      </div>

      {message && (
        <div
          style={{
            marginTop: '16px',
            fontSize: '1rem',
            color: '#1a8c1a',
            letterSpacing: '2px',
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
