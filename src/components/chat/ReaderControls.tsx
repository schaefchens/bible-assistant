import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

type Props = {
  isPlaying: boolean;
  isLoading: boolean;
  rate: number;
  repeat: boolean;
  onTogglePlay: () => void;
  onCycleRate: () => void;
  onToggleRepeat: () => void;
  onMenu: (pos: { x: number; y: number }) => void;
};

export function ReaderControls({
  isPlaying,
  isLoading,
  rate,
  repeat,
  onTogglePlay,
  onCycleRate,
  onToggleRepeat,
  onMenu,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        className="btn-ghost h-9 px-3 min-w-[3.5rem]"
        aria-label={isPlaying ? t('playback.pause') : t('playback.play')}
      >
        {isLoading
          ? t('playback.loading')
          : isPlaying
            ? <PauseIcon />
            : <PlayIcon />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleRepeat();
        }}
        aria-pressed={repeat}
        aria-label={t('chat.reader.repeat')}
        className={clsx(
          'btn-ghost h-9 w-9 px-0',
          repeat && 'bg-gold/20 text-gold',
        )}
      >
        <RepeatIcon />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCycleRate();
        }}
        aria-label={t('chat.reader.rate')}
        className="btn-ghost h-9 px-3 font-mono text-[11px]"
      >
        {rate.toFixed(2)}×
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          onMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
        aria-label="More"
        className="btn-ghost h-9 w-9 px-0 ml-auto"
      >
        <DotsIcon />
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4l14 8-14 8V4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
