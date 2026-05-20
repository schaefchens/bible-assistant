import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/common/AppShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ChatPage } from '@/routes/ChatPage';
import { CardsPage } from '@/routes/CardsPage';
import { BoardsPage } from '@/routes/BoardsPage';
import { SettingsPage } from '@/routes/SettingsPage';

const ROUTER_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <BrowserRouter basename={ROUTER_BASE}>
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
    </BrowserRouter>
  );
}
