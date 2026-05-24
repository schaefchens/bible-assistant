import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n';
import App from './App';
import { initPwaUpdate } from '@/lib/pwaUpdate';
import { initPlaybackController } from '@/lib/playbackController';
import { initAutoPlay } from '@/lib/autoPlay';

initPwaUpdate();
initPlaybackController();
initAutoPlay();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
