import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { LoadingScreen } from './components/LoadingScreen.js';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen message="INITIALIZING SYSTEM..." />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
