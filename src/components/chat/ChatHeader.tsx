import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useUpdateStore, applyUpdate } from '@/lib/pwaUpdate';
import { cancelAllActivity } from '@/hooks/useCommandPipeline';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';

export function ChatHeader() {
  const { t } = useTranslation();
  const messageCount = useChatStore((s) => s.messages.length);
  const clear = useChatStore((s) => s.clear);
  const online = useLibraryStore((s) => s.online);
  const needRefresh = useUpdateStore((s) => s.needRefresh);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const items: MessageActionItem[] = [
    {
      key: 'clear',
      label: t('chat.clear'),
      destructive: true,
      onClick: () => {
        if (window.confirm(t('chat.clearConfirm'))) {
          // Halt any in-flight chat/TTS/playback before wiping history;
          // otherwise reading + music keep going against an empty chat.
          cancelAllActivity();
          clear();
        }
      },
    },
  ];

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-navy-soft/50 bg-navy/90 backdrop-blur">
        <h1 className="font-serif text-gold text-base tracking-wide">
          {t('chat.title')}
        </h1>
        <div className="flex items-center gap-3">
          {needRefresh && (
            <button
              type="button"
              onClick={() => void applyUpdate()}
              aria-label={t('updates.bannerAvailable') as string}
              title={t('updates.bannerAvailable') as string}
              className="text-gold hover:text-gold/80 transition-colors animate-pulse"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <span
            aria-label={(online ? t('common.online') : t('common.offline')) as string}
            title={(online ? t('common.online') : t('common.offline')) as string}
            className={[
              'inline-block h-2 w-2 rounded-full',
              online ? 'bg-emerald-700' : 'bg-amber-500',
            ].join(' ')}
          />
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
        </div>
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
