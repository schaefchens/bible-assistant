import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startReadingPlaylist } from '@/lib/startPlayback';
import { useCommandPipeline, useContinueReading } from '@/hooks/useCommandPipeline';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { getBookById } from '@/services/bible/bookCatalog';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';
import type { ChatMessage } from '@/types/domain';

type Props = {
  message: ChatMessage;
  selected: boolean;
  onSelect: () => void;
};

export function ReaderPanel({ message, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const highlightedId = useChatStore((s) => s.highlightedMessageId);
  const isHighlighted = highlightedId === message.id;
  const { send } = useCommandPipeline();
  const cont = useContinueReading(message, send);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleWordTap = useCallback(
    (verseIdx: number, wordIdx: number) => {
      if (!message.verses?.length) return;
      const playbackCurrent = usePlaybackStore.getState().current;
      const sameMessage = playbackCurrent?.messageId === message.id;
      const onSameVerseTrack =
        sameMessage &&
        playbackCurrent.verseIndex === verseIdx &&
        playbackCurrent.isVerse;
      if (onSameVerseTrack) {
        audioPlayback.seekToWord(wordIdx);
        return;
      }
      if (sameMessage) {
        audioPlayback.goToVerseIndex(verseIdx, wordIdx);
        return;
      }
      void startReadingPlaylist(message.id, message.verses, verseIdx, wordIdx);
    },
    [message.id, message.verses],
  );

  const verses = useMemo(() => message.verses ?? [], [message.verses]);
  // Group adjacent verses into runs sharing the same book + chapter so we can
  // print a single chapter heading per run.
  const runs = useMemo(() => {
    const out: { headerKey: string; bookId: number; chapter: number; translation: string; items: typeof verses }[] = [];
    for (const v of verses) {
      const last = out[out.length - 1];
      if (last && last.bookId === v.bookId && last.chapter === v.chapter) {
        last.items.push(v);
      } else {
        out.push({
          headerKey: `${v.bookId}-${v.chapter}`,
          bookId: v.bookId,
          chapter: v.chapter,
          translation: v.translation,
          items: [v],
        });
      }
    }
    return out;
  }, [verses]);

  const menuItems: MessageActionItem[] = [
    {
      key: 'copy',
      label: t('chat.actions.copy'),
      onClick: () => {
        const text = verses
          .map((v) => `${v.verse} ${v.text}`)
          .join('\n');
        if (text) void navigator.clipboard?.writeText(text);
      },
    },
    {
      key: 'share',
      label: t('chat.actions.share'),
      onClick: () => {
        const text = verses.map((v) => `${v.display}\n${v.text}`).join('\n\n');
        if (navigator.share) {
          void navigator.share({ text });
        } else if (text) {
          void navigator.clipboard?.writeText(text);
        }
      },
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

  return (
    <>
      <article
        onClick={onSelect}
        className={clsx(
          'card-paper rounded-r-2xl rounded-l-md my-1 px-4 py-3 bg-navy-soft/20',
          'border-l-2 border-gold/70 transition-all',
          selected && 'border-l-4 border-gold ring-1 ring-gold/30',
          isHighlighted && 'ring-2 ring-gold animate-pulse-soft',
        )}
      >
        {runs.map((run, ri) => {
          const book = getBookById(run.bookId);
          const lang = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
          const bookName = book ? (lang === 'de' ? book.nameDe : book.nameEn) : `Book ${run.bookId}`;
          const showVerseScope = message.headingWholeChapter === false;
          let headerLabel = `${bookName} ${run.chapter}`;
          if (showVerseScope && run.items.length > 0) {
            const chapterSep = lang === 'de' ? ',' : ':';
            const listSep = lang === 'de' ? '.' : ',';
            const ranges: { start: number; end: number }[] = [];
            for (const v of run.items) {
              const last = ranges[ranges.length - 1];
              if (last && v.verse === last.end + 1) {
                last.end = v.verse;
              } else {
                ranges.push({ start: v.verse, end: v.verse });
              }
            }
            const versePart = ranges
              .map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`))
              .join(listSep);
            headerLabel = `${bookName} ${run.chapter}${chapterSep}${versePart}`;
          }
          const isFirstRun = ri === 0;
          return (
            <div key={`${run.headerKey}-${ri}`} className={ri > 0 ? 'mt-4 pt-4 border-t border-gold/15' : ''}>
              <header className="flex items-baseline justify-between mb-2 gap-2">
                <h3 className="font-serif text-gold text-lg leading-tight">
                  {headerLabel}
                </h3>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider text-gold-dim">
                    {run.translation}
                  </span>
                  {isFirstRun && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setMenuPos({ x: rect.left, y: rect.bottom + 4 });
                      }}
                      aria-label="More"
                      className="text-cream-dim hover:text-cream transition-colors px-1 -mr-1"
                    >
                      <DotsIcon />
                    </button>
                  )}
                </div>
              </header>
              <div className="font-serif text-cream/95 leading-7 space-y-1">
                {run.items.map((v) => {
                  const verseIdx = verses.indexOf(v);
                  return (
                    <WordHighlighter
                      key={`${v.bookId}-${v.chapter}-${v.verse}-${verseIdx}`}
                      messageId={message.id}
                      verseIndex={verseIdx}
                      verse={v}
                      onWordTap={handleWordTap}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {cont.canContinue && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cont.sendNext();
            }}
            disabled={isProcessing}
            className={clsx(
              'mt-3 w-full h-10 text-sm rounded-xl border border-gold/30 text-gold',
              'hover:bg-gold/10 active:scale-[0.98] transition-all',
              isProcessing && 'opacity-50 pointer-events-none',
            )}
          >
            {t('chat.reader.continue', { range: cont.nextLabel })} →
          </button>
        )}
      </article>
      {menuPos && (
        <MessageActionsMenu
          anchor={menuPos}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
