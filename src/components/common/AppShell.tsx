import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useLibraryStore } from '@/store/libraryStore';
import { useEffect } from 'react';
import { useChatNavigation } from '@/hooks/useChatNavigation';

export function AppShell() {
  const { t } = useTranslation();
  const init = useLibraryStore((s) => s.init);
  const setOnline = useLibraryStore((s) => s.setOnline);
  const online = useLibraryStore((s) => s.online);
  const pendingOps = useLibraryStore((s) => s.pendingOps);

  useChatNavigation();

  useEffect(() => {
    void init();
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, [init, setOnline]);

  return (
    <div className="flex flex-col h-full">
      <header className="pt-safe px-4 py-2 flex items-center justify-between border-b border-navy-soft bg-navy/90 backdrop-blur">
        <h1 className="font-serif text-lg tracking-wide text-gold">
          {t('app.title')}
        </h1>
        <div className="text-xs text-cream-dim flex items-center gap-2">
          <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')} />
          {online ? t('common.online') : t('common.offline')}
          {pendingOps > 0 && (
            <span className="ml-1 text-amber-400">{t('common.pending', { count: pendingOps })}</span>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </main>

      <nav className="pb-safe border-t border-navy-soft bg-navy grid grid-cols-4">
        <NavTab to="/" label={t('nav.chat')} />
        <NavTab to="/cards" label={t('nav.cards')} />
        <NavTab to="/boards" label={t('nav.boards')} />
        <NavTab to="/settings" label={t('nav.settings')} />
      </nav>
    </div>
  );
}

function NavTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        clsx(
          'text-center py-3 text-sm transition-colors',
          isActive ? 'text-gold' : 'text-cream-dim hover:text-cream',
        )
      }
    >
      {label}
    </NavLink>
  );
}
