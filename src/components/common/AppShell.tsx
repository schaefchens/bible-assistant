import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEffect, useState } from 'react';
import { useChatNavigation } from '@/hooks/useChatNavigation';
import { getPassphrase } from '@/lib/passphrase';
import { PassphraseSetup } from '@/components/onboarding/PassphraseSetup';
import { GlobalMicButton } from '@/components/voice/GlobalMicButton';
import { VoiceOverlay } from '@/components/voice/VoiceOverlay';
import { FloatingPlaybackBar } from '@/components/playback/FloatingPlaybackBar';
import { UpdateBanner } from '@/components/common/UpdateBanner';
import { getAmbientTrackUrl } from '@/services/api/ambient';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export function AppShell() {
  const { t } = useTranslation();
  const [hasPassphrase, setHasPassphrase] = useState(() => !!getPassphrase());
  const init = useLibraryStore((s) => s.init);
  const setOnline = useLibraryStore((s) => s.setOnline);
  const online = useLibraryStore((s) => s.online);
  const pendingOps = useLibraryStore((s) => s.pendingOps);

  useChatNavigation();

  const ambientEnabled = useSettingsStore((s) => s.ambient.enabled);
  const ambientTrackId = useSettingsStore((s) => s.ambient.trackId);

  useEffect(() => {
    if (!hasPassphrase) return;
    void init();
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, [init, setOnline, hasPassphrase]);

  useEffect(() => {
    if (!hasPassphrase) return;
    if (!ambientEnabled || !ambientTrackId) return;
    let cancelled = false;
    void getAmbientTrackUrl(ambientTrackId)
      .then((url) => {
        if (cancelled || !url) return;
        return audioPlayback.ambient.load(url);
      })
      .catch((e) => {
        console.warn('ambient prefetch failed', e);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPassphrase, ambientEnabled, ambientTrackId]);

  if (!hasPassphrase) {
    return <PassphraseSetup onDone={() => setHasPassphrase(true)} />;
  }

  return (
    <div className="flex flex-col h-full pt-safe">
      <UpdateBanner />
      <main className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </main>

      {(!online || pendingOps > 0) && (
        <div className="px-4 py-1 text-xs text-cream-dim flex items-center gap-2 border-t border-navy-soft bg-navy/90">
          <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')} />
          {online ? t('common.online') : t('common.offline')}
          {pendingOps > 0 && (
            <span className="ml-1 text-amber-400">{t('common.pending', { count: pendingOps })}</span>
          )}
        </div>
      )}

      <nav className="pb-safe border-t border-navy-soft bg-navy grid grid-cols-4">
        <NavTab to="/" label={t('nav.chat')} icon={<ChatIcon />} />
        <NavTab to="/cards" label={t('nav.cards')} icon={<CardsIcon />} />
        <NavTab to="/boards" label={t('nav.boards')} icon={<BoardsIcon />} />
        <NavTab to="/settings" label={t('nav.settings')} icon={<SettingsIcon />} />
      </nav>

      <GlobalMicButton />
      <FloatingPlaybackBar />
      <VoiceOverlay />
    </div>
  );
}

function NavTab({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        clsx(
          'relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] tracking-wide transition-colors',
          'before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:h-0.5 before:rounded-b-full before:transition-all',
          isActive
            ? 'text-gold before:w-8 before:bg-gold'
            : 'text-cream-dim hover:text-cream before:w-0 before:bg-transparent',
        )
      }
    >
      <span className="w-5 h-5">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-full h-full',
};

function ChatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      <circle cx="8.5" cy="12" r=".6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r=".6" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="7" y="4" width="13" height="16" rx="2" />
      <path d="M4 8v10a2 2 0 0 0 2 2h11" />
    </svg>
  );
}

function BoardsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.8a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06A1.94 1.94 0 1 1 4.75 17.1l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.5a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.94 1.94 0 1 1 7.4 4.81l.06.06a1.6 1.6 0 0 0 1.77.32H9.3a1.6 1.6 0 0 0 .97-1.47V3.5a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.77v.07a1.6 1.6 0 0 0 1.47.97H21a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.47.97z" />
    </svg>
  );
}
