import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';
import { useCommunityStore } from '@/store/communityStore';
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
  spaceSequence,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { groupSubscriptionsByAuthor, resolveSpaceFrom } from '@/services/community/spaceReading';
import { ROUTES } from '@/lib/appRoutes';
import { isFlatList, listChapterCount, passageDetail } from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import { PassageRow } from '@/components/reading/PassageRow';
import { NarrationDownloadButton } from '@/components/reader/NarrationDownloadButton';
import { NarrationGroupButton } from '@/components/reader/NarrationGroupButton';
import { subjectsForSegments } from '@/lib/narrationGroup';
import { useNewPieceSelections } from '@/hooks/useNewPieceSelections';
import { ProgressBar } from '@/components/reading/ProgressBar';
import { TranslationList } from '@/components/bible/TranslationList';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { playSegmentInChat } from '@/lib/readingListPlayback';
import { BottomSheet } from '@/components/common/BottomSheet';
import { spaceDisplayName, spaceLabel } from '@/services/community/spaceName';
import {
  BookIcon,
  CheckIcon,
  ChevronIcon,
  ListIcon,
  PencilIcon,
  PlayIcon,
  QuillIcon,
} from '@/components/common/icons';

type View = 'books' | 'chapters' | 'translations' | 'lists' | 'spaces';

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


/**
 * The glyph for whatever the reader is walking through.
 *
 * Exported, and the mapping lives here rather than in the reader's header,
 * because these are the picker's own marks — each one labels a row *in this
 * sheet*. The header's trigger has to answer with the same glyph the user
 * tapped to get there, and two copies of the mapping would drift apart the
 * first time a fourth kind of source exists.
 *
 * A selection ("everything new", "today from everyone") takes the quill too: it
 * is drawn from spaces, and a fourth mark would imply a fourth kind of thing.
 *
 * The size is normalised here because the three glyphs are drawn at different
 * sizes in the sheet, where they sit in separate rows — in the header they
 * share one slot and have to match.
 */
export function SourceIcon({
  source,
  className,
}: {
  source: ReaderSource;
  className?: string;
}) {
  const size = clsx('h-[18px] w-[18px]', className);
  if (source.kind === 'list') return <ListIcon className={size} />;
  if (source.kind === 'space' || source.kind === 'selection') return <QuillIcon className={size} />;
  return <BookIcon className={size} />;
}

/**
 * One selectable source in the spaces list.
 *
 * The background and hover live on the *wrapper*, not the button, so a row can
 * carry a control of its own (`trailing`) beside the tap target rather than
 * inside it — a button in a button is invalid, and here it would mean
 * downloading a selection was one mis-tap away from opening it.
 */
function SourceRow({
  label,
  emoji,
  detail,
  onSelect,
  trailing,
  disabled = false,
}: {
  label: string;
  emoji?: string;
  detail: string;
  onSelect: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1 rounded-xl bg-surface/60 transition-colors',
        !disabled && 'hover:bg-brand/10',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex-1 min-w-0 text-left px-3 py-2 disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          {emoji && <span aria-hidden>{emoji}</span>}
          <span className="font-serif text-brand text-sm truncate">{label}</span>
        </span>
        <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
      </button>
      {trailing && <span className="shrink-0 pr-1.5">{trailing}</span>}
    </div>
  );
}

/**
 * One author's spaces behind a single row.
 *
 * **Closed by default**, because the whole point is a shorter list: someone
 * who follows five people with three spaces each was looking at fifteen rows
 * where five will do. The count is on the closed row so a collapsed group still
 * says how much is inside it.
 *
 * A component rather than a branch in the loop, so each group owns its own open
 * state — a hook cannot live inside a `map`.
 */
function AuthorGroup({
  ownerName,
  detail,
  children,
}: {
  ownerName: string;
  detail: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 rounded-xl bg-surface/60 hover:bg-brand/10 transition-colors flex items-center gap-2"
      >
        <Caret open={open} />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-brand text-sm truncate">{ownerName}</span>
          <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
        </span>
      </button>
      {/* Indented under a rule, so a space inside a group is unmistakably one of
          that author's rather than the next row down. */}
      {open && (
        <ul className="mt-1 mb-1 ml-3 pl-2 space-y-1 border-l border-brand/20">{children}</ul>
      )}
    </li>
  );
}

// Named wrappers over the shared glyphs, so a call site says what the mark
// *means* here rather than restating its size and stroke every time.

/** The group's disclosure marker: right when closed, down when open. */
const Caret = ({ open }: { open: boolean }) => (
  <ChevronIcon
    size={14}
    stroke={2.4}
    className={clsx('text-brand-muted shrink-0 transition-transform', open && 'rotate-90')}
  />
);

/** A row that leads somewhere. */
const ChevronRight = () => <ChevronIcon size={18} className="text-ink-muted shrink-0" />;

/** Small enough to sit inside a row's label. */
const PlayGlyph = () => <PlayIcon size={11} />;

const CheckMark = ({ className }: { className?: string }) => (
  <CheckIcon size={12} stroke={3.5} className={className} />
);

/** Step one day (or one page) through a long list. */
/**
 * Step one day (or one page). Shows where it goes when there's a name for it —
 * "‹ Day 1" beats a bare chevron for knowing whether stepping back is worth it.
 */
function PagerButton({
  onClick,
  disabled,
  label,
  side,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  side: 'start' | 'end';
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        'flex items-center gap-1 min-w-0 max-w-[38%] shrink h-7 px-1.5 rounded-lg',
        'text-[11px] uppercase tracking-wider text-ink-muted',
        'hover:bg-brand/10 hover:text-brand disabled:opacity-25 disabled:pointer-events-none transition-colors',
        side === 'end' && 'flex-row-reverse',
      )}
    >
      <span className="text-base leading-none">{side === 'start' ? '‹' : '›'}</span>
      {children && (
        <span className="flex items-center gap-1 min-w-0">{children}</span>
      )}
    </button>
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
  /**
   * What the Continue button does. Omitted → read it aloud in the chat, like
   * tapping a passage there. The reader passes its own so Continue *plays*
   * rather than just jumping, which is what tapping does on that screen.
   */
  onContinue?: (ref: SegmentRef) => void;
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
  onContinue,
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
  const readerPosition = useReaderStore((s) => s.position);
  const communityProfile = useCommunityStore((s) => s.profile);
  const profileName = communityProfile?.displayName ?? '';
  const ownSpaces = useCommunityStore((s) => s.spaces);
  const ownPosts = useCommunityStore((s) => s.posts);
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);
  const seen = useCommunityStore((s) => s.seen);
  const setSource = useReaderStore((s) => s.setSource);
  const setEntryDone = useLibraryStore((s) => s.setEntryDone);
  // The two cross-space readings, offered as the first two rows of the spaces
  // list. Closing the sheet is this screen's part of opening one.
  const closeSheet = useCallback(() => setOpen(false), []);
  const { hasSubscriptions, allNew, today } = useNewPieceSelections(closeSheet);

  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const { ot, nt } = useMemo(
    () => ({
      ot: BOOKS.filter((b) => b.id <= 39),
      nt: BOOKS.filter((b) => b.id >= 40),
    }),
    [],
  );
  const selectedBook = getBookById(selectedBookId) ?? BOOKS[0];
  const authorGroups = useMemo(
    () => groupSubscriptionsByAuthor(subscriptions),
    [subscriptions],
  );
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
   * The space this sheet is locked into, if any.
   *
   * A second selector beside the reading-list one rather than one merged
   * "source" list: a reading plan and a person's writing are different kinds of
   * thing, and mixing them into one list makes neither scannable. Both write
   * `readerStore.source`, so they are mutually exclusive for free — locking one
   * unlocks the other.
   *
   * Resolved from subscribed slices rather than getState() so the sheet
   * re-renders when a feed refreshes.
   */
  const lockedSpace =
    source.kind === 'space'
      ? resolveSpaceFrom(source, {
          profile: communityProfile,
          spaces: ownSpaces,
          posts: ownPosts,
          subscriptions,
          feed,
        })
      : null;
  const spaceSegments = lockedSpace
    ? spaceSequence(lockedSpace.spaceId, lockedSpace.posts, translation).all() ?? []
    : [];
  // The row is worth showing once there is anything at all to choose from.
  const hasSpaces = ownSpaces.length > 0 || subscriptions.length > 0;

  /**
   * The locked list's passages, grouped the way the list is written, with
   * whether each group is finished. A plain list (one untitled day) gets no
   * heading — "Day 1" over a collection of favourite psalms would invent a
   * structure the user didn't ask for.
   */
  const dayGroups = useMemo<DayGroup[]>(() => {
    if (!lockedList) return [];
    const done = new Set(lockedProgress?.completed ?? []);
    // One group per day the list *has*, not per day its segments happen to
    // mention. A day with no entries yields no segments, so deriving the groups
    // from the segments alone dropped it — and a two-day plan whose second day
    // was still empty then rendered here as a flat, ungrouped list while the
    // editor showed it as Day 1 + Day 2 and the reader's heading said "Day 1".
    // Three answers to "is this a plan?"; `isFlatList` is the one that decides.
    const groups: DayGroup[] = lockedList.days.map((day) => ({
      title: day.title ?? null,
      titled: day.title !== undefined,
      items: [],
      done: false,
    }));
    for (const seg of expandList(lockedList, translation)) {
      // A flat list's segments carry no dayIndex, and it has exactly one day.
      groups[seg.dayIndex ?? 0]?.items.push(seg);
    }
    for (const g of groups) {
      g.done = g.items.length > 0 && g.items.every((i) => !!i.entryId && done.has(i.entryId));
    }
    return groups;
  }, [lockedList, lockedProgress, translation]);

  const grouped = !!lockedList && !isFlatList(lockedList);

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
    // An empty day is never "where you are": it has nothing to read, and it is
    // never `done` (that needs at least one ticked passage), so without this it
    // would swallow the window the moment the day before it was finished.
    const firstUnread = dayGroups.findIndex((g) => g.items.length > 0 && !g.done);
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
  const currentGroup = grouped ? dayGroups[focusDay] : undefined;
  const lockedStats = lockedList
    ? progressStats(lockedList, lockedProgress)
    : { total: 0, done: 0, fraction: 0 };

  /** What the sheet lists right now: one day of a plan, or one page of a list. */
  const visiblePassages = grouped
    ? (dayGroups[focusDay]?.items ?? [])
    : flatItems.slice(page * PASSAGES_PER_PAGE, (page + 1) * PASSAGES_PER_PAGE);

  /**
   * The passage to treat as "where I am". Falls back to the first unread when
   * nothing has been played, so the sheet always marks a spot and Continue
   * always has a target — and it agrees with the reader's own resume point and
   * with the day the window opens on, all three deriving it the same way.
   */
  const currentEntryId =
    lockedProgress?.currentEntryId ??
    flatItems.find(
      (i) => !i.entryId || !(lockedProgress?.completed.includes(i.entryId) ?? false),
    )?.entryId;
  const resumeSegment = currentEntryId
    ? flatItems.find((i) => i.entryId === currentEntryId)
    : flatItems[0];

  const dayLabel = (index: number) =>
    dayGroups[index]?.title ?? t('lists.day', { number: index + 1 });
  /** A finished day is ticked wherever it is named, including in the pager, so
   * "have I done that one" is answerable without stepping onto it. */
  const dayPagerLabel = (index: number) => (
    <>
      {dayGroups[index]?.done && <CheckMark className="shrink-0" />}
      <span className="truncate">{dayLabel(index)}</span>
    </>
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
          : view === 'spaces'
            ? t('community.title')
            : lockedList
              ? t('chat.bookPicker.titleList')
              : lockedSpace
                ? spaceLabel(lockedSpace.author, { kind: 'custom', name: lockedSpace.name })
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

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={headerTitle}
        // Only the sub-views can go back; the book grid is the root.
        onBack={view === 'books' ? undefined : () => setView('books')}
      >
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
                <span className="flex-1 min-w-0 font-serif text-brand text-sm truncate">
                  {lockedList
                    ? `${lockedList.emoji ? `${lockedList.emoji} ` : ''}${lockedList.name || t('lists.untitled')}`
                    : t('chat.bookPicker.readingLists')}
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

        {view === 'books' && showReadingLists && hasSpaces && (
          <div className="px-5 pb-3 border-b border-surface-raised/40">
            <div
              className={clsx(
                'flex items-center gap-1 rounded-xl pl-3 pr-1.5 py-1',
                'bg-surface/60 border transition-colors',
                lockedSpace ? 'border-brand/60' : 'border-brand/30 hover:border-brand/60',
              )}
            >
              <button
                type="button"
                onClick={() => setView('spaces')}
                className="flex-1 min-w-0 flex items-center gap-3 py-1.5 text-left"
              >
                <QuillIcon className="text-brand shrink-0" />
                <span className="flex-1 min-w-0 font-serif text-brand text-sm truncate">
                  {lockedSpace
                    ? `${lockedSpace.emoji ? `${lockedSpace.emoji} ` : ''}${spaceLabel(lockedSpace.author, { kind: 'custom', name: lockedSpace.name })}`
                    : t('community.title')}
                </span>
                {!lockedSpace && <ChevronRight />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(ROUTES.spaces);
                }}
                aria-label={t('community.title') as string}
                title={t('community.title') as string}
                className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors"
              >
                <PencilIcon />
              </button>

              {lockedSpace && (
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

        {/* A locked space shows its pieces instead of the book columns, exactly
            as a locked reading list shows its passages. No progress bar and no
            day pager: a space has neither, and unread is a dot rather than a
            tick (see communityStore). */}
        {view === 'books' && lockedSpace && (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">

            {spaceSegments.length === 0 ? (
              <p className="py-8 text-center text-ink-muted text-sm leading-relaxed">
                {t('community.empty')}
              </p>
            ) : (
              <>
                {/* Same place and the same rule as a reading list's: it covers
                    what the sheet is showing, which for a room is all of it —
                    a room has no pager. */}
                <div className="flex justify-end pt-2">
                  <NarrationGroupButton
                    subjects={subjectsForSegments(spaceSegments)}
                    label={t('read.narration.downloadPieces') as string}
                  />
                </div>
                <ul className="py-2 space-y-1">
                  {spaceSegments.map((seg) => (
                    <li key={seg.postId}>
                      <PassageRow
                        text={seg.postTitle || (t('community.untitledPost') as string)}
                        done={false}
                        showDone={false}
                        current={readerPosition?.postId === seg.postId}
                        onOpen={() => pickSegment(seg)}
                        trailing={
                          <span className="flex items-center gap-1.5 shrink-0">
                            {seg.postId && !seen[seg.postId] && (
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 rounded-full bg-brand inline-block"
                              />
                            )}
                            {seg.spaceId && seg.postId && (
                              <NarrationDownloadButton
                                subject={{
                                  kind: 'post',
                                  spaceId: seg.spaceId,
                                  postId: seg.postId,
                                }}
                              />
                            )}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {view === 'spaces' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">
            <ul className="py-2 space-y-1">
              {/* Reading across everyone is usually why you opened this, so the
                  two selections are the first two things you can pick — rows
                  like any other source rather than pills above the list, since
                  that is what they are: pick one and the reader is reading it.
                  Shown wherever the community is on at all, *not* only where
                  they have something to offer: gated on following somebody they
                  were simply absent for anyone whose install is their own
                  writing, who then has no way to learn they exist. The row says
                  why it is empty instead. "Today" is the exception and still
                  hides — it needs an ephemeral space to mean anything at all,
                  and there is nothing to explain about not having one. */}
              {communityProfile && (
                <>
                  <li>
                    <SourceRow
                      label={allNew.name}
                      emoji="✨"
                      disabled={allNew.posts.length === 0}
                      detail={
                        !hasSubscriptions
                          ? (t('community.newNeedsSubscriptions') as string)
                          : allNew.posts.length === 0
                            ? (t('community.nothingNew') as string)
                            : (t('community.pieces', { count: allNew.posts.length }) as string)
                      }
                      onSelect={allNew.open}
                      trailing={
                        allNew.posts.length > 0 ? (
                          <NarrationGroupButton
                            compact
                            subjects={allNew.subjects}
                            label={
                              t('read.narration.downloadSelection', {
                                name: allNew.name,
                              }) as string
                            }
                          />
                        ) : undefined
                      }
                    />
                  </li>
                  {today.posts.length > 0 && (
                    <li>
                      <SourceRow
                        label={today.name}
                        emoji="🌅"
                        detail={t('community.pieces', { count: today.posts.length }) as string}
                        onSelect={today.open}
                        trailing={
                          <NarrationGroupButton
                            compact
                            subjects={today.subjects}
                            label={
                              t('read.narration.downloadSelection', {
                                name: today.name,
                              }) as string
                            }
                          />
                        }
                      />
                    </li>
                  )}
                  {/* The selections read across every space; what follows is one
                      space at a time. A rule is the whole of that distinction —
                      a heading over two rows would be more furniture than list. */}
                  <li aria-hidden className="pt-1 pb-1">
                    <span className="block border-t border-surface-raised/60" />
                  </li>
                </>
              )}
              {/* The user's own spaces group by the same rule as anybody
                  else's — four rows all beginning with your own name is the
                  same noise, and the same unbounded list. The heading is
                  "your spaces" rather than your name: it is the one group you
                  can write in, and nobody thinks of their own writing as
                  belonging to their display name. */}
              {(() => {
                const grouped = ownSpaces.length > 1;
                const rows = ownSpaces.map((space) => (
                  <li key={space.id}>
                    <SourceRow
                      label={grouped ? spaceDisplayName(space) : spaceLabel(profileName, space)}
                      emoji={space.emoji}
                      detail={t('community.pieces', {
                        count: ownPosts.filter((p) => p.spaceId === space.id && p.publishedAt > 0)
                          .length,
                      })}
                      onSelect={() => {
                        void setSource({ kind: 'space', spaceId: space.id });
                        setView('books');
                      }}
                    />
                  </li>
                ));
                if (!grouped) return rows;
                const pieces = ownPosts.filter((p) => p.publishedAt > 0).length;
                return (
                  <AuthorGroup
                    ownerName={t('community.yourSpaces')}
                    detail={`${t('community.spacesCount', { count: ownSpaces.length })} · ${t('community.pieces', { count: pieces })}`}
                  >
                    {rows}
                  </AuthorGroup>
                );
              })()}
              {/* Grouped by author, but only where grouping earns its tap: one
                  space from someone is a row, several are a collapsible. Follow
                  a few prolific people and the flat list was mostly the same
                  name over and over. */}
              {authorGroups.map((group) => {
                const rows = group.subs.map((sub) => (
                  <li key={sub.code}>
                    <SourceRow
                      // Inside a group the author is the heading, so the row is
                      // the space alone; ungrouped it still names both.
                      label={
                        group.subs.length > 1
                          ? spaceDisplayName({ kind: sub.spaceKind ?? 'custom', name: sub.spaceName })
                          : spaceLabel(sub.ownerName, {
                              kind: sub.spaceKind ?? 'custom',
                              name: sub.spaceName,
                            })
                      }
                      emoji={sub.spaceEmoji}
                      detail={
                        sub.status === 'accepted'
                          ? (t('community.pieces', {
                              count: (feed[sub.code] ?? []).length,
                            }) as string)
                          : (t(
                              sub.status === 'pending' ? 'community.pending' : 'community.revoked',
                            ) as string)
                      }
                      onSelect={() => {
                        void setSource({ kind: 'space', code: sub.code });
                        setView('books');
                      }}
                    />
                  </li>
                ));
                if (group.subs.length === 1) return rows;
                const pieces = group.subs.reduce(
                  (n, sub) => n + (feed[sub.code] ?? []).length,
                  0,
                );
                return (
                  <AuthorGroup
                    key={group.authorKey}
                    ownerName={group.ownerName}
                    detail={`${t('community.spacesCount', { count: group.subs.length })} · ${t('community.pieces', { count: pieces })}`}
                  >
                    {rows}
                  </AuthorGroup>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(ROUTES.spaces);
              }}
              className="w-full py-3 text-center text-xs text-brand-muted hover:text-brand"
            >
              {t('community.addByCode')}
            </button>
          </div>
        )}

        {view === 'books' && !lockedList && !lockedSpace && (
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
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">
            {dayGroups.length === 0 ? (
              <p className="py-8 text-center text-ink-muted text-sm">
                {t('lists.emptyList')}
              </p>
            ) : (
              <>
                <div className="pt-1 pb-3">
                  <ProgressBar fraction={lockedStats.fraction} />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 text-[11px] text-ink-muted truncate">
                      {t('lists.progress', lockedStats)}
                      {' · '}
                      {t('lists.chapters', { count: listChapterCount(lockedList) })}
                    </p>
                    {resumeSegment && (
                      <button
                        type="button"
                        onClick={() => {
                          audioPlayback.ensureContext();
                          if (onContinue) onContinue(resumeSegment);
                          else void playSegmentInChat(resumeSegment);
                          setOpen(false);
                        }}
                        className="h-8 shrink-0 px-3 rounded-lg bg-brand text-on-brand text-sm flex items-center gap-1.5 active:scale-95 transition-transform"
                      >
                        <PlayGlyph />
                        {lockedStats.done > 0 && lockedStats.done < lockedStats.total
                          ? t('lists.continue')
                          : t('lists.start')}
                      </button>
                    )}
                  </div>
                </div>

                {/* One step at a time — a day of a plan, or ten passages of
                    a plain list. The neighbours are named rather than
                    listed: a ninety-day plan is not something to scroll,
                    and rows this size don't fit three abreast on a phone. */}
                <div className="flex items-center justify-between gap-2 pb-1">
                  <PagerButton
                    onClick={() => stepBrowse(-1)}
                    disabled={!canBrowseBack}
                    label={t('chat.bookPicker.earlier') as string}
                    side="start"
                  >
                    {grouped && canBrowseBack ? dayPagerLabel(focusDay - 1) : null}
                  </PagerButton>
                  <span
                    className={clsx(
                      'flex items-center gap-1 min-w-0 rounded-full px-3 py-1',
                      'text-[12px] uppercase tracking-wider font-serif',
                      currentGroup?.done
                        ? 'bg-brand/10 text-brand-muted'
                        : 'bg-brand/15 text-brand',
                    )}
                  >
                    {currentGroup?.done && <CheckMark />}
                    <span className="truncate">
                      {grouped
                        ? dayLabel(focusDay)
                        : t('chat.bookPicker.pageOf', { page: page + 1, total: pageCount })}
                    </span>
                  </span>
                  <PagerButton
                    onClick={() => stepBrowse(1)}
                    disabled={!canBrowseOn}
                    label={t('chat.bookPicker.later') as string}
                    side="end"
                  >
                    {grouped && canBrowseOn ? dayPagerLabel(focusDay + 1) : null}
                  </PagerButton>
                </div>

                {/* Above the passages and right-aligned, so it sits at the
                    head of the column of per-passage download buttons it
                    stands for. Its scope is whatever the pager is showing —
                    the day, or this page of a plain list — which is the unit
                    someone actually wants before a flight. */}
                <div className="flex justify-end pb-1">
                  <NarrationGroupButton
                    subjects={subjectsForSegments(visiblePassages)}
                    label={
                      (grouped
                        ? t('read.narration.downloadDay')
                        : t('read.narration.downloadPassages')) as string
                    }
                  />
                </div>

                {/* A touch more than the list screen's `space-y-1`: these rows
                    carry no play button, so they stay a little shorter and the
                    same gap reads tighter between them. */}
                <ul className="space-y-1.5 pb-3">
                  {visiblePassages.map((seg, i) => (
                    <li key={`${seg.entryId ?? seg.bookId}:${seg.chapter}:${i}`}>
                      <PassageRow
                        text={formatSegment(seg, lang)}
                        detail={passageDetail([
                          seg.label,
                          seg.translationPinned ? seg.translation : undefined,
                        ])}
                        done={
                          !!seg.entryId &&
                          (lockedProgress?.completed.includes(seg.entryId) ?? false)
                        }
                        current={!!seg.entryId && seg.entryId === currentEntryId}
                        onToggle={
                          seg.entryId
                            ? () =>
                                void setEntryDone(
                                  lockedList.id,
                                  seg.entryId as string,
                                  !(lockedProgress?.completed.includes(
                                    seg.entryId as string,
                                  ) ?? false),
                                )
                            : undefined
                        }
                        onOpen={() => pickSegment(seg)}
                        trailing={
                          <NarrationDownloadButton
                            subject={{
                              kind: 'chapter',
                              // The segment's own translation, not the active
                              // one: an entry pinned to LUT is downloaded in
                              // LUT, which is what it will be read in.
                              translation: seg.translation,
                              bookId: seg.bookId,
                              chapter: seg.chapter,
                            }}
                          />
                        }
                      />
                    </li>
                  ))}
                </ul>
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
      </BottomSheet>
    </>
  );
}
