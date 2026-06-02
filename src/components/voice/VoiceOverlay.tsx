import { useCallback, useEffect } from 'react';
import clsx from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useChatStore } from '@/store/chatStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { usePlaybackStore } from '@/store/playbackStore';
import { getMicAnchor } from './MicAnchor';

const OVERLAY_GAP = 76; // mic size (56) + breathing room

export function VoiceOverlay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const corner = useSettingsStore((s) => s.micCorner);
  const composerHeight = useUiLayoutStore((s) => s.composerHeight);

  const overlayOpen = useGlobalVoiceStore((s) => s.overlayOpen);
  const listening = useGlobalVoiceStore((s) => s.listening);
  const transcript = useGlobalVoiceStore((s) => s.transcript);
  const lastResponse = useGlobalVoiceStore((s) => s.lastResponse);
  const setOverlayOpen = useGlobalVoiceStore((s) => s.setOverlayOpen);
  const setLastResponse = useGlobalVoiceStore((s) => s.setLastResponse);
  const reset = useGlobalVoiceStore((s) => s.reset);

  const status = usePlaybackStore((s) => s.status);
  const onChat = location.pathname === '/';

  const dismiss = useCallback(() => {
    // Clear the inline reply + overlay; preserve listening so an in-flight
    // recording keeps recording.
    setOverlayOpen(false);
    setLastResponse(null);
  }, [setOverlayOpen, setLastResponse]);

  const openInChat = useCallback(() => {
    const messageId = lastResponse?.messageId ?? null;
    if (messageId) {
      useChatStore.getState().setHighlightedMessageId(messageId);
    }
    navigate('/');
    reset();
  }, [lastResponse, navigate, reset]);

  // On chat, the inline reply auto-dismisses after a while so it doesn't linger
  // over the conversation.
  useEffect(() => {
    if (!onChat || lastResponse?.kind !== 'reply') return;
    const id = window.setTimeout(() => setLastResponse(null), 12000);
    return () => window.clearTimeout(id);
  }, [onChat, lastResponse, setLastResponse]);

  if (onChat) {
    // On the chat screen we only surface a textual reply that arrived during a
    // reading — so the answer is visible without the chat scrolling away from
    // the verse. Listening/transcript stay off-overlay here (the composer
    // handles those).
    if (lastResponse?.kind !== 'reply') return null;
  } else {
    if (!overlayOpen) return null;
    if (!listening && !transcript && !lastResponse) return null;
  }

  // Anchor near mic — opposite vertical side stays the same, just nudge the
  // overlay inward from the mic.
  const anchorBase = getMicAnchor({ corner, route: location.pathname, composerHeight });
  const overlayStyle: React.CSSProperties = { position: 'fixed', zIndex: 49, maxWidth: 320 };
  if (anchorBase.top !== undefined) overlayStyle.top = anchorBase.top + OVERLAY_GAP;
  if (anchorBase.bottom !== undefined) overlayStyle.bottom = anchorBase.bottom + OVERLAY_GAP;
  if (anchorBase.left !== undefined) overlayStyle.left = anchorBase.left;
  if (anchorBase.right !== undefined) overlayStyle.right = anchorBase.right;

  return (
    <div
      style={overlayStyle}
      className="rounded-2xl bg-navy-deep border border-gold/30 shadow-2xl p-4 text-sm text-cream"
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={clsx(
            'inline-flex items-center gap-2 text-xs',
            listening ? 'text-gold' : 'text-cream-dim',
          )}
        >
          {listening && (
            <span className="inline-block w-2 h-2 rounded-full bg-gold animate-pulse-soft" />
          )}
          {listening ? t('voice.overlay.listening') : t('app.title')}
        </span>
        <button
          type="button"
          aria-label={t('voice.overlay.dismiss')}
          onClick={dismiss}
          className="text-cream-dim hover:text-cream transition-colors px-1"
        >
          ×
        </button>
      </div>

      {transcript && !lastResponse && (
        <p className="font-serif italic text-cream/90 mb-2 line-clamp-3">
          {transcript || '…'}
        </p>
      )}

      {lastResponse?.kind === 'reading' && (
        <div className="mb-2">
          <p className="font-serif text-gold mb-1">{lastResponse.reference}</p>
          <button
            type="button"
            onClick={() => audioPlayback.toggle()}
            className="btn-ghost h-9 px-3 text-xs"
          >
            {status === 'playing' ? t('playback.pause') : t('playback.play')}
          </button>
        </div>
      )}

      {lastResponse?.kind === 'reply' && (
        <p className="font-serif text-cream/95 mb-2 leading-relaxed line-clamp-4">
          {lastResponse.text}
        </p>
      )}

      {lastResponse && !onChat && (
        <button
          type="button"
          onClick={openInChat}
          className="w-full h-9 rounded-lg border border-gold/30 text-gold text-xs hover:bg-gold/10 transition-colors"
        >
          {t('voice.overlay.openInChat')} →
        </button>
      )}
    </div>
  );
}
