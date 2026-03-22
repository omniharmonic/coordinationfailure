import React, { useRef, useEffect, useState } from 'react';

interface ChatMessage {
  from: string;
  content: string;
  timestamp: number;
}

export function ClassicsChatPanel({ messages }: { messages: ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  return (
    <div className="panel" style={{
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div className="panel-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>PLAYER COMMS</span>
        <span style={{
          fontSize: '0.6rem',
          color: 'var(--crt-cyan, #66ccff)',
          border: '1px solid var(--crt-cyan, #66ccff)',
          padding: '1px 6px',
          letterSpacing: '1px',
        }}>
          LIVE
        </span>
      </div>
      <div
        ref={scrollRef}
        style={{
          maxHeight: '200px',
          overflowY: 'auto',
          fontSize: '0.75rem',
          lineHeight: '1.5',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: 'var(--crt-text-dim)', padding: '8px 0' }}>
            NO MESSAGES YET • MONITORING...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid var(--crt-border)' }}>
              <span style={{ color: 'var(--crt-text-dim)', marginRight: '6px' }}>
                {formatTime(msg.timestamp)}
              </span>
              <span style={{ color: 'var(--crt-amber)', marginRight: '6px', letterSpacing: '1px' }}>
                {msg.from?.slice(0, 8).toUpperCase()}:
              </span>
              <span style={{ color: 'var(--crt-text)' }}>
                {msg.content}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
