import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Floats above the message list while the reader is auto-following the
 * currently-spoken verse. Tap to stop following (flips the setting off);
 * the button hides itself.
 */
export function AutoScrollFab() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.autoScrollReader);
  const setEnabled = useSettingsStore((s) => s.setAutoScrollReader);
  const status = usePlaybackStore((s) => s.status);
  const hasCurrent = usePlaybackStore((s) => s.current !== null);

  // Only show while autoscroll would actually fire — when there's an active
  // playback and the setting is on. Paused playback doesn't scroll, so hide.
  const visible =
    enabled && hasCurrent && (status === 'playing' || status === 'loading');
  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={t('chat.stopFollowing')}
      onClick={() => setEnabled(false)}
      className={clsx(
        'absolute left-4 bottom-3 z-20',
        'h-10 px-3 rounded-full bg-navy-deep border border-gold/30 text-gold',
        'shadow-lg flex items-center gap-2',
        'hover:bg-navy-soft/80 active:scale-95 transition-all',
      )}
    >
      <FollowOffIcon />
      <span className="text-xs">{t('chat.stopFollowing')}</span>
    </button>
  );
}

function FollowOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
      <line x1="4" y1="19" x2="20" y2="19" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}
