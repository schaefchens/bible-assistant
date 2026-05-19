import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { audioPlayback } from '@/lib/audioPlaybackManager';

type Props = {
  onTranscript: (text: string) => void;
  pushToTalkHotkey?: string;
};

export function VoiceCaptureButton({ onTranscript, pushToTalkHotkey }: Props) {
  const { t } = useTranslation();
  const { start, stop, listening, available, error } = useSpeechRecognition(onTranscript);

  const onClick = async () => {
    // iOS Safari requires AudioContext init inside a user gesture.
    audioPlayback.ensureContext();
    if (listening) {
      await stop();
    } else {
      await start();
    }
  };

  if (!available) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        title={
          error ??
          (pushToTalkHotkey
            ? (t('chat.pushToTalkHint', { key: pushToTalkHotkey }) as string)
            : undefined)
        }
        aria-label={listening ? t('chat.listening') : t('chat.holdToSpeak')}
        className={clsx(
          'h-12 w-12 rounded-full flex items-center justify-center transition-colors',
          listening ? 'bg-gold text-navy animate-pulse-soft' : 'bg-navy-soft text-cream',
          error && !listening && 'ring-2 ring-red-500/60',
        )}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
      {error && !listening && (
        <div className="absolute bottom-full left-0 mb-1 whitespace-nowrap text-[10px] text-red-400 bg-navy-deep px-2 py-1 rounded pointer-events-none">
          {error}
        </div>
      )}
    </div>
  );
}
