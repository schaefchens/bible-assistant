import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import {
  navigateVerse,
  togglePlayOrStart,
} from '@/hooks/usePlaybackTransport';
import { useCornerDrag } from '@/hooks/useMicDrag';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { getMicAnchor, oppositeCorner } from '@/components/voice/MicAnchor';
import { MicSnapTargets } from '@/components/voice/MicSnapTargets';
import { PlaybackSettingsSheet } from './PlaybackSettingsSheet';

export function FloatingPlaybackBar() {
  const { t } = useTranslation();
  const location = useLocation();

  const hasReadings = useChatStore((s) =>
    s.messages.some((m) => (m.verses?.length ?? 0) > 0),
  );
  const status = usePlaybackStore((s) => s.status);

  const micCorner = useSettingsStore((s) => s.micCorner);
  const setMicCorner = useSettingsStore((s) => s.setMicCorner);
  const composerHeight = useUiLayoutStore((s) => s.composerHeight);

  const autoPlay = useSettingsStore((s) => s.autoPlayReading);
  const setAutoPlay = useSettingsStore((s) => s.setAutoPlayReading);
  const autoScroll = useSettingsStore((s) => s.autoScrollReader);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScrollReader);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Bring the bar back whenever playback resumes (new reading, Space, ↓, etc.).
  useEffect(() => {
    if (status === 'playing' || status === 'loading') {
      setDismissed(false);
    }
  }, [status]);

  // Dropping the bar in corner C means we want the bar at C, which means the
  // mic moves to oppositeCorner(C) — the bar's own position is derived.
  const onDrop = useCallback(
    (corner: ReturnType<typeof oppositeCorner>) =>
      setMicCorner(oppositeCorner(corner)),
    [setMicCorner],
  );
  const { state: dragState, bindings } = useCornerDrag(onDrop);

  const barCorner = oppositeCorner(micCorner);
  const onRightSide = barCorner === 'tr' || barCorner === 'br';
  const onChatRoute = location.pathname === '/';

  const anchorStyle = getMicAnchor({
    corner: barCorner,
    route: location.pathname,
    composerHeight,
  });

  if (!hasReadings || dismissed) {
    return null;
  }

  // Halfway-fudged ghost width so the bar follows roughly under the finger
  // when dragging. We don't measure live — just enough to keep the bar from
  // jumping off-screen during the gesture.
  const GHOST_W = 320;
  const GHOST_H = 56;
  const dragStyle: React.CSSProperties =
    dragState.dragging && dragState.ghost
      ? {
          position: 'fixed',
          left: dragState.ghost.x - GHOST_W / 2,
          top: dragState.ghost.y - GHOST_H / 2,
          transition: 'none',
        }
      : {
          ...anchorStyle,
          transition:
            'top 150ms ease, bottom 150ms ease, left 150ms ease, right 150ms ease',
        };

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';

  const handleClose = () => {
    audioPlayback.stop();
    setDismissed(true);
  };

  return (
    <>
      <MicSnapTargets visible={dragState.dragging} activeCorner={dragState.activeCorner} />

      <div
        style={{ ...dragStyle, zIndex: 49, touchAction: 'none' }}
        onPointerDown={bindings.onPointerDown}
        onContextMenu={bindings.onContextMenu}
        onClickCapture={(e) => {
          if (bindings.consumeClickIfDragged()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={clsx(
          'flex items-center gap-2',
          'rounded-2xl bg-navy-deep/95 backdrop-blur',
          'border border-gold/30 shadow-xl',
          'px-2 py-1',
          onRightSide && 'flex-row-reverse',
        )}
      >
        {/* Transport group — internal order (Prev | Play | Next) never changes;
            only its position within the bar flips when on the right side. */}
        <div className="flex items-center gap-1">
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
        </div>

        {/* Extras — chat-only toggles hidden elsewhere to keep the bar slim. */}
        <div className="flex items-center gap-1">
          {onChatRoute && (
            <>
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
            </>
          )}

          <TransportButton
            aria-label={t('playbackSheet.title')}
            onClick={() => setSheetOpen(true)}
          >
            <SettingsIcon />
          </TransportButton>

          <TransportButton
            aria-label={t('playback.close')}
            onClick={handleClose}
          >
            <CloseIcon />
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
        'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
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
        'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
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
        'h-12 w-12 rounded-full flex items-center justify-center shadow-md shrink-0',
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h2v14H6V5zm14 0v14L9 12l11-7z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 5h2v14h-2V5zM4 5l11 7L4 19V5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4l14 8-14 8V4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg
      width="20"
      height="20"
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 12c0-2.2 1.8-4 4-4s3 1.2 4.5 4 3 4 4.5 4 2-1.8 2-4-1.8-4-4-4-3 1.2-4.5 4-3 4-4.5 4-2-1.8-2-4z" />
    </svg>
  );
}

function FollowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="20"
      height="20"
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

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}
