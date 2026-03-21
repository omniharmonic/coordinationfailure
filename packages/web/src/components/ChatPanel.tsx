import React, { useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  from: string;
  content: string;
  timestamp: number;
}

export function ChatPanel({ gameId }: { gameId: string }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/games/${gameId}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setMessages(data);
        }
      } catch (_e) { /* ignore */ }
    };

    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gameId]);

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
    <div className="panel chat-panel" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      <div className="panel-header" style={{ marginBottom: '4px' }}>
        PUBLIC BROADCAST
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontSize: '0.75rem',
          lineHeight: '1.5',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: 'var(--crt-text-dim)', padding: '4px 0' }}>
            NO BROADCASTS YET • MONITORING CHANNEL...
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} style={{ padding: '2px 0', borderBottom: '1px solid var(--crt-border)' }}>
              <span style={{ color: 'var(--crt-text-dim)', marginRight: '6px' }}>
                {formatTime(msg.timestamp)}
              </span>
              <span style={{ color: 'var(--crt-amber)', marginRight: '6px', letterSpacing: '1px' }}>
                {msg.from?.toUpperCase()}:
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
