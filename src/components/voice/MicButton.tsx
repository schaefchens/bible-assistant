import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { voiceControl, PTT_HOTKEY } from '@/hooks/useGlobalVoice';
import { MIC_SIZE } from './MicAnchor';

type Props = {
  /** A drag ghost is a picture of the button, not the button: no tap, no
   * tooltip, and it must not swallow the pointer events driving the gesture. */
  ghost?: boolean;
  className?: string;
};

/**
 * The dock's anchor. Pure consumer of the single voice pipeline (mounted by
 * <VoiceController/>) — it reads mic state from the store and drives it through
 * `voiceControl`, so it can be rendered in a corner, in the docked bar, or as a
 * drag ghost without any of those knowing how the mic works.
 *
 * The tap that ends a drag is swallowed by the dock's own `onClickCapture`, so
 * there is deliberately no gesture awareness here.
 */
export function MicButton({ ghost = false, className }: Props) {
  const { t } = useTranslation();
  const listening = useGlobalVoiceStore((s) => s.listening);
  const pttRecording = useGlobalVoiceStore((s) => s.pttRecording);
  const error = useGlobalVoiceStore((s) => s.error);

  const isActive = listening || pttRecording;
  const label = listening
    ? (t('chat.listening') as string)
    : pttRecording
      ? (t('chat.pushToTalk') as string)
      : (t('chat.holdToSpeak') as string);

  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={ghost || undefined}
      tabIndex={ghost ? -1 : undefined}
      title={
        ghost
          ? undefined
          : (error ??
            (t('voice.mic.dragHint') as string) +
              ' · ' +
              (t('chat.pushToTalkHint', { key: PTT_HOTKEY }) as string))
      }
      style={{ height: MIC_SIZE, width: MIC_SIZE }}
      onClick={
        ghost
          ? undefined
          : async () => {
              if (listening) {
                await voiceControl.stop();
              } else {
                await voiceControl.start();
              }
            }
      }
      className={clsx(
        // Above the transport capsule, whose near end runs underneath it.
        'relative z-10 shrink-0 rounded-full flex items-center justify-center',
        'shadow-xl transition-colors',
        isActive
          ? 'bg-brand text-on-brand animate-pulse-soft'
          : 'bg-surface-sunken text-brand border border-brand/40',
        error && !isActive && 'ring-2 ring-red-500/60',
        ghost && 'pointer-events-none',
        className,
      )}
    >
      <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}
