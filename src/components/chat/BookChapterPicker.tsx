import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { BOOKS, getBookById } from '@/services/bible/bookCatalog';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import {
  BIBLE_SOURCE,
  expandList,
  formatSegment,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { progressStats } from '@/services/reading/readingProgress';
import { TranslationList } from '@/components/bible/TranslationList';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { playSegmentInChat } from '@/lib/readingListPlayback';

type View = 'books' | 'chapters' | 'translations' | 'lists';

/** One day of a reading list, as the picker shows it. */
type DayGroup = {
  title: string | null;
  titled: boolean;
  items: SegmentRef[];
  /** Every passage in it has been read — the group is behind you. */
  done: boolean;
};

/**
 * How many passages an ungrouped list shows before paging. A list is a thing to
 * pick from, and a wall of ninety references is not something you pick from.
 */
const PASSAGES_PER_PAGE = 10;

function clampIndex(value: number, length: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, length - 1));
}

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

/**
 * One passage in the locked list: whether it has been read, where the reader is,
 * and what it is. The tick is an indicator, not a control — ticking lives on the
 * list screen, and a second tap target inside a narrow column would be a
 * mis-tap waiting to happen.
 */
function PassageRow({
  seg,
  lang,
  done,
  current,
  compact,
  onClick,
}: {
  seg: SegmentRef;
  lang: 'en' | 'de';
  done: boolean;
  current: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full flex items-baseline gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors',
        current ? 'bg-brand/10 ring-1 ring-brand/30' : 'hover:bg-brand/10 active:bg-brand/15',
      )}
    >
      {done ? (
        <CheckMark className="shrink-0 translate-y-px text-brand" />
      ) : (
        <span
          aria-hidden
          className="shrink-0 translate-y-px h-3 w-3 rounded-[3px] border border-ink-muted/40"
        />
      )}
      <span className="min-w-0">
        <span
          className={clsx(
            'block font-serif',
            compact ? 'text-[13px] leading-tight' : 'text-sm truncate',
            done ? 'text-ink-muted line-through' : 'text-ink',
          )}
        >
          {formatSegment(seg, lang)}
        </span>
        {seg.label && (
          <span
            className={clsx(
              'block text-[10px] text-ink-muted',
              compact ? 'leading-tight' : 'truncate',
            )}
          >
            {seg.label}
          </span>
        )}
      </span>
    </button>
  );
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Step one day (or one page) through a long list. */
function PagerButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-7 w-7 shrink-0 rounded-lg text-lg leading-none text-brand hover:bg-brand/10 disabled:opacity-25 disabled:pointer-events-none transition-colors"
    >
      {children}
    </button>
  );
}

/** Edit glyph for the "manage this list" button on the selection row. */
function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
  const readingLists = useLibraryStore((s) => s.readingLists);
  const readingProgress = useLibraryStore((s) => s.readingProgress);
  /**
   * Which list the app is reading through — `useReaderStore.source` is that one
   * notion, so selecting a list here is the same act as selecting it on /read
   * and it survives closing the sheet. The picker doesn't keep its own copy;
   * "locked in" is exactly "this is the source".
   */
  const source = useReaderStore((s) => s.source);
  const setSource = useReaderStore((s) => s.setSource);

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

  const lockedList =
    source.kind === 'list'
      ? readingLists.find((l) => l.id === source.listId) ?? null
      : null;
  const lockedProgress = lockedList ? readingProgress[lockedList.id] : undefined;

  /**
   * The locked list's passages, grouped the way the list is written, with
   * whether each group is finished. A plain list (one untitled day) gets no
   * heading — "Day 1" over a collection of favourite psalms would invent a
   * structure the user didn't ask for.
   */
  const dayGroups = useMemo<DayGroup[]>(() => {
    if (!lockedList) return [];
    const done = new Set(lockedProgress?.completed ?? []);
    const groups: DayGroup[] = [];
    let currentDay: number | undefined;
    for (const seg of expandList(lockedList, translation)) {
      if (groups.length === 0 || seg.dayIndex !== currentDay) {
        currentDay = seg.dayIndex;
        groups.push({
          title: seg.dayTitle ?? null,
          titled: seg.dayTitle !== undefined,
          items: [seg],
          done: false,
        });
      } else {
        groups[groups.length - 1].items.push(seg);
      }
    }
    for (const g of groups) {
      g.done = g.items.length > 0 && g.items.every((i) => !!i.entryId && done.has(i.entryId));
    }
    return groups;
  }, [lockedList, lockedProgress, translation]);

  const grouped = dayGroups.length > 1;

  /**
   * Which group is "today": the one holding the entry the user is on, else the
   * first with anything unread, else the last. Reading a plan should open on the
   * day you're actually in, not on day 1 of 90.
   */
  const currentDay = useMemo(() => {
    if (dayGroups.length === 0) return 0;
    const currentEntryId = lockedProgress?.currentEntryId;
    if (currentEntryId) {
      const at = dayGroups.findIndex((g) => g.items.some((i) => i.entryId === currentEntryId));
      if (at !== -1) return at;
    }
    const firstUnread = dayGroups.findIndex((g) => !g.done);
    return firstUnread === -1 ? dayGroups.length - 1 : firstUnread;
  }, [dayGroups, lockedProgress]);

  /**
   * The paged/windowed position, stamped with the list it belongs to so
   * selecting another list falls back to that list's own "today" without an
   * effect to reset it.
   */
  const [browsePos, setBrowsePos] = useState<{ listId: string; at: number } | null>(null);
  const browsing = browsePos && browsePos.listId === lockedList?.id ? browsePos.at : null;

  const flatItems = useMemo(() => dayGroups.flatMap((g) => g.items), [dayGroups]);
  const pageCount = Math.max(1, Math.ceil(flatItems.length / PASSAGES_PER_PAGE));
  /** A flat list opens on the page holding the current entry. */
  const currentPage = useMemo(() => {
    const currentEntryId = lockedProgress?.currentEntryId;
    if (!currentEntryId) return 0;
    const at = flatItems.findIndex((i) => i.entryId === currentEntryId);
    return at === -1 ? 0 : Math.floor(at / PASSAGES_PER_PAGE);
  }, [flatItems, lockedProgress]);

  const focusDay = clampIndex(browsing ?? currentDay, dayGroups.length);
  const page = clampIndex(browsing ?? currentPage, pageCount);
  /** Previous / current / next, dropping the ends of the list. */
  const windowDays = [focusDay - 1, focusDay, focusDay + 1].filter(
    (i) => i >= 0 && i < dayGroups.length,
  );

  const stepBrowse = (delta: number) => {
    if (!lockedList) return;
    const limit = grouped ? dayGroups.length : pageCount;
    const from = grouped ? focusDay : page;
    setBrowsePos({ listId: lockedList.id, at: clampIndex(from + delta, limit) });
  };
  const canBrowseBack = (grouped ? focusDay : page) > 0;
  const canBrowseOn = (grouped ? focusDay : page) < (grouped ? dayGroups.length : pageCount) - 1;

  const headerTitle =
    view === 'translations'
      ? t('chat.bookPicker.translations')
      : view === 'chapters'
        ? bookLabel(selectedBook)
        : view === 'lists'
          ? t('lists.title')
          : lockedList
            ? t('chat.bookPicker.titleList')
            : t('chat.bookPicker.title');

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
                    onClick={() => setView('books')}
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
                  <div
                    className={clsx(
                      'flex items-center gap-1 rounded-xl pl-3 pr-1.5 py-1',
                      'bg-surface/60 border transition-colors',
                      lockedList
                        ? 'border-brand/60'
                        : 'border-brand/30 hover:border-brand/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setView('lists')}
                      className="flex-1 min-w-0 flex items-center gap-3 py-1.5 text-left"
                    >
                      <ListIcon className="text-brand shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-serif text-brand text-sm truncate">
                          {lockedList
                            ? `${lockedList.emoji ? `${lockedList.emoji} ` : ''}${lockedList.name || t('lists.untitled')}`
                            : t('chat.bookPicker.readingLists')}
                        </span>
                        {lockedList && (
                          <span className="block text-[11px] text-ink-muted/80 mt-0.5">
                            {t('lists.progress', progressStats(lockedList, lockedProgress))}
                          </span>
                        )}
                      </span>
                      {!lockedList && <ChevronRight />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(lockedList ? `/lists/${lockedList.id}` : '/lists');
                      }}
                      aria-label={t('lists.manage') as string}
                      title={t('lists.manage') as string}
                      className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors"
                    >
                      <PencilIcon />
                    </button>

                    {/* Clearing the selection is its own control, because
                        picking a chapter is no longer reachable while a list is
                        showing its passages instead of the books. */}
                    {lockedList && (
                      <button
                        type="button"
                        onClick={() => void setSource(BIBLE_SOURCE)}
                        aria-label={t('chat.bookPicker.clearList') as string}
                        title={t('chat.bookPicker.clearList') as string}
                        className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors text-xl leading-none"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              )}

              {view === 'books' && !lockedList && (
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

              {view === 'books' && lockedList && (
                <div className="flex-1 min-h-0 overflow-y-auto pb-safe">
                  {dayGroups.length === 0 ? (
                    <p className="py-8 text-center text-ink-muted text-sm">
                      {t('lists.emptyList')}
                    </p>
                  ) : (
                    <>
                      {/* One pager for both shapes: days for a plan, pages of
                          passages for a plain list. */}
                      <div className="flex items-center justify-between gap-2 px-5 py-2">
                        <PagerButton
                          onClick={() => stepBrowse(-1)}
                          disabled={!canBrowseBack}
                          label={t('chat.bookPicker.earlier') as string}
                        >
                          ‹
                        </PagerButton>
                        <span className="text-[11px] uppercase tracking-wider text-ink-muted/70">
                          {grouped
                            ? t('chat.bookPicker.dayOf', {
                                day: focusDay + 1,
                                total: dayGroups.length,
                              })
                            : t('chat.bookPicker.pageOf', { page: page + 1, total: pageCount })}
                        </span>
                        <PagerButton
                          onClick={() => stepBrowse(1)}
                          disabled={!canBrowseOn}
                          label={t('chat.bookPicker.later') as string}
                        >
                          ›
                        </PagerButton>
                      </div>

                      {grouped ? (
                        /* Yesterday, today, tomorrow. The middle column is the
                           one you're in; the neighbours are context, and are
                           dimmed and narrower so the eye doesn't have to work
                           out which is which. */
                        <div className="flex gap-1 px-2 pb-2">
                          {windowDays.map((dayIndex) => {
                            const group = dayGroups[dayIndex];
                            const focused = dayIndex === focusDay;
                            return (
                              <section
                                key={dayIndex}
                                className={clsx(
                                  'min-w-0 rounded-xl px-1.5 py-2 transition-colors',
                                  focused ? 'flex-[1.6]' : 'flex-1 opacity-60',
                                  group.done && 'bg-brand/5 ring-1 ring-brand/20',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => setBrowsePos({ listId: lockedList.id, at: dayIndex })}
                                  disabled={focused}
                                  className={clsx(
                                    'w-full flex items-baseline gap-1 px-1.5 pb-1.5 text-left',
                                    'text-[10px] uppercase tracking-wider font-serif leading-tight',
                                    focused ? 'text-brand' : 'text-ink-muted/70',
                                  )}
                                >
                                  {group.done && <CheckMark className="shrink-0 translate-y-px" />}
                                  <span className="min-w-0">
                                    {group.title ?? t('lists.day', { number: dayIndex + 1 })}
                                  </span>
                                </button>
                                <ul>
                                  {group.items.map((seg, i) => (
                                    <li key={`${seg.entryId ?? seg.bookId}:${seg.chapter}:${i}`}>
                                      <PassageRow
                                        seg={seg}
                                        lang={lang}
                                        done={
                                          !!seg.entryId &&
                                          (lockedProgress?.completed.includes(seg.entryId) ?? false)
                                        }
                                        current={
                                          !!seg.entryId &&
                                          lockedProgress?.currentEntryId === seg.entryId
                                        }
                                        compact
                                        onClick={() => pickSegment(seg)}
                                      />
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            );
                          })}
                        </div>
                      ) : (
                        <ul className="px-5 pb-2">
                          {flatItems
                            .slice(page * PASSAGES_PER_PAGE, (page + 1) * PASSAGES_PER_PAGE)
                            .map((seg, i) => (
                              <li key={`${seg.entryId ?? seg.bookId}:${seg.chapter}:${i}`}>
                                <PassageRow
                                  seg={seg}
                                  lang={lang}
                                  done={
                                    !!seg.entryId &&
                                    (lockedProgress?.completed.includes(seg.entryId) ?? false)
                                  }
                                  current={
                                    !!seg.entryId &&
                                    lockedProgress?.currentEntryId === seg.entryId
                                  }
                                  onClick={() => pickSegment(seg)}
                                />
                              </li>
                            ))}
                        </ul>
                      )}
                    </>
                  )}
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
                                void setSource({ kind: 'list', listId: list.id });
                                setView('books');
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
