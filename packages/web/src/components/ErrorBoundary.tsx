import React, { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[CF] Render error:', error, errorInfo);
  }

  handleRetry = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
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
            color: '#ff3333',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              border: '2px solid #ff3333',
              padding: '32px',
              maxWidth: '600px',
              width: '100%',
              boxShadow: '0 0 20px rgba(255, 51, 51, 0.3)',
            }}
          >
            <h1
              style={{
                fontSize: '2.5rem',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                textShadow: '0 0 10px rgba(255, 51, 51, 0.6)',
                marginBottom: '16px',
                animation: 'blink 1s step-end infinite',
              }}
            >
              SYSTEM ERROR
            </h1>

            <div
              style={{
                borderTop: '1px solid #8c1a1a',
                borderBottom: '1px solid #8c1a1a',
                padding: '16px 0',
                margin: '16px 0',
                color: '#ff6666',
                fontSize: '1rem',
                lineHeight: '1.6',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ color: '#8c1a1a', fontSize: '0.8rem', marginBottom: '8px', letterSpacing: '2px' }}>
                ERROR OUTPUT:
              </div>
              {this.state.error?.message || 'An unknown error occurred'}
            </div>

            <div
              style={{
                color: '#8c1a1a',
                fontSize: '0.8rem',
                marginBottom: '24px',
                letterSpacing: '1px',
              }}
            >
              A STRANGE GAME. THE ONLY WINNING MOVE IS TO RETRY.
            </div>

            <button
              onClick={this.handleRetry}
              style={{
                background: 'transparent',
                border: '2px solid #ff3333',
                color: '#ff3333',
                fontFamily: "'VT323', 'Share Tech Mono', 'Courier New', monospace",
                fontSize: '1.2rem',
                padding: '10px 32px',
                letterSpacing: '3px',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#ff3333';
                e.currentTarget.style.color = '#0a0a0a';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 51, 51, 0.5)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#ff3333';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              [ RETRY ]
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
