import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { playFromVerseWord } from '@/lib/startPlayback';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useContinueReading } from '@/hooks/useContinueReading';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { useReadingSurface } from '@/hooks/useReadingSurface';
import { paintsOwnPaper } from '@/lib/readingAppearance';
import { getBookById } from '@/services/bible/bookCatalog';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';
import { copyText, shareText } from '@/lib/nativeBridge';
import type { ChatMessage } from '@/types/domain';
import { DotsIcon } from '@/components/common/icons';

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

  const surfaceRef = useRef<HTMLElement>(null);
  const surfaceClass = useReadingSurface(surfaceRef);
  const ownPaper = useSettingsStore((s) => paintsOwnPaper(s.readingAppearance));

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingAction, setPendingAction] = useState<
    'prev' | 'context' | 'continue' | null
  >(null);

  // Clear the morph when the in-flight processing cycle ends (true → false),
  // so a later request (mic, etc.) doesn't reuse this panel's stale label.
  useEffect(() => {
    let prev = useChatStore.getState().isProcessing;
    return useChatStore.subscribe((state) => {
      const cur = state.isProcessing;
      if (prev && !cur) setPendingAction(null);
      prev = cur;
    });
  }, []);

  const handleWordTap = useCallback(
    (verseIdx: number, wordIdx: number) => {
      if (!message.verses?.length) return;
      playFromVerseWord(message.id, message.verses, verseIdx, wordIdx);
    },
    [message.id, message.verses],
  );

  const verses = useMemo(() => message.verses ?? [], [message.verses]);
  // When the reading is isolated verses (not a whole chapter), offer a
  // "Read context" button that loads the full surrounding chapter. Uses the
  // first verse's chapter — sufficient for the common single-chapter case.
  const contextTarget = useMemo(() => {
    if (message.headingWholeChapter === true) return null;
    const first = verses[0];
    if (!first) return null;
    const book = getBookById(first.bookId);
    if (!book) return null;
    const lang = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
    const bookName = lang === 'de' ? book.nameDe : book.nameEn;
    return {
      reference: `${book.nameEn} ${first.chapter}`,
      label: `${bookName} ${first.chapter}`,
    };
  }, [verses, message.headingWholeChapter, i18n.language]);
  // For whole-chapter readings, offer a previous-chapter button alongside
  // continue. Only meaningful when there is a previous chapter to read.
  const prevTarget = useMemo(() => {
    if (message.headingWholeChapter !== true) return null;
    const first = verses[0];
    if (!first || first.chapter <= 1) return null;
    const book = getBookById(first.bookId);
    if (!book) return null;
    const lang = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
    const bookName = lang === 'de' ? book.nameDe : book.nameEn;
    const prevChapter = first.chapter - 1;
    return {
      reference: `${book.nameEn} ${prevChapter}`,
      label: `${bookName} ${prevChapter}`,
    };
  }, [verses, message.headingWholeChapter, i18n.language]);
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
        if (text) void copyText(text);
      },
    },
    {
      key: 'share',
      label: t('chat.actions.share'),
      onClick: () => {
        const text = verses.map((v) => `${v.display}\n${v.text}`).join('\n\n');
        // Falls back to a clipboard copy when there's no share sheet.
        if (text) void shareText(text);
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
        ref={surfaceRef}
        onClick={onSelect}
        className={clsx(
          surfaceClass,
          'card-paper rounded-r-2xl rounded-l-md my-1 px-4 py-3',
          'border-l-2 border-brand/70 transition-all',
          // Until the user picks a paper of their own this is chat furniture and
          // keeps its translucent bubble; once they have, the verses deserve to
          // sit on it.
          ownPaper ? 'bg-surface' : 'bg-surface-raised/20',
          selected && 'border-l-4 border-brand ring-1 ring-brand/30',
          isHighlighted && 'ring-2 ring-brand animate-pulse-soft',
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
            <div key={`${run.headerKey}-${ri}`} className={ri > 0 ? 'mt-4 pt-4 border-t border-brand/15' : ''}>
              <header className="flex items-baseline justify-between mb-2 gap-2">
                <h3 className="font-serif text-brand text-[1.1em] leading-tight">
                  {headerLabel}
                </h3>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider text-brand-muted">
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
                      className="text-ink-muted hover:text-ink transition-colors px-1 -mr-1"
                    >
                      <DotsIcon />
                    </button>
                  )}
                </div>
              </header>
              <div className="text-ink/95 space-y-1">
                {run.items.map((v) => {
                  const verseIdx = verses.indexOf(v);
                  return (
                    <WordHighlighter
                      key={`${v.bookId}-${v.chapter}-${v.verse}-${verseIdx}`}
                      groupId={message.id}
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

        {(prevTarget || contextTarget || cont.canContinue) && (
          <div className="mt-3 flex gap-2">
            {prevTarget && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingAction('prev');
                  void send(`Read ${prevTarget.reference}`);
                }}
                disabled={isProcessing}
                className={clsx(
                  'flex-1 min-w-0 h-10 px-1 text-[11px] leading-tight sm:text-sm rounded-xl border border-brand/30 text-brand',
                  'hover:bg-brand/10 active:scale-[0.98] transition-all',
                  isProcessing && 'pointer-events-none',
                  isProcessing && pendingAction !== 'prev' && 'opacity-50',
                )}
              >
                {pendingAction === 'prev' && isProcessing ? (
                  <LoadingButtonLabel
                    text={t('chat.reader.loading', { range: prevTarget.label })}
                  />
                ) : (
                  <>← {prevTarget.label}</>
                )}
              </button>
            )}
            {contextTarget && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingAction('context');
                  void send(`Read ${contextTarget.reference}`);
                }}
                disabled={isProcessing}
                className={clsx(
                  'flex-1 min-w-0 h-10 px-1 text-[11px] leading-tight sm:text-sm rounded-xl border border-brand/30 text-brand',
                  'hover:bg-brand/10 active:scale-[0.98] transition-all',
                  isProcessing && 'pointer-events-none',
                  isProcessing && pendingAction !== 'context' && 'opacity-50',
                )}
              >
                {pendingAction === 'context' && isProcessing ? (
                  <LoadingButtonLabel
                    text={t('chat.reader.loading', { range: contextTarget.label })}
                  />
                ) : (
                  t('chat.reader.context', { range: contextTarget.label })
                )}
              </button>
            )}
            {cont.canContinue && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingAction('continue');
                  cont.sendNext();
                }}
                disabled={isProcessing}
                className={clsx(
                  'flex-1 min-w-0 h-10 px-1 text-[11px] leading-tight sm:text-sm rounded-xl border border-brand/30 text-brand',
                  'hover:bg-brand/10 active:scale-[0.98] transition-all',
                  isProcessing && 'pointer-events-none',
                  isProcessing && pendingAction !== 'continue' && 'opacity-50',
                )}
              >
                {pendingAction === 'continue' && isProcessing ? (
                  <LoadingButtonLabel
                    text={t('chat.reader.loading', { range: cont.nextLabel })}
                  />
                ) : (
                  <>{t('chat.reader.continue', { range: cont.nextLabel })} →</>
                )}
              </button>
            )}
          </div>
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

function LoadingButtonLabel({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <span className="inline-flex gap-1" aria-hidden>
        <PulseDot delay="0ms" />
        <PulseDot delay="160ms" />
        <PulseDot delay="320ms" />
      </span>
      <span>{text}</span>
    </span>
  );
}

function PulseDot({ delay }: { delay: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-brand/80 animate-pulse-soft"
      style={{ animationDelay: delay }}
    />
  );
}
