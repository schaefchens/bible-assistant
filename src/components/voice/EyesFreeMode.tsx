import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useGlobalVoice } from '@/hooks/useGlobalVoice';
import { usePlaybackStore } from '@/store/playbackStore';
import { useChatStore } from '@/store/chatStore';
import {
  navigateVerse,
  togglePlayOrStart,
} from '@/hooks/usePlaybackTransport';
import { playZoneTick, type ZoneSound } from '@/lib/clickTick';
import { speakLabel, primeSpeechSynthesis } from '@/lib/speakLabel';
import { playLastReading } from '@/lib/playLastReading';

const LONG_PRESS_MS = 500;

export function EyesFreeMode() {
  const open = useGlobalVoiceStore((s) => s.eyesFreeMode);
  const setOpen = useGlobalVoiceStore((s) => s.setEyesFreeMode);
  const { t } = useTranslation();
  const voice = useGlobalVoice();
  const listening = voice.listening;
  const startVoice = voice.start;
  const stopVoice = voice.stop;
  const playbackStatus = usePlaybackStore((s) => s.status);
  const isPlaying = playbackStatus === 'playing';

  const exit = useCallback(() => setOpen(false), [setOpen]);
  const toggleMic = useCallback(() => {
    void (listening ? stopVoice() : startVoice());
  }, [listening, startVoice, stopVoice]);
  const playOrResume = useCallback(() => {
    if (togglePlayOrStart()) return;
    void playLastReading();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exit();
      } else if (e.key === ' ') {
        e.preventDefault();
        playOrResume();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateVerse(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateVerse(1);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMic();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, exit, toggleMic, playOrResume]);

  if (!open) return null;

  const centerLabel = isPlaying
    ? (t('eyesFree.pause') as string)
    : (t('eyesFree.play') as string);
  const micLabel = listening
    ? (t('eyesFree.micOn') as string)
    : (t('eyesFree.mic') as string);

  const overlay = (
    <div
      className="fixed inset-0 z-[60] bg-navy-deep grid select-none"
      style={{
        gridTemplateRows: '8vh 14vh minmax(0, 1fr) 18vh',
      }}
    >
      <ZoneButton
        zone="top"
        label={t('eyesFree.exit') as string}
        ariaLabel={t('eyesFree.exit') as string}
        icon={<ExitIcon />}
        className="w-full h-full pt-safe bg-navy-soft text-cream-dim flex-row gap-2"
        labelClassName="text-[clamp(0.85rem,2.5vh,1.25rem)]"
        iconClassName="w-[clamp(1rem,3.5vh,1.75rem)] h-[clamp(1rem,3.5vh,1.75rem)]"
        onTap={exit}
      />
      <RollingTicker />
      <div
        className="grid min-h-0"
        style={{ gridTemplateColumns: '1fr minmax(0, 38vw) 1fr' }}
      >
        <ZoneButton
          zone="left"
          label={t('eyesFree.prev') as string}
          ariaLabel={t('eyesFree.prev') as string}
          icon={<PrevIcon />}
          className="w-full h-full bg-ribbon-blue text-navy-deep"
          labelClassName="text-[clamp(1.25rem,6vw,3rem)]"
          iconClassName="w-[clamp(2.5rem,14vw,5.5rem)] h-[clamp(2.5rem,14vw,5.5rem)]"
          onTap={() => navigateVerse(-1)}
        />
        <ZoneButton
          zone="center"
          label={centerLabel}
          ariaLabel={centerLabel}
          icon={isPlaying ? <PauseIcon /> : <PlayIcon />}
          className="w-full h-full bg-gold-glow text-navy-deep"
          labelClassName="text-[clamp(1.5rem,7vw,3.5rem)]"
          iconClassName="w-[clamp(3rem,16vw,6rem)] h-[clamp(3rem,16vw,6rem)]"
          onTap={playOrResume}
        />
        <ZoneButton
          zone="right"
          label={t('eyesFree.next') as string}
          ariaLabel={t('eyesFree.next') as string}
          icon={<NextIcon />}
          className="w-full h-full bg-ribbon-green text-navy-deep"
          labelClassName="text-[clamp(1.25rem,6vw,3rem)]"
          iconClassName="w-[clamp(2.5rem,14vw,5.5rem)] h-[clamp(2.5rem,14vw,5.5rem)]"
          onTap={() => navigateVerse(1)}
        />
      </div>
      <ZoneButton
        zone="bottom"
        label={micLabel}
        ariaLabel={
          listening
            ? (t('chat.listening') as string)
            : (t('chat.holdToSpeak') as string)
        }
        icon={<MicIcon active={listening} />}
        className={clsx(
          'w-full h-full pb-safe text-navy-deep flex-row gap-4',
          listening ? 'bg-ribbon-red animate-pulse-soft' : 'bg-ribbon-red/85',
        )}
        labelClassName="text-[clamp(1.5rem,6vh,2.75rem)]"
        iconClassName="w-[clamp(1.75rem,7vh,3rem)] h-[clamp(1.75rem,7vh,3rem)]"
        onTap={toggleMic}
      />
    </div>
  );

  return createPortal(overlay, document.body);
}

type ZoneButtonProps = {
  zone: ZoneSound;
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
  className: string;
  labelClassName?: string;
  iconClassName?: string;
  onTap: () => void;
};

function ZoneButton({
  zone,
  label,
  ariaLabel,
  icon,
  className,
  labelClassName,
  iconClassName,
  onTap,
}: ZoneButtonProps) {
  const [pressed, setPressed] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleDown = () => {
    longPressFired.current = false;
    setPressed(true);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(15);
    }
    playZoneTick(zone);
    // Unlock speechSynthesis inside this user gesture so the
    // long-press-triggered speak() (fired from a timer) isn't blocked
    // by iOS Safari's gesture rule.
    primeSpeechSynthesis();
    window.setTimeout(() => setPressed(false), 150);

    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([20, 35, 20]);
      }
      speakLabel(label);
    }, LONG_PRESS_MS);
  };

  const handleUp = () => {
    clearLongPress();
  };

  const handleCancel = () => {
    clearLongPress();
    // Pointer left the button before release — treat as cancelled, but
    // keep longPressFired so a click event that still arrives (it
    // shouldn't on cancel, but Safari is weird) is also suppressed.
  };

  const handleClick = () => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onTap();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={handleCancel}
      onPointerCancel={handleCancel}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      className={clsx(
        // min-w-0 / min-h-0 + overflow-hidden so a wide label can't expand
        // the grid column and push the right zone off-screen.
        'min-w-0 min-h-0 overflow-hidden',
        'flex flex-col items-center justify-center gap-2 font-sans font-bold uppercase tracking-tight px-2',
        'transition-transform duration-150',
        pressed ? 'scale-95 brightness-90' : 'scale-100',
        className,
      )}
      style={{
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        // Suppress the long-press text-selection / share / iOS callout
        // popups that Chrome and Safari show by default.
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <span
        className={clsx('shrink-0 flex items-center justify-center', iconClassName)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span
        className={clsx(
          'whitespace-nowrap leading-none',
          labelClassName ?? 'text-[clamp(1.75rem,9vw,4rem)]',
        )}
      >
        {label}
      </span>
    </button>
  );
}

// Static word-chunk display. Shows CHUNK_SIZE words at a time, highlights
// the currently-spoken one in gold, and swaps to the next chunk only when
// playback crosses a chunk boundary. Avoids per-frame motion that becomes
// visually noisy in eyes-free use.
const CHUNK_SIZE = 4;

function RollingTicker() {
  const messageId = usePlaybackStore((s) => s.current?.messageId ?? null);
  const verseIndex = usePlaybackStore((s) => s.current?.verseIndex ?? -1);
  const wordIndex = usePlaybackStore((s) => s.current?.currentWordIndex ?? -1);
  const isVerse = usePlaybackStore((s) => s.current?.isVerse ?? false);
  const status = usePlaybackStore((s) => s.status);
  const hasTrack = usePlaybackStore((s) => s.current !== null);

  const verseText = useChatStore((s) => {
    if (messageId == null || verseIndex < 0) return '';
    const msg = s.messages.find((m) => m.id === messageId);
    return msg?.verses?.[verseIndex]?.text ?? '';
  });

  const words = useMemo(
    () => verseText.split(/\s+/).filter(Boolean),
    [verseText],
  );

  // Cache the last visible chunk so brief gaps (punctuation, between
  // tracks, chapter announcements) don't flicker the ticker. Cleared only
  // when playback fully stops.
  const lastChunkRef = useRef<{ words: string[]; activeIdx: number } | null>(
    null,
  );

  const display = useMemo<{ words: string[]; activeIdx: number } | null>(() => {
    if (status === 'idle' || !hasTrack) {
      lastChunkRef.current = null;
      return null;
    }
    if (isVerse && words.length > 0 && wordIndex >= 0) {
      const chunkIndex = Math.floor(wordIndex / CHUNK_SIZE);
      const chunkStart = chunkIndex * CHUNK_SIZE;
      const fresh = {
        words: words.slice(chunkStart, chunkStart + CHUNK_SIZE),
        activeIdx: wordIndex - chunkStart,
      };
      lastChunkRef.current = fresh;
      return fresh;
    }
    return lastChunkRef.current;
  }, [status, hasTrack, isVerse, words, wordIndex]);

  if (!display) {
    return <div className="w-full h-full" aria-hidden="true" />;
  }

  const chunkWords = display.words;
  const activeInChunk = display.activeIdx;
  const chunkKey = chunkWords.join('|');

  return (
    <div
      className="relative overflow-hidden w-full h-full flex items-center justify-center px-3"
      aria-hidden="true"
    >
      <div
        key={chunkKey}
        className="flex items-baseline justify-center whitespace-nowrap gap-[0.5em] min-w-0"
      >
        {chunkWords.map((w, i) => {
          const active = i === activeInChunk;
          return (
            <span
              key={i}
              className={clsx(
                // Keep font-weight constant so the active word doesn't
                // change its intrinsic width and shove neighbours around.
                // Distinction is by colour (and a subtle glow) only.
                'font-serif font-bold leading-none transition-colors duration-150',
                active
                  ? 'text-gold-glow [text-shadow:0_0_18px_rgba(231,201,138,0.55)]'
                  : 'text-cream-dim/70',
              )}
              style={{ fontSize: 'clamp(1.5rem, 6vw, 3rem)' }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-full h-full',
};

function ExitIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none">
      <rect x="5" y="5" width="2.5" height="14" rx="1.2" />
      <path d="M21 5.5v13a1 1 0 0 1-1.55.83l-9-6.5a1 1 0 0 1 0-1.66l9-6.5A1 1 0 0 1 21 5.5z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none">
      <rect x="16.5" y="5" width="2.5" height="14" rx="1.2" />
      <path d="M3 5.5v13a1 1 0 0 0 1.55.83l9-6.5a1 1 0 0 0 0-1.66l-9-6.5A1 1 0 0 0 3 5.5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none">
      <path d="M6 4.5v15a1 1 0 0 0 1.52.85l13-7.5a1 1 0 0 0 0-1.7l-13-7.5A1 1 0 0 0 6 4.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none">
      <rect x="5.5" y="4" width="5" height="16" rx="1.4" />
      <rect x="13.5" y="4" width="5" height="16" rx="1.4" />
    </svg>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg {...ICON_PROPS} fill={active ? 'currentColor' : 'none'}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" fill="none" />
      <line x1="12" y1="18" x2="12" y2="22" fill="none" />
    </svg>
  );
}
