import { useState } from 'react';
import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import { navigateVerse, togglePlayOrStart } from '@/hooks/usePlaybackTransport';
import { isReadingRoute } from '@/lib/appRoutes';
import { PlaybackSettingsSheet } from './PlaybackSettingsSheet';

/** Width of the grip, and the only part of the arm the collapsed capsule shows.
 * `MicDock` needs it to compute the collapsed width, so it lives here with the
 * element that owns it. */
export const HANDLE_W = 20;

type Props = {
  /** Measured by `MicDock` to size the capsule — the row is `max-content`, so
   * its natural width is the expanded target. */
  rowRef: React.Ref<HTMLDivElement>;
  expanded: boolean;
  onToggle: () => void;
  /** The dock sits in a right-hand corner, so the arm extends leftwards. */
  onRightSide: boolean;
};

/**
 * The transport row that extends out of the mic. Renders only the row — the
 * capsule, the clipping and the open/closed geometry are `MicDock`'s, which is
 * the component that knows where the mic is.
 *
 * Two orderings flip with the dock's corner and one never does: the *groups*
 * are reversed so the transport always sits next to the mic (nearest the thumb)
 * and the grip nearest of all, while Prev|Play|Next and the extras keep their
 * own left-to-right order in every corner — a mirrored transport is unreadable.
 */
export function TransportArm({ rowRef, expanded, onToggle, onRightSide }: Props) {
  const { t } = useTranslation();
  const location = useLocation();

  const status = usePlaybackStore((s) => s.status);
  const autoPlay = useSettingsStore((s) => s.autoPlayReading);
  const setAutoPlay = useSettingsStore((s) => s.setAutoPlayReading);
  const autoScroll = useSettingsStore((s) => s.autoScrollReader);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScrollReader);

  const [sheetOpen, setSheetOpen] = useState(false);

  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const onReadingRoute = isReadingRoute(location.pathname);

  return (
    <>
      <div
        ref={rowRef}
        // max-content, never shrink: the row's natural width is what the
        // capsule animates to, so it must not react to being clipped.
        style={{ width: 'max-content' }}
        className={clsx(
          'flex flex-none items-center gap-1',
          onRightSide && 'flex-row-reverse',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            expanded
              ? (t('playback.hideControls') as string)
              : (t('playback.showControls') as string)
          }
          aria-expanded={expanded}
          className={clsx(
            'h-9 shrink-0 rounded-md flex items-center justify-center',
            'text-ink-muted hover:text-ink active:scale-95 transition-all',
          )}
          style={{ width: HANDLE_W }}
        >
          <ChevronIcon flipped={onRightSide === expanded} />
        </button>

        {/* Everything but the grip fades as it slides under the mic — the
            capsule's rounded end alone leaves a hard edge mid-icon. `inert`
            rather than a render gate: the row has to stay mounted for its
            natural width to be measurable while collapsed. */}
        <div
          inert={!expanded}
          className={clsx(
            'flex items-center gap-1 transition-opacity duration-200',
            onRightSide && 'flex-row-reverse',
            expanded ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div className="flex items-center gap-0.5">
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

          <div className="flex items-center gap-0.5">
            {onReadingRoute && (
              <>
                {/* Both toggles duplicate a row in the ⚙ sheet, so on a phone
                    too narrow for the full arm (iPhone SE) they step aside
                    rather than push the transport off-screen. */}
                <ToggleButton
                  active={autoPlay}
                  className="max-[359px]:hidden"
                  aria-label={t('chat.reader.autoPlay')}
                  aria-pressed={autoPlay}
                  onClick={() => setAutoPlay(!autoPlay)}
                >
                  <InfinityIcon />
                </ToggleButton>

                <ToggleButton
                  active={autoScroll}
                  className="max-[359px]:hidden"
                  aria-label={t('chat.reader.autoScroll')}
                  aria-pressed={autoScroll}
                  onClick={() => setAutoScroll(!autoScroll)}
                >
                  <FollowIcon />
                </ToggleButton>
              </>
            )}

            <ToggleButton
              active={false}
              aria-label={t('playbackSheet.title')}
              onClick={() => setSheetOpen(true)}
            >
              <SettingsIcon />
            </ToggleButton>
          </div>
        </div>
      </div>

      <PlaybackSettingsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
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
        'h-9 w-9 rounded-full flex items-center justify-center shrink-0',
        'text-ink hover:bg-surface-raised/70 active:scale-95 transition-all',
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
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'h-8 w-8 rounded-full flex items-center justify-center shrink-0',
        'active:scale-95 transition-all',
        active
          ? 'bg-brand/20 text-brand'
          : 'text-ink-muted hover:bg-surface-raised/70 hover:text-ink',
        className,
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
        'h-10 w-10 rounded-full flex items-center justify-center shadow-md shrink-0',
        'bg-brand text-on-brand active:scale-95 transition-all',
        isLoading && 'animate-pulse-soft',
      )}
    >
      {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

/** Points left; `flipped` turns it round. The caller decides which way is
 * "outward" from the mic. */
function ChevronIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('transition-transform duration-200', flipped && 'rotate-180')}
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h2v14H6V5zm14 0v14L9 12l11-7z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 5h2v14h-2V5zM4 5l11 7L4 19V5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4l14 8-14 8V4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg
      width="18"
      height="18"
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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 12c0-2.2 1.8-4 4-4s3 1.2 4.5 4 3 4 4.5 4 2-1.8 2-4-1.8-4-4-4-3 1.2-4.5 4-3 4-4.5 4-2-1.8-2-4z" />
    </svg>
  );
}

function FollowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="17"
      height="17"
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
