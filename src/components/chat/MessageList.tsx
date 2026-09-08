import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useAutoScrollActiveVerse } from '@/hooks/useAutoScrollActiveVerse';
import { MessageBubble } from './MessageBubble';
import { ReaderPanel } from './ReaderPanel';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { ChatMessage } from '@/types/domain';

type Props = {
  scrollRef: RefObject<HTMLDivElement | null>;
};

export function MessageList({ scrollRef }: Props) {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const readingOnly = useSettingsStore((s) => s.readingOnlyView);
  const selectedIndex = useChatStore((s) => s.selectedIndex);
  const setSelected = useChatStore((s) => s.setSelected);
  const highlightedId = useChatStore((s) => s.highlightedMessageId);
  const setHighlightedId = useChatStore((s) => s.setHighlightedMessageId);
  const lastCountRef = useRef(0);
  const playbackStatus = usePlaybackStore((s) => s.status);
  const { send } = useCommandPipeline();

  useAutoScrollActiveVerse(scrollRef);

  useEffect(() => {
    if (messages.length > lastCountRef.current && scrollRef.current) {
      // While a reading is in progress, keep the user's place: the active-verse
      // auto-scroll governs the view, so don't yank to the bottom when an
      // assistant reply or a newly-queued chapter is appended below.
      const readingInProgress =
        playbackStatus === 'playing' || playbackStatus === 'paused';
      if (!readingInProgress) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }
    lastCountRef.current = messages.length;
  }, [messages.length, playbackStatus, scrollRef]);

  // When VoiceOverlay's "Open in chat" highlights a message, scroll it into view
  // and clear the highlight after the gold flash settles.
  useEffect(() => {
    if (!highlightedId) return;
    const idx = messages.findIndex((m) => m.id === highlightedId);
    if (idx >= 0) {
      setSelected(idx);
      const el = scrollRef.current?.querySelector(
        `[data-message-id="${highlightedId}"]`,
      );
      if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const t = window.setTimeout(() => setHighlightedId(null), 1200);
    return () => window.clearTimeout(t);
  }, [highlightedId, messages, scrollRef, setHighlightedId, setSelected]);

  const handleReask = (msg: ChatMessage) => {
    if (msg.role === 'user') {
      void send(msg.text);
      return;
    }
    // Walk backward to most recent user message.
    const idx = messages.findIndex((m) => m.id === msg.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        void send(messages[i].text);
        return;
      }
    }
  };

  const readingCount = messages.reduce(
    (n, m) => n + (m.role === 'assistant' && (m.verses?.length ?? 0) > 0 ? 1 : 0),
    0,
  );

  return (
    <div
      ref={scrollRef}
      // pb reserves room for the fixed mic / playback-bar floaters that sit
      // over the bottom corners, so the last message and its Continue button
      // can scroll clear of them instead of hiding underneath.
      className="flex-1 overflow-y-auto px-3 pt-4 pb-20 space-y-3"
    >
      {messages.length === 0 && (
        <div className="text-center text-ink-muted py-12 px-4">
          <p className="font-serif italic">{t('chat.empty')}</p>
        </div>
      )}
      {readingOnly && messages.length > 0 && readingCount === 0 && (
        <div className="text-center text-ink-muted py-12 px-4">
          <p className="font-serif italic">{t('chat.readingViewEmpty')}</p>
        </div>
      )}
      {messages.map((m, i) => {
        const isReading =
          m.role === 'assistant' && (m.verses?.length ?? 0) > 0;
        // Reading-only view: keep the original index (for selection) by
        // returning null rather than filtering the array.
        if (readingOnly && !isReading) return null;
        const selected = i === selectedIndex;
        return (
          <div key={m.id} data-message-id={m.id}>
            {isReading ? (
              <ReaderPanel
                message={m}
                selected={selected}
                onSelect={() => setSelected(i)}
              />
            ) : (
              <MessageBubble
                message={m}
                selected={selected}
                onSelect={() => setSelected(i)}
                onReask={handleReask}
              />
            )}
          </div>
        );
      })}
      <ThinkingIndicator />
    </div>
  );
}
