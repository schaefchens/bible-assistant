import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import type { ChatMessage } from '@/types/domain';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';
import { useLongPress } from '@/hooks/useLongPress';

type Props = {
  message: ChatMessage;
  selected: boolean;
  onSelect: () => void;
  onReask: (message: ChatMessage) => void;
};

export function MessageBubble({ message, selected, onSelect, onReask }: Props) {
  const { t } = useTranslation();
  const highlightedId = useChatStore((s) => s.highlightedMessageId);
  const isHighlighted = highlightedId === message.id;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const isUser = message.role === 'user';

  const longPress = useLongPress((pos) => setMenuPos(pos));

  const items: MessageActionItem[] = [
    {
      key: 'copy',
      label: t('chat.actions.copy'),
      onClick: () => {
        if (message.text) void navigator.clipboard?.writeText(message.text);
      },
    },
    {
      key: 'reask',
      label: t('chat.actions.reask'),
      onClick: () => onReask(message),
    },
    {
      key: 'delete',
      label: t('chat.actions.delete'),
      destructive: true,
      onClick: () => {
        const idx = useChatStore
          .getState()
          .messages.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const next = useChatStore.getState().messages.slice();
          next.splice(idx, 1);
          useChatStore.setState({ messages: next });
        }
      },
    },
  ];

  if (message.text && !message.verses?.length) {
    // No verses on this bubble — that's the standard case for feedback/answer turns.
  }

  return (
    <>
      <div
        onClick={onSelect}
        {...longPress}
        className={clsx(
          'group relative rounded-2xl px-4 py-3 transition-all max-w-[85%]',
          isUser
            ? 'bg-navy-soft/60 ml-auto'
            : 'bg-navy-soft/30 mr-auto border-l-2 border-transparent',
          !isUser && 'font-serif text-cream/95',
          selected && 'message-selected',
          !isUser && selected && 'border-gold',
          isHighlighted && 'ring-2 ring-gold animate-pulse-soft',
        )}
      >
        {message.text && (
          <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && !message.text && (
          <p className="text-xs text-cream-dim italic">
            {message.toolCalls.map((tc) => tc.name).join(', ')}
          </p>
        )}
      </div>
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
