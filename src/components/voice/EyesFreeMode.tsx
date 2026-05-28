import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useGlobalVoice } from '@/hooks/useGlobalVoice';
import {
  navigateVerse,
  togglePlayOrStart,
} from '@/hooks/usePlaybackTransport';
import { playClickTick } from '@/lib/clickTick';
import { playLastReading } from '@/lib/playLastReading';

export function EyesFreeMode() {
  const open = useGlobalVoiceStore((s) => s.eyesFreeMode);
  const setOpen = useGlobalVoiceStore((s) => s.setEyesFreeMode);
  const { t } = useTranslation();
  const voice = useGlobalVoice();
  const listening = voice.listening;
  const startVoice = voice.start;
  const stopVoice = voice.stop;

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

  const overlay = (
    <div
      className="fixed inset-0 z-[60] bg-navy-deep grid select-none"
      style={{
        gridTemplateRows: '16vh minmax(0, 1fr) 20vh',
      }}
    >
      <ZoneButton
        label={t('eyesFree.exit') as string}
        ariaLabel={t('eyesFree.exit') as string}
        className="w-full h-full pt-safe bg-navy-soft text-cream-dim"
        labelClassName="text-[clamp(1.25rem,5vh,2.25rem)]"
        onTap={exit}
      />
      <div
        className="grid min-h-0"
        style={{ gridTemplateColumns: '1fr minmax(0, 38vw) 1fr' }}
      >
        <ZoneButton
          label={t('eyesFree.prev') as string}
          ariaLabel={t('eyesFree.prev') as string}
          className="w-full h-full bg-ribbon-blue text-navy-deep"
          labelClassName="text-[clamp(1.25rem,6vw,3rem)]"
          onTap={() => navigateVerse(-1)}
        />
        <ZoneButton
          label={t('eyesFree.play') as string}
          ariaLabel={t('eyesFree.play') as string}
          className="w-full h-full bg-gold-glow text-navy-deep"
          labelClassName="text-[clamp(1.5rem,7vw,3.5rem)]"
          onTap={playOrResume}
        />
        <ZoneButton
          label={t('eyesFree.next') as string}
          ariaLabel={t('eyesFree.next') as string}
          className="w-full h-full bg-ribbon-green text-navy-deep"
          labelClassName="text-[clamp(1.25rem,6vw,3rem)]"
          onTap={() => navigateVerse(1)}
        />
      </div>
      <ZoneButton
        label={
          listening
            ? (t('eyesFree.micOn') as string)
            : (t('eyesFree.mic') as string)
        }
        ariaLabel={
          listening
            ? (t('chat.listening') as string)
            : (t('chat.holdToSpeak') as string)
        }
        className={clsx(
          'w-full h-full pb-safe text-navy-deep',
          listening ? 'bg-ribbon-red animate-pulse-soft' : 'bg-ribbon-red/85',
        )}
        labelClassName="text-[clamp(1.5rem,6vh,2.75rem)]"
        onTap={toggleMic}
      />
    </div>
  );

  return createPortal(overlay, document.body);
}

type ZoneButtonProps = {
  label: string;
  ariaLabel: string;
  className: string;
  labelClassName?: string;
  onTap: () => void;
};

function ZoneButton({
  label,
  ariaLabel,
  className,
  labelClassName,
  onTap,
}: ZoneButtonProps) {
  const [pressed, setPressed] = useState(false);

  const handleDown = () => {
    setPressed(true);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(15);
    }
    playClickTick();
    window.setTimeout(() => setPressed(false), 150);
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={handleDown}
      onClick={onTap}
      className={clsx(
        // min-w-0 / min-h-0 + overflow-hidden so a wide label can't expand
        // the grid column and push the right zone off-screen.
        'min-w-0 min-h-0 overflow-hidden',
        'flex items-center justify-center font-sans font-bold uppercase tracking-tight px-2',
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
