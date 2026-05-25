import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import {
  navigateVerse,
  togglePlayOrStart,
} from '@/hooks/usePlaybackTransport';
import { PlaybackSettingsSheet } from './PlaybackSettingsSheet';

export function FloatingPlaybackBar() {
  const { t } = useTranslation();
  const hasReadings = useChatStore((s) =>
    s.messages.some((m) => (m.verses?.length ?? 0) > 0),
  );
  const status = usePlaybackStore((s) => s.status);
  const autoPlay = useSettingsStore((s) => s.autoPlayReading);
  const setAutoPlay = useSettingsStore((s) => s.setAutoPlayReading);
  const autoScroll = useSettingsStore((s) => s.autoScrollReader);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScrollReader);
  const setBarHeight = useUiLayoutStore((s) => s.setPlaybackBarHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Mirror the bar's height so other floating UI (mic button) can lift above it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasReadings) {
      setBarHeight(0);
      return;
    }
    const update = () => setBarHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setBarHeight(0);
    };
  }, [hasReadings, setBarHeight]);

  if (!hasReadings) return null;

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  return (
    <>
      <div
        ref={containerRef}
        className="px-3 pt-2"
      >
        <div
          className={clsx(
            'flex items-center justify-between gap-2',
            'rounded-2xl bg-navy-deep/95 backdrop-blur',
            'border border-gold/30 shadow-xl',
            'px-3 py-2',
          )}
        >
          <TransportButton
            aria-label={t('playback.previous')}
            onClick={() => navigateVerse(-1)}
          >
            <PrevIcon />
          </TransportButton>

          <PlayButton
            isPlaying={isPlaying}
            isLoading={isLoading}
            onClick={() => togglePlayOrStart()}
            ariaLabel={
              isPlaying
                ? (t('playback.pause') as string)
                : (t('playback.play') as string)
            }
          />

          <TransportButton
            aria-label={t('playback.next')}
            onClick={() => navigateVerse(1)}
          >
            <NextIcon />
          </TransportButton>

          <ToggleButton
            active={autoPlay}
            aria-label={t('chat.reader.autoPlay')}
            aria-pressed={autoPlay}
            onClick={() => setAutoPlay(!autoPlay)}
          >
            <InfinityIcon />
          </ToggleButton>

          <ToggleButton
            active={autoScroll}
            aria-label={t('chat.reader.autoScroll')}
            aria-pressed={autoScroll}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <FollowIcon />
          </ToggleButton>

          <TransportButton
            aria-label={t('playbackSheet.title')}
            onClick={() => setSheetOpen(true)}
          >
            <SettingsIcon />
          </TransportButton>
        </div>
      </div>

      <PlaybackSettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

function TransportButton({
  children,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'h-11 w-11 rounded-xl flex items-center justify-center shrink-0',
        'text-cream hover:bg-navy-soft/70 active:scale-95 transition-all',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  children,
  active,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
        'active:scale-95 transition-all',
        active
          ? 'bg-gold/20 text-gold'
          : 'text-cream-dim hover:bg-navy-soft/70 hover:text-cream',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function PlayButton({
  isPlaying,
  isLoading,
  ariaLabel,
  onClick,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={clsx(
        'h-14 w-14 rounded-full flex items-center justify-center shadow-lg',
        'bg-gold text-navy active:scale-95 transition-all',
        isLoading && 'animate-pulse-soft',
      )}
    >
      {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

function PrevIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h2v14H6V5zm14 0v14L9 12l11-7z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 5h2v14h-2V5zM4 5l11 7L4 19V5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4l14 8-14 8V4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function InfinityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 12c0-2.2 1.8-4 4-4s3 1.2 4.5 4 3 4 4.5 4 2-1.8 2-4-1.8-4-4-4-3 1.2-4.5 4-3 4-4.5 4-2-1.8-2-4z" />
    </svg>
  );
}

function FollowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.8a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06A1.94 1.94 0 1 1 4.75 17.1l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.5a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.94 1.94 0 1 1 7.4 4.81l.06.06a1.6 1.6 0 0 0 1.77.32H9.3a1.6 1.6 0 0 0 .97-1.47V3.5a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.77v.07a1.6 1.6 0 0 0 1.47.97H21a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.47.97z" />
    </svg>
  );
}
