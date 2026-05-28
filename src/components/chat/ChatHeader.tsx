import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useUpdateStore, applyUpdate } from '@/lib/pwaUpdate';
import { cancelAllActivity } from '@/hooks/useCommandPipeline';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';
import { BookChapterPicker } from './BookChapterPicker';

export function ChatHeader() {
  const { t } = useTranslation();
  const messageCount = useChatStore((s) => s.messages.length);
  const clear = useChatStore((s) => s.clear);
  const readingOnly = useSettingsStore((s) => s.readingOnlyView);
  const setReadingOnly = useSettingsStore((s) => s.setReadingOnlyView);
  const hideComposer = useSettingsStore((s) => s.hideComposer);
  const setHideComposer = useSettingsStore((s) => s.setHideComposer);
  const eyesFree = useGlobalVoiceStore((s) => s.eyesFreeMode);
  const setEyesFree = useGlobalVoiceStore((s) => s.setEyesFreeMode);
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
        <div className="flex items-center gap-3">
          <BookChapterPicker />
          <h1 className="font-serif text-gold text-base tracking-wide">
            {t('chat.title')}
          </h1>
        </div>
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
          <button
            type="button"
            aria-label={t('chat.readingView') as string}
            title={t('chat.readingView') as string}
            aria-pressed={readingOnly}
            onClick={() => setReadingOnly(!readingOnly)}
            className={clsx(
              'px-2 py-1 rounded-lg transition-colors',
              readingOnly
                ? 'text-gold bg-gold/15'
                : 'text-cream-dim hover:text-cream',
            )}
          >
            <ReadingViewIcon active={readingOnly} />
          </button>
          <button
            type="button"
            aria-label={t('chat.hideComposer') as string}
            title={t('chat.hideComposer') as string}
            aria-pressed={hideComposer}
            onClick={() => setHideComposer(!hideComposer)}
            className={clsx(
              'px-2 py-1 rounded-lg transition-colors',
              hideComposer
                ? 'text-gold bg-gold/15'
                : 'text-cream-dim hover:text-cream',
            )}
          >
            <KeyboardIcon hidden={hideComposer} />
          </button>
          <button
            type="button"
            aria-label={t('chat.eyesFree') as string}
            title={t('chat.eyesFree') as string}
            aria-pressed={eyesFree}
            onClick={() => setEyesFree(!eyesFree)}
            className={clsx(
              'px-2 py-1 rounded-lg transition-colors',
              eyesFree
                ? 'text-gold bg-gold/15'
                : 'text-cream-dim hover:text-cream',
            )}
          >
            <EyesFreeIcon active={eyesFree} />
          </button>
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

// Open book when filtering to readings only; book with a small "lines"
// overlay (i.e. full chat) when showing everything.
function ReadingViewIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 6.5C10.5 5 8 4.5 4 5v13c4-.5 6.5 0 8 1.5 1.5-1.5 4-2 8-1.5V5c-4-.5-6.5 0-8 1.5z" />
      <line x1="12" y1="6.5" x2="12" y2="19" />
      {!active && (
        <>
          <line x1="6.5" y1="9" x2="9.5" y2="9" />
          <line x1="14.5" y1="9" x2="17.5" y2="9" />
        </>
      )}
    </svg>
  );
}

// Target / "tap me anywhere" glyph for the hands-free toggle: a ring with
// four radial ticks and a filled center dot when the mode is active.
function EyesFreeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" fill={active ? 'currentColor' : 'none'} />
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </svg>
  );
}

// Keyboard outline; a strike-through when the composer is hidden.
function KeyboardIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <line x1="7" y1="11" x2="7" y2="11" />
      <line x1="11" y1="11" x2="11" y2="11" />
      <line x1="15" y1="11" x2="15" y2="11" />
      <line x1="8" y1="14.5" x2="16" y2="14.5" />
      {hidden && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}
