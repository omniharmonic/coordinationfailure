import React, { useState, lazy, Suspense } from 'react';
import { Boot } from './pages/Boot.js';
import { GameSelect } from './pages/GameSelect.js';
import { Lobby } from './pages/Lobby.js';
import { Spectator } from './pages/Spectator.js';

// Lazy-load pages that aren't needed immediately
const ClassicsLobby = lazy(() => import('./pages/ClassicsLobby.js').then(m => ({ default: m.ClassicsLobby })));
const ClassicsSpectator = lazy(() => import('./pages/ClassicsSpectator.js').then(m => ({ default: m.ClassicsSpectator })));
const Leaderboard = lazy(() => import('./pages/Leaderboard.js').then(m => ({ default: m.Leaderboard })));
const Replay = lazy(() => import('./pages/Replay.js').then(m => ({ default: m.Replay })));
const Reports = lazy(() => import('./pages/Reports.js').then(m => ({ default: m.Reports })));

type Page =
  | 'boot'
  | 'select'
  | 'lobby'
  | 'spectator'
  | 'classics_lobby'
  | 'classics_spectator'
  | 'leaderboard'
  | 'replay'
  | 'reports';

const Loading = () => (
  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    LOADING MODULE...
  </div>
);

export function App() {
  const [page, setPage] = useState<Page>('boot');
  const [gameId, setGameId] = useState<string | null>(null);
  const [classicGameType, setClassicGameType] = useState<string>('prisoners_dilemma');

  const navigateToReplay = (id: string) => {
    setGameId(id);
    setPage('replay');
  };

  return (
    <>
      <div className="crt-overlay" />

      {page === 'boot' && (
        <Boot onComplete={() => setPage('select')} />
      )}

      {page === 'select' && (
        <GameSelect onSelect={(choice) => {
          if (choice === 'ai_dilemma') setPage('lobby');
          if (choice === 'classics') setPage('classics_lobby');
          if (choice === 'leaderboard') setPage('leaderboard');
          if (choice === 'knowledge') setPage('reports');
        }} />
      )}

      {page === 'lobby' && (
        <Lobby
          onSpectate={(id) => { setGameId(id); setPage('spectator'); }}
          onBack={() => setPage('select')}
        />
      )}

      {page === 'spectator' && gameId && (
        <Spectator
          gameId={gameId}
          onBack={() => setPage('lobby')}
          onReplay={() => navigateToReplay(gameId)}
        />
      )}

      {page === 'classics_lobby' && (
        <Suspense fallback={<Loading />}>
          <ClassicsLobby
            onSpectate={(id, type) => {
              setGameId(id);
              setClassicGameType(type);
              setPage('classics_spectator');
            }}
            onBack={() => setPage('select')}
          />
        </Suspense>
      )}

      {page === 'classics_spectator' && gameId && (
        <Suspense fallback={<Loading />}>
          <ClassicsSpectator
            gameId={gameId}
            gameType={classicGameType}
            onBack={() => setPage('classics_lobby')}
          />
        </Suspense>
      )}

      {page === 'leaderboard' && (
        <Suspense fallback={<Loading />}>
          <Leaderboard onBack={() => setPage('select')} />
        </Suspense>
      )}

      {page === 'replay' && gameId && (
        <Suspense fallback={<Loading />}>
          <Replay gameId={gameId} onBack={() => setPage('lobby')} />
        </Suspense>
      )}

      {page === 'reports' && (
        <Suspense fallback={<Loading />}>
          <Reports onBack={() => setPage('select')} />
        </Suspense>
      )}
    </>
  );
}
