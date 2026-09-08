import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { BOOKS, bookName, getBookById } from '@/services/bible/bookCatalog';
import {
  BIBLE_SOURCE,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { resolveSpaceFrom } from '@/services/community/spaceReading';
import { spaceLabel } from '@/services/community/spaceName';
import { ROUTES } from '@/lib/appRoutes';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { playSegmentInChat } from '@/lib/readingListPlayback';
import { BottomSheet } from '@/components/common/BottomSheet';
import { TranslationList } from '@/components/bible/TranslationList';
import { BookIcon, ListIcon, QuillIcon } from '@/components/common/icons';
import { LockedSourceRow, PickerBand } from './picker/pickerRows';
import { BookColumns, ChapterGrid, TranslationBand } from './picker/ScriptureViews';
import { ListPassages, ListsView } from './picker/ListViews';
import { SpacePieces, SpacesView } from './picker/SpaceViews';
import { useLocale } from '@/hooks/useLocale';

/**
 * "What should I read?", as one bottom sheet.
 *
 * The shell: it owns which view is showing, resolves what the app is currently
 * reading through, and routes a pick. Everything it draws lives in `picker/`,
 * **one module per kind of `ReaderSource`** — scripture, a reading list, a
 * space — which is the seam to follow when a fourth kind exists:
 *
 *   picker/ScriptureViews  the translation band, the book columns, the chapters
 *   picker/ListViews       the list index, and one list's passages
 *   picker/SpaceViews      the space index, and one space's pieces
 *   picker/pickerRows      the row shapes all three are built from
 *   picker/SourceIcon      the glyph for a source (shared with ReaderHeader)
 *
 * The windowing of a long list — which day is today, which page opens, where
 * the reader left off — is not here either. It is
 * `services/reading/listWindow`, which `readerStore` resumes from too, so the
 * sheet and the page cannot disagree about where you are.
 */

type View = 'books' | 'chapters' | 'translations' | 'lists' | 'spaces';

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
  const { t } = useTranslation();
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
  const setEntryDone = useLibraryStore((s) => s.setEntryDone);
  /**
   * Which list or space the app is reading through — `useReaderStore.source` is
   * that one notion, so selecting one here is the same act as selecting it on
   * /read and it survives closing the sheet. The picker keeps no copy of its
   * own; "locked in" is exactly "this is the source".
   */
  const source = useReaderStore((s) => s.source);
  const setSource = useReaderStore((s) => s.setSource);

  const closeSheet = useCallback(() => setOpen(false), []);
  const lang = useLocale();
  const selectedBook = getBookById(selectedBookId) ?? BOOKS[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const lockedList =
    source.kind === 'list' ? (readingLists.find((l) => l.id === source.listId) ?? null) : null;

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
  const communityProfile = useCommunityStore((s) => s.profile);
  const ownSpaces = useCommunityStore((s) => s.spaces);
  const ownPosts = useCommunityStore((s) => s.posts);
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);
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
  // The row is worth showing once there is anything at all to choose from.
  const hasSpaces = ownSpaces.length > 0 || subscriptions.length > 0;

  /**
   * The windowed position within the locked list, stamped with the list it
   * belongs to — so selecting another list falls back to that list's own
   * "today" without an effect to reset it.
   */
  const [browsePos, setBrowsePos] = useState<{ listId: string; at: number } | null>(null);
  const browseAt = browsePos && browsePos.listId === lockedList?.id ? browsePos.at : null;

  const selectSource = (next: ReaderSource) => {
    void setSource(next);
    setView('books');
  };

  const pickSegment = (ref: SegmentRef) => {
    // Keep this on both paths: the sheet tap is the user gesture that unlocks
    // the audio context on iOS.
    audioPlayback.ensureContext();
    if (onPickSegment) onPickSegment(ref);
    else void playSegmentInChat(ref);
    setOpen(false);
  };

  const continueList = (ref: SegmentRef) => {
    audioPlayback.ensureContext();
    if (onContinue) onContinue(ref);
    else void playSegmentInChat(ref);
    setOpen(false);
  };

  const pickChapter = (chapter: number) => {
    audioPlayback.ensureContext();
    if (onPick) onPick(selectedBook.id, chapter);
    else void send(`Read ${selectedBook.nameEn} ${chapter}`);
    setOpen(false);
  };

  const goTo = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  const headerTitle =
    view === 'translations'
      ? t('chat.bookPicker.translations')
      : view === 'chapters'
        ? bookName(selectedBook, lang)
        : view === 'lists'
          ? t('lists.title')
          : view === 'spaces'
            ? t('community.title')
            : lockedList
              ? t('chat.bookPicker.titleList')
              : lockedSpace
                ? spaceLabel(lockedSpace.author, { kind: 'custom', name: lockedSpace.name })
                : t('chat.bookPicker.title');

  const openSheet = () => {
    setView('books');
    setOpen(true);
  };

  /** The book columns show only when nothing else has claimed the root view. */
  const showBooks = view === 'books' && !lockedList && !lockedSpace;

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
          <TranslationBand translation={translation} onOpen={() => setView('translations')} />
        )}

        {view === 'books' && showReadingLists && (
          <PickerBand>
            <LockedSourceRow
              icon={<ListIcon className="text-brand shrink-0" />}
              locked={!!lockedList}
              label={
                lockedList
                  ? `${lockedList.emoji ? `${lockedList.emoji} ` : ''}${lockedList.name || t('lists.untitled')}`
                  : (t('chat.bookPicker.readingLists') as string)
              }
              onOpen={() => setView('lists')}
              onManage={() => goTo(lockedList ? `/lists/${lockedList.id}` : ROUTES.lists)}
              manageLabel={t('lists.manage') as string}
              onClear={() => void setSource(BIBLE_SOURCE)}
              clearLabel={t('chat.bookPicker.clearList') as string}
            />
          </PickerBand>
        )}

        {view === 'books' && showReadingLists && hasSpaces && (
          <PickerBand>
            <LockedSourceRow
              icon={<QuillIcon className="text-brand shrink-0" />}
              locked={!!lockedSpace}
              label={
                lockedSpace
                  ? `${lockedSpace.emoji ? `${lockedSpace.emoji} ` : ''}${spaceLabel(lockedSpace.author, { kind: 'custom', name: lockedSpace.name })}`
                  : (t('community.title') as string)
              }
              onOpen={() => setView('spaces')}
              onManage={() => goTo(ROUTES.spaces)}
              manageLabel={t('community.title') as string}
              onClear={() => void setSource(BIBLE_SOURCE)}
              clearLabel={t('chat.bookPicker.clearList') as string}
            />
          </PickerBand>
        )}

        {view === 'books' && lockedSpace && (
          <SpacePieces space={lockedSpace} translation={translation} onPick={pickSegment} />
        )}

        {view === 'books' && lockedList && (
          <ListPassages
            list={lockedList}
            progress={readingProgress[lockedList.id]}
            translation={translation}
            lang={lang}
            browseAt={browseAt}
            onBrowse={(at) => setBrowsePos({ listId: lockedList.id, at })}
            onPick={pickSegment}
            onContinue={continueList}
            onToggleEntry={(entryId, done) => void setEntryDone(lockedList.id, entryId, done)}
          />
        )}

        {showBooks && (
          <BookColumns
            lang={lang}
            onPickBook={(bookId) => {
              setSelectedBookId(bookId);
              setView('chapters');
            }}
          />
        )}

        {view === 'chapters' && (
          <ChapterGrid
            book={selectedBook}
            // Only the chat path can be busy; a reader jump is always available.
            disabled={onPick ? false : isProcessing}
            onPick={pickChapter}
          />
        )}

        {view === 'lists' && (
          <ListsView
            lists={readingLists}
            progress={readingProgress}
            onSelect={(listId) => selectSource({ kind: 'list', listId })}
            onManage={() => goTo(ROUTES.lists)}
          />
        )}

        {view === 'spaces' && (
          <SpacesView
            onSelect={selectSource}
            onClose={closeSheet}
            onManage={() => goTo(ROUTES.spaces)}
          />
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
