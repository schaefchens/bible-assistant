import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';

export function ChatHeader() {
  const { t } = useTranslation();
  const messageCount = useChatStore((s) => s.messages.length);
  const clear = useChatStore((s) => s.clear);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const items: MessageActionItem[] = [
    {
      key: 'clear',
      label: t('chat.clear'),
      destructive: true,
      onClick: () => {
        if (window.confirm(t('chat.clearConfirm'))) clear();
      },
    },
  ];

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-navy-soft/50 bg-navy/90 backdrop-blur">
        <h1 className="font-serif text-gold text-base tracking-wide">
          {t('chat.title')}
        </h1>
        <button
          type="button"
          aria-label={t('chat.clear')}
          disabled={messageCount === 0}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
            setMenuPos({ x: rect.right - 200, y: rect.bottom + 4 });
          }}
          className="text-cream-dim hover:text-cream disabled:opacity-30 px-2 py-1 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
      </header>
      {menuPos && (
        <MessageActionsMenu
          anchor={menuPos}
          items={items}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}
