import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { BOOKS, getBookById } from '@/services/bible/bookCatalog';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import {
  expandList,
  formatSegment,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { progressStats } from '@/services/reading/readingProgress';
import { TranslationList } from '@/components/bible/TranslationList';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { playSegmentInChat } from '@/lib/readingListPlayback';

type View = 'books' | 'chapters' | 'translations' | 'lists' | 'segments';

function BackChevron() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.3" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.3" fill="currentColor" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-muted shrink-0"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

type Props = {
  /**
   * What a chapter tap does. Omitted → the chat behaviour: ask the AI to read
   * it (`send('Read <BookEn> <chapter>')`). The reader passes its own handler to
   * navigate instead of going through the model.
   */
  onPick?: (bookId: number, chapter: number) => void;
  /**
   * What tapping a reading-list passage does. Omitted → read it aloud in the
   * chat, the same thing tapping a chapter does there. The reader passes its own
   * handler so the page navigates instead.
   */
  onPickSegment?: (ref: SegmentRef) => void;
  /** Custom trigger. Omitted → the small book-glyph icon button. */
  trigger?: (open: () => void) => React.ReactNode;
  /**
   * Show the reading lists. Opt-in rather than default because this sheet is
   * also used *inside* the reading-list editor to pick a passage, where a link
   * back out to the list index would be a trap.
   */
  showReadingLists?: boolean;
};

export function BookChapterPicker({
  onPick,
  onPickSegment,
  trigger,
  showReadingLists,
}: Props = {}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const translation = useSettingsStore((s) => s.translation);
  const setTranslation = useSettingsStore((s) => s.setTranslation);
  const { send } = useCommandPipeline();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('books');
  const [selectedBookId, setSelectedBookId] = useState<number>(1);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const readingLists = useLibraryStore((s) => s.readingLists);
  const readingProgress = useLibraryStore((s) => s.readingProgress);

  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const { ot, nt } = useMemo(
    () => ({
      ot: BOOKS.filter((b) => b.id <= 39),
      nt: BOOKS.filter((b) => b.id >= 40),
    }),
    [],
  );
  const selectedBook = getBookById(selectedBookId) ?? BOOKS[0];
  const currentTranslation = getTranslationInfo(translation);
  const chapters = useMemo(
    () => Array.from({ length: selectedBook.chapters }, (_, i) => i + 1),
    [selectedBook.chapters],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const bookLabel = (book: (typeof BOOKS)[number]) =>
    lang === 'de' ? book.nameDe : book.nameEn;

  const renderBookButton = (book: (typeof BOOKS)[number]) => (
    <button
      key={book.id}
      type="button"
      onClick={() => {
        setSelectedBookId(book.id);
        setView('chapters');
      }}
      className="w-full text-left px-3 py-2 text-sm leading-snug text-ink hover:bg-brand/10 active:bg-brand/15 transition-colors"
    >
      {bookLabel(book)}
    </button>
  );

  const selectedList = selectedListId
    ? readingLists.find((l) => l.id === selectedListId) ?? null
    : null;
  const segments = useMemo(
    () => (selectedList ? expandList(selectedList, translation) : []),
    [selectedList, translation],
  );

  const headerTitle =
    view === 'translations'
      ? t('chat.bookPicker.translations')
      : view === 'chapters'
        ? bookLabel(selectedBook)
        : view === 'lists'
          ? t('lists.title')
          : view === 'segments'
            ? selectedList?.name || t('lists.untitled')
            : t('chat.bookPicker.title');

  /** Where the sheet's back chevron goes — one level up, not always home. */
  const backTo: View = view === 'segments' ? 'lists' : 'books';

  const pickSegment = (ref: SegmentRef) => {
    // Keep this on both paths: the sheet tap is the user gesture that unlocks
    // the audio context on iOS.
    audioPlayback.ensureContext();
    if (onPickSegment) onPickSegment(ref);
    else void playSegmentInChat(ref);
    setOpen(false);
  };

  const openSheet = () => {
    setView('books');
    setOpen(true);
  };

  return (
    <>
      {trigger ? (
        trigger(openSheet)
      ) : (
        <button
          type="button"
          aria-label={t('chat.bookPicker.open') as string}
          title={t('chat.bookPicker.open') as string}
          onClick={openSheet}
          className="text-ink-muted hover:text-ink disabled:opacity-30 px-2 py-1 transition-colors"
        >
          <BookIcon />
        </button>
      )}

      {createPortal(
        <>
          <div
            aria-hidden={!open}
            onClick={() => setOpen(false)}
            className={clsx(
              'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
              open ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={headerTitle as string}
            className={clsx(
              'fixed left-0 right-0 bottom-0 z-50',
              'rounded-t-3xl bg-surface-sunken border-t border-brand/30 shadow-2xl',
              'transition-transform duration-300 ease-out will-change-transform',
              open ? 'translate-y-0' : 'translate-y-full',
            )}
            style={{ maxHeight: '85vh' }}
          >
            <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
              <div className="flex flex-col items-center pt-2 pb-1">
                <div className="h-1.5 w-12 rounded-full bg-ink/20" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3 gap-2">
                {view === 'books' ? (
                  <h2 className="font-serif text-brand text-lg truncate">{headerTitle}</h2>
                ) : (
                  <button
                    type="button"
                    onClick={() => setView(backTo)}
                    aria-label={t('chat.bookPicker.back') as string}
                    className="text-ink-muted hover:text-ink transition-colors -ml-1 px-1 flex items-center gap-1 min-w-0"
                  >
                    <BackChevron />
                    <span className="font-serif text-brand text-lg truncate">
                      {headerTitle}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close') as string}
                  className="text-ink-muted hover:text-ink transition-colors text-2xl leading-none px-2 shrink-0"
                >
                  ×
                </button>
              </div>

              {view === 'books' && (
                <div className="px-5 pb-3 border-b border-surface-raised/40">
                  <button
                    type="button"
                    onClick={() => setView('translations')}
                    aria-label={t('chat.bookPicker.changeTranslation') as string}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-xl px-3 py-2.5',
                      'bg-surface/60 border border-brand/30 hover:border-brand/60 hover:bg-surface/80',
                      'transition-colors text-left',
                    )}
                  >
                    <BookIcon className="text-brand shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-serif text-brand text-sm leading-tight truncate">
                        {currentTranslation.name}
                      </span>
                      <span className="block text-xs text-ink-muted/80 mt-0.5">
                        {currentTranslation.year} ·{' '}
                        {currentTranslation.language === 'de'
                          ? t('chat.bookPicker.languageDe')
                          : t('chat.bookPicker.languageEn')}
                      </span>
                    </span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-ink-muted shrink-0"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              )}

              {view === 'books' && showReadingLists && (
                <div className="px-5 pb-3 border-b border-surface-raised/40">
                  <button
                    type="button"
                    onClick={() => setView('lists')}
                    className={clsx(
                      'w-full flex items-center gap-3 rounded-xl px-3 py-2.5',
                      'bg-surface/60 border border-brand/30 hover:border-brand/60 hover:bg-surface/80',
                      'transition-colors text-left',
                    )}
                  >
                    <ListIcon className="text-brand shrink-0" />
                    <span className="flex-1 min-w-0 font-serif text-brand text-sm truncate">
                      {t('chat.bookPicker.readingLists')}
                    </span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-ink-muted shrink-0"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              )}

              {view === 'books' && (
                <div className="flex flex-1 min-h-0 pb-safe">
                  <div className="w-1/2 flex flex-col border-r border-surface-raised/40">
                    <h3 className="shrink-0 px-3 pt-2 pb-2 text-xs uppercase tracking-wider text-ink-muted/70 font-serif border-b border-surface-raised/40">
                      {t('chat.bookPicker.oldTestament')}
                    </h3>
                    <div className="flex-1 min-h-0 overflow-y-auto py-1">
                      {ot.map(renderBookButton)}
                    </div>
                  </div>
                  <div className="w-1/2 flex flex-col">
                    <h3 className="shrink-0 px-3 pt-2 pb-2 text-xs uppercase tracking-wider text-ink-muted/70 font-serif border-b border-surface-raised/40">
                      {t('chat.bookPicker.newTestament')}
                    </h3>
                    <div className="flex-1 min-h-0 overflow-y-auto py-1">
                      {nt.map(renderBookButton)}
                    </div>
                  </div>
                </div>
              )}

              {view === 'chapters' && (
                <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-safe">
                  <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 gap-2">
                    {chapters.map((chapter) => (
                      <button
                        key={chapter}
                        type="button"
                        // Only the chat path can be busy; a reader jump is
                        // always available.
                        disabled={onPick ? false : isProcessing}
                        onClick={() => {
                          // Keep this on both paths: the sheet tap is the user
                          // gesture that unlocks the audio context on iOS.
                          audioPlayback.ensureContext();
                          if (onPick) {
                            onPick(selectedBook.id, chapter);
                          } else {
                            void send(`Read ${selectedBook.nameEn} ${chapter}`);
                          }
                          setOpen(false);
                        }}
                        className={clsx(
                          'aspect-square rounded-xl bg-surface border border-surface-raised/50',
                          'text-ink text-sm font-mono',
                          'hover:bg-brand/10 hover:border-brand/40 active:scale-95',
                          'transition-colors',
                          'disabled:opacity-40 disabled:pointer-events-none',
                        )}
                      >
                        {chapter}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {view === 'lists' && (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">
                  {readingLists.length === 0 ? (
                    <p className="py-8 text-center text-ink-muted text-sm leading-relaxed">
                      {t('lists.empty')}
                    </p>
                  ) : (
                    <ul className="py-2 space-y-1">
                      {readingLists.map((list) => {
                        const stats = progressStats(list, readingProgress[list.id]);
                        return (
                          <li key={list.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedListId(list.id);
                                setView('segments');
                              }}
                              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand/10 active:bg-brand/15 transition-colors"
                            >
                              <span className="flex-1 min-w-0">
                                <span className="block font-serif text-ink text-sm truncate">
                                  {list.emoji ? `${list.emoji} ` : ''}
                                  {list.name || t('lists.untitled')}
                                </span>
                                <span className="block text-[11px] text-ink-muted mt-0.5">
                                  {t('lists.progress', { done: stats.done, total: stats.total })}
                                </span>
                              </span>
                              <ChevronRight />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate('/lists');
                    }}
                    className="w-full mt-1 mb-3 h-10 rounded-xl border border-brand/30 text-brand text-sm hover:bg-brand/10 transition-colors"
                  >
                    {t('lists.manage')}
                  </button>
                </div>
              )}

              {view === 'segments' && (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">
                  {segments.length === 0 ? (
                    <p className="py-8 text-center text-ink-muted text-sm">
                      {t('lists.emptyList')}
                    </p>
                  ) : (
                    <ul className="py-2">
                      {segments.map((seg, i) => {
                        const done =
                          !!seg.entryId &&
                          !!selectedList &&
                          (readingProgress[selectedList.id]?.completed.includes(seg.entryId) ??
                            false);
                        const current =
                          !!seg.entryId &&
                          !!selectedList &&
                          readingProgress[selectedList.id]?.currentEntryId === seg.entryId;
                        // Day heading whenever the day changes, so a plan reads
                        // as days rather than as one long column of references.
                        const newDay =
                          seg.dayIndex !== undefined &&
                          seg.dayIndex !== segments[i - 1]?.dayIndex;
                        return (
                          <li key={`${seg.entryId ?? seg.bookId}:${seg.chapter}:${i}`}>
                            {newDay && segments.some((s) => s.dayIndex !== 0) && (
                              <h3 className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-ink-muted/70 font-serif">
                                {seg.dayTitle || t('lists.day', { number: (seg.dayIndex ?? 0) + 1 })}
                              </h3>
                            )}
                            <button
                              type="button"
                              onClick={() => pickSegment(seg)}
                              className={clsx(
                                'w-full flex items-baseline gap-2 rounded-xl px-3 py-2 text-left transition-colors',
                                current ? 'bg-brand/10' : 'hover:bg-brand/10 active:bg-brand/15',
                              )}
                            >
                              <span
                                className={clsx(
                                  'font-serif text-sm truncate',
                                  done ? 'text-ink-muted line-through' : 'text-ink',
                                )}
                              >
                                {formatSegment(seg, lang)}
                              </span>
                              {seg.label && (
                                <span className="text-[11px] text-ink-muted truncate">
                                  {seg.label}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {view === 'translations' && (
                <TranslationList
                  value={translation}
                  onChange={(code) => {
                    setTranslation(code, true);
                    setView('books');
                  }}
                  className="flex-1 min-h-0 overflow-y-auto pb-safe"
                />
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
