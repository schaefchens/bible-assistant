import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { MessageItem } from './MessageItem';

export function MessageList() {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const selectedIndex = useChatStore((s) => s.selectedIndex);
  const setSelected = useChatStore((s) => s.setSelected);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > lastCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    lastCountRef.current = messages.length;
  }, [messages.length]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
      {messages.length === 0 && (
        <div className="text-center text-cream-dim py-12 px-4">
          <p className="font-serif italic">{t('chat.empty')}</p>
        </div>
      )}
      {messages.map((m, i) => (
        <MessageItem
          key={m.id}
          message={m}
          selected={i === selectedIndex}
          onSelect={() => setSelected(i)}
        />
      ))}
      {isProcessing && (
        <div className="text-cream-dim text-sm italic px-4 animate-pulse-soft">
          {t('chat.thinking')}
        </div>
      )}
    </div>
  );
}
