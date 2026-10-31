// apps/web/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { installWebPlatform } from './platform/webPlatform';
import './styles/theme.css';
import { App } from './App';
import { useLearningStore } from './stores/learningStore';

// Initialize core platform adapters and bridge connection to localhost:8766
installWebPlatform();
useLearningStore.getState().initializeSession();
window.addEventListener('pagehide', () => useLearningStore.getState().persistSession());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
