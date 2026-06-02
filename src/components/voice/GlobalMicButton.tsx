import clsx from 'clsx';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { voiceControl, PTT_HOTKEY } from '@/hooks/useGlobalVoice';
import { useMicDrag } from '@/hooks/useMicDrag';
import { getMicAnchor } from './MicAnchor';
import { MicSnapTargets } from './MicSnapTargets';

export function GlobalMicButton() {
  const { t } = useTranslation();
  const location = useLocation();
  const corner = useSettingsStore((s) => s.micCorner);
  const composerHeight = useUiLayoutStore((s) => s.composerHeight);

  // Pure consumer of the single voice pipeline (mounted by <VoiceController/>).
  const listening = useGlobalVoiceStore((s) => s.listening);
  const pttRecording = useGlobalVoiceStore((s) => s.pttRecording);
  const available = useGlobalVoiceStore((s) => s.available);
  const error = useGlobalVoiceStore((s) => s.error);
  const { state: dragState, bindings } = useMicDrag();

  if (!available) return null;

  const anchorStyle = getMicAnchor({
    corner,
    route: location.pathname,
    composerHeight,
  });

  const dragStyle: React.CSSProperties =
    dragState.dragging && dragState.ghost
      ? {
          position: 'fixed',
          left: dragState.ghost.x - 28,
          top: dragState.ghost.y - 28,
          transition: 'none',
        }
      : { ...anchorStyle, transition: 'top 150ms ease, bottom 150ms ease, left 150ms ease, right 150ms ease' };

  const isActive = listening || pttRecording;
  const ariaLabel = listening
    ? (t('chat.listening') as string)
    : pttRecording
      ? (t('chat.pushToTalk') as string)
      : (t('chat.holdToSpeak') as string);

  return (
    <>
      <MicSnapTargets visible={dragState.dragging} activeCorner={dragState.activeCorner} />
      <button
        type="button"
        aria-label={ariaLabel}
        title={
          error ??
          (t('voice.mic.dragHint') as string) +
            ' · ' +
            (t('chat.pushToTalkHint', { key: PTT_HOTKEY }) as string)
        }
        style={{
          ...dragStyle,
          zIndex: 50,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        onClick={async (e) => {
          if (bindings.consumeClickIfDragged()) {
            e.preventDefault();
            return;
          }
          if (listening) {
            await voiceControl.stop();
          } else {
            await voiceControl.start();
          }
        }}
        onPointerDown={bindings.onPointerDown}
        onContextMenu={bindings.onContextMenu}
        className={clsx(
          'h-14 w-14 rounded-full flex items-center justify-center shadow-xl',
          'transition-colors',
          isActive
            ? 'bg-gold text-navy animate-pulse-soft'
            : 'bg-navy-deep text-gold border border-gold/40',
          error && !isActive && 'ring-2 ring-red-500/60',
        )}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    </>
  );
}
