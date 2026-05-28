import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useGlobalVoice } from '@/hooks/useGlobalVoice';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  navigateVerse,
  togglePlayOrStart,
} from '@/hooks/usePlaybackTransport';
import { playZoneTick, type ZoneSound } from '@/lib/clickTick';
import { speakLabel } from '@/lib/speakLabel';
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
        gridTemplateRows: '16vh minmax(0, 1fr) 20vh',
      }}
    >
      <ZoneButton
        zone="top"
        label={t('eyesFree.exit') as string}
        ariaLabel={t('eyesFree.exit') as string}
        icon={<ExitIcon />}
        className="w-full h-full pt-safe bg-navy-soft text-cream-dim flex-row gap-3"
        labelClassName="text-[clamp(1.25rem,5vh,2.25rem)]"
        iconClassName="w-[clamp(1.5rem,6vh,2.5rem)] h-[clamp(1.5rem,6vh,2.5rem)]"
        onTap={exit}
      />
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
