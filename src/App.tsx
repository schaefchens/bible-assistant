import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/common/AppShell';
import { ChatPage } from '@/routes/ChatPage';
import { CardsPage } from '@/routes/CardsPage';
import { BoardsPage } from '@/routes/BoardsPage';
import { BoardDetailPage } from '@/routes/BoardDetailPage';
import { SettingsPage } from '@/routes/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ChatPage />} />
          <Route path="cards" element={<CardsPage />} />
          <Route path="boards" element={<BoardsPage />} />
          <Route path="boards/:id" element={<BoardDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
