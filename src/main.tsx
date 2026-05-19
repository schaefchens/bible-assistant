import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import App from './App';
import { getOrCreateIdentity } from './lib/identity';

// Pre-warm identity so headers are ready on first fetch
getOrCreateIdentity();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
