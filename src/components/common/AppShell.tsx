import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useChatNavigation } from '@/hooks/useChatNavigation';
import { useThinkingDrone } from '@/hooks/useThinkingDrone';
import { useAppInitialization } from '@/hooks/useAppInitialization';
import { useNativeShell } from '@/hooks/useNativeShell';
import { useReadingHostFocus } from '@/hooks/useReadingHostFocus';
import { getPassphrase } from '@/lib/passphrase';
import { ROUTES } from '@/lib/appRoutes';
import { needsAppHandOff, stayingOnWeb } from '@/lib/spaceInvite';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { VoiceController } from '@/components/voice/VoiceController';
import { MicDock } from '@/components/voice/MicDock';
import { VoiceOverlay } from '@/components/voice/VoiceOverlay';
import { EyesFreeMode } from '@/components/voice/EyesFreeMode';
import { UpdateBanner } from '@/components/common/UpdateBanner';
import { KeyFailureBanner } from '@/components/common/KeyFailureBanner';
import { NarrationFallbackNotice } from '@/components/common/NarrationFallbackNotice';

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Minted before the first render by hydrateIdentity(), so this is normally
  // true from the start. It stays a guard rather than an assumption because a
  // device with no working crypto or storage can still reach here without one,
  // and the effects it gates would throw from requireIdentity().
  const hasPassphrase = !!getPassphrase();
  const location = useLocation();
  const online = useLibraryStore((s) => s.online);
  const pendingOps = useLibraryStore((s) => s.pendingOps);

  // Show the bottom status bar immediately when offline, but debounce the
  // "pending" indicator: routine mutations (e.g. switching a board's view)
  // bump pendingOps to 1 and flush within milliseconds, which would otherwise
  // flash the bar for a frame. Only surface pending work that actually lingers.
  const pendingWhileOnline = online && pendingOps > 0;
  const [pendingLingered, setPendingLingered] = useState(false);
  // Reset during render (no effect) once there's nothing pending to linger on.
  if (!pendingWhileOnline && pendingLingered) setPendingLingered(false);
  useEffect(() => {
    if (!pendingWhileOnline) return;
    const id = window.setTimeout(() => setPendingLingered(true), 600);
    return () => window.clearTimeout(id);
  }, [pendingWhileOnline]);
  const showStatusBar = !online || (pendingOps > 0 && pendingLingered);

  useChatNavigation();
  useThinkingDrone();
  useAppInitialization(hasPassphrase);
  useNativeShell();
  useReadingHostFocus();

  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useSettingsStore((s) => s.setOnboardingComplete);

  const onInviteRoute = location.pathname.startsWith(ROUTES.subscribe);

  if (!onboardingComplete) {
    // An invitation opened in a mobile browser gets its hand-off *first*, ahead
    // of the wizard: the app may well already be installed, and web and native
    // are separate installs with separate identities — so onboarding here,
    // before the user has said which one they want, is setting up the wrong
    // copy of the app. Once they choose the browser the route says so
    // (`?web=1`) and the wizard runs as usual.
    //
    // Rendered bare, without the nav or the dock: there is nothing to navigate
    // to yet, and the app behind this has not been set up.
    if (onInviteRoute && needsAppHandOff() && !stayingOnWeb(location.search)) {
      return <Outlet />;
    }
    return (
      <OnboardingWizard
        onDone={() => {
          setOnboardingComplete(true);
          // Chat is where a first run belongs — unless the app was opened *on*
          // something. An invite link is usually the reason that person
          // installed the app at all, and the code lives in the route rather
          // than in a stash precisely so it can survive the wizard (see
          // SubscribePage, and useNativeShell's appUrlOpen handler, which
          // deliberately doesn't care whether onboarding is done). Replacing
          // the URL here discarded it, and `replace` took it out of history
          // too, so there was nothing to go back to.
          if (!onInviteRoute) navigate('/', { replace: true });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full pt-safe px-safe">
      <UpdateBanner />
      <KeyFailureBanner />
      <NarrationFallbackNotice />
      <main className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </main>

      {showStatusBar && (
        <div className="px-4 py-1 text-xs text-ink-muted flex items-center gap-2 border-t border-surface-raised bg-surface/90">
          <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')} />
          {online ? t('common.online') : t('common.offline')}
          {pendingOps > 0 && (
            <span className="ml-1 text-amber-400">{t('common.pending', { count: pendingOps })}</span>
          )}
        </div>
      )}

      {/* Above the nav and inside the column: docked, the mic bar takes its own
          space rather than covering the page. Floating, it renders fixed and
          this slot costs nothing. */}
      <MicDock />

      {/* Cards and boards share one tab (one screen, one tab strip), which
          freed the slot Spaces now has — until now the only ways in were
          Settings and one onboarding step. */}
      <nav className="pb-safe border-t border-surface-raised bg-surface grid grid-cols-5">
        <NavTab to="/" label={t('nav.chat')} icon={<ChatIcon />} end />
        <NavTab to="/read" label={t('nav.read')} icon={<ReadIcon />} />
        <NavTab to="/cards" label={t('nav.cards')} icon={<CardsIcon />} />
        <NavTab to="/spaces" label={t('nav.spaces')} icon={<SpacesIcon />} />
        <NavTab to="/settings" label={t('nav.settings')} icon={<SettingsIcon />} />
      </nav>

      <VoiceController />
      <VoiceOverlay />
      <EyesFreeMode />
    </div>
  );
}

function NavTab({
  to,
  label,
  icon,
  end = false,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Match this path exactly. Only chat needs it — `/` matches everything
   * otherwise. The tabs with sub-routes must NOT set it, or editing a card
   * (`/cards/:cardId`) or opening a space (`/spaces/:id`) unlights the tab
   * you are standing on. */
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] tracking-wide transition-colors',
          'before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:h-0.5 before:rounded-b-full before:transition-all',
          isActive
            ? 'text-brand before:w-8 before:bg-brand'
            : 'text-ink-muted hover:text-ink before:w-0 before:bg-transparent',
        )
      }
    >
      <span className="w-5 h-5">{icon}</span>
      {/* Five tabs leaves ~64px each on a 320px screen, which "Einstellungen"
          overruns — truncate rather than let the row reflow. */}
      <span className="max-w-full truncate px-0.5">{label}</span>
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

/** An open book — deliberately distinct from BookChapterPicker's closed book. */
function ReadIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 6.6C10.4 5.1 7.9 4.5 4 4.9v13c3.9-.4 6.4.2 8 1.7 1.6-1.5 4.1-2.1 8-1.7v-13c-3.9-.4-6.4.2-8 1.7z" />
      <line x1="12" y1="6.6" x2="12" y2="19.6" />
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

/** People, not pages: the tab covers the user's own spaces *and* the ones
 * they read, and the writing itself is already what Cards and Read look like. */
function SpacesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="9.5" cy="8.5" r="3" />
      <path d="M3.8 19.2c0-3 2.6-5.2 5.7-5.2s5.7 2.2 5.7 5.2" />
      <path d="M16.4 6.4a3 3 0 0 1 0 5.6" />
      <path d="M17.8 14.6c1.6.8 2.6 2.4 2.6 4.6" />
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
