import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { AppShell } from '@/components/common/AppShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ChatPage } from '@/routes/ChatPage';
import { CardsPage } from '@/routes/CardsPage';
import { BoardsPage } from '@/routes/BoardsPage';
import { SettingsPage } from '@/routes/SettingsPage';

const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

/**
 * Native runs at capacitor://localhost/ (iOS) or https://localhost/ (Android),
 * where the '/assistant' basename never matches — and Android WebView >= 117
 * refuses path changes on custom schemes, so pushState routing is out. Hash
 * routing sidesteps both, and survives a cold start that would otherwise land
 * on a path with no file behind it.
 *
 * useLocation().pathname is unchanged under HashRouter, so useChatNavigation
 * and MicAnchor's route checks keep working as-is.
 */
const IS_NATIVE = Capacitor.isNativePlatform();
const Router = IS_NATIVE ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router basename={IS_NATIVE ? undefined : ROUTER_BASE}>
      <ErrorBoundary>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<ChatPage />} />
            <Route path="cards" element={<CardsPage />} />
            <Route path="cards/:id" element={<CardsPage />} />
            <Route path="boards" element={<BoardsPage />} />
            <Route path="boards/:id" element={<BoardsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}
