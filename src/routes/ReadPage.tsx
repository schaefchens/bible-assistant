import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReaderHeader } from '@/components/reader/ReaderHeader';
import { ReaderFooter } from '@/components/reader/ReaderFooter';
import { SegmentBlock } from '@/components/reader/SegmentBlock';
import { ChapterUnavailableCard } from '@/components/reader/ChapterUnavailableCard';
import { TranslationPickerSheet } from '@/components/bible/TranslationPickerSheet';
import { ReadingAppearanceSheet } from '@/components/reader/ReadingAppearanceSheet';
import { ReadingSurface } from '@/components/reader/ReadingSurface';
import { useAutoScrollActiveVerse } from '@/hooks/useAutoScrollActiveVerse';
import { useEndlessChapters } from '@/hooks/useEndlessChapters';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatSegment } from '@/services/reading/readingSequence';
import { useReaderSequence } from '@/hooks/useReaderSequence';
import { readingHosts } from '@/lib/readingHosts';

/**
 * The Bible reader: flowing prose, one chapter per page (or an endless scroll),
 * with the same read-aloud behaviour as the chat reader — tap any word to start
 * there, and the floating playback bar's transport, the keyboard shortcuts and
 * auto-continuation all work because a loaded chapter is a first-class playback
 * group (see lib/readingHosts.ts).
 */
export function ReadPage() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useReaderStore((s) => s.visible);
  const segments = useReaderStore((s) => s.segments);
  const position = useReaderStore((s) => s.position);
  const status = useReaderStore((s) => s.status);
  const error = useReaderStore((s) => s.error);
  const ensureOpen = useReaderStore((s) => s.ensureOpen);
  const stepSegment = useReaderStore((s) => s.step);
  const goTo = useReaderStore((s) => s.goTo);
  // Prev/next come from whatever the reader is walking through — canonical order
  // for the Bible, list order for a reading list. Same code either way.
  const sequence = useReaderSequence();

  const source = useReaderStore((s) => s.source);
  const translation = useSettingsStore((s) => s.translation);
  const setTranslation = useSettingsStore((s) => s.setTranslation);
  const endless = useSettingsStore((s) => s.readerEndlessScroll);

  const [translationOpen, setTranslationOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  useAutoScrollActiveVerse(scrollRef);
  const { sentinelRef, loadPrevious } = useEndlessChapters(scrollRef);

  // Open the persisted position (seeded from the audio resume point the very
  // first time) whenever the tab is entered with nothing loaded.
  //
  // A list-sourced reader waits for the library: its position has to be resolved
  // against the list, and the lists arrive from Dexie a tick later. Opening
  // early read a stale persisted ref and briefly navigated canonically.
  const libraryReady = useLibraryStore((s) => s.initialized);
  const communityReady = useCommunityStore((s) => s.initialized);
  // A space-sourced reader has the same boot race as a list-sourced one: its
  // posts arrive from Dexie asynchronously, and opening before they land looks
  // exactly like an unsubscribed space.
  const waitingForSource =
    (source.kind === 'list' && !libraryReady) || (source.kind === 'space' && !communityReady);
  useEffect(() => {
    if (waitingForSource) return;
    void ensureOpen();
  }, [ensureOpen, waitingForSource]);

  /**
   * A translation switch invalidates every reader group, because the group id
   * embeds the translation and the queued TTS is the old text's audio. Word
   * counts differ between translations, so letting it play on against
   * re-rendered verses would desync the highlight with no way back — stopping
   * is the honest option.
   *
   * A segment whose translation is *pinned* by its list entry is exempt: the
   * user asked for that passage in that text, and "correcting" it to the active
   * translation would both misrender it and break the sequence around it.
   */
  useEffect(() => {
    const loaded = visible[0] ? segments[visible[0]] : undefined;
    if (!loaded || loaded.ref.translationPinned) return;
    if (loaded.ref.translation === translation) return;
    const current = usePlaybackStore.getState().current;
    if (current && readingHosts.hostFor(current.groupId)?.ns === 'reader') {
      audioPlayback.stop();
    }
    void useReaderStore.getState().reloadForTranslation(translation);
  }, [translation, visible, segments]);

  // Paged navigation replaces the window, so the scroll position has to be set
  // deliberately. Going back lands at the *end* of the previous chapter, the way
  // turning back a page in a physical book does.
  const pendingScroll = useRef<'top' | 'bottom' | null>(null);
  /** The single page last rendered, so a window replaced by something other
   * than the pager (the picker, auto-continuation turning the page) can be told
   * apart from a window that merely grew. */
  const pagedAt = useRef<string | null>(null);
  const step = useCallback(
    (dir: 1 | -1) => {
      pendingScroll.current = dir === 1 ? 'top' : 'bottom';
      void stepSegment(dir);
    },
    [stepSegment],
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || visible.length === 0) return;
    const want = pendingScroll.current;
    pendingScroll.current = null;
    const single = !endless && visible.length === 1 ? visible[0] : null;
    const turnedElsewhere = single !== null && single !== pagedAt.current;
    pagedAt.current = single;
    if (want) {
      el.scrollTop = want === 'top' ? 0 : el.scrollHeight;
      return;
    }
    // A page the reader turned for itself — auto-continuation, or the picker —
    // starts at the top, exactly as the pager's next button does. Without this
    // the old page's scroll offset survives into a page that may be shorter,
    // landing the reader at the end of a piece that has not been read yet.
    if (turnedElsewhere) el.scrollTop = 0;
  }, [visible, endless]);

  const jumpToTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const firstLoaded = visible[0] ? segments[visible[0]] : undefined;
  const lastLoaded = visible.length > 0 ? segments[visible[visible.length - 1]] : undefined;
  const previousRef = firstLoaded ? sequence.prev(firstLoaded.ref) : null;
  const canLoadPrevious = endless && previousRef !== null;
  const canLoadNext = !!lastLoaded && sequence.next(lastLoaded.ref) !== null;
  const previousLabel = canLoadPrevious && previousRef ? formatSegment(previousRef, lang) : '';

  return (
    <div className="flex flex-col h-full min-h-0">
      <ReaderHeader
        onOpenTranslations={() => setTranslationOpen(true)}
        onOpenAppearance={() => setAppearanceOpen(true)}
      />

      {/* One scroll container for every loaded chapter — that's what
          useAutoScrollActiveVerse needs to find the active verse. pb-28 keeps
          the last verse clear of the mic and the floating playback bar, which
          anchor above the bottom nav.
          It is also the reading surface, so the user's paper reaches the edges
          of the scroller: the padding is inside its background box. The header
          and footer are deliberately outside — a page dialled down to invisible
          must still show the button that undoes it. */}
      <ReadingSurface
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 pt-4 pb-28"
      >
        {canLoadPrevious && (
          <button
            type="button"
            onClick={loadPrevious}
            disabled={status === 'loading'}
            className="w-full mb-4 h-10 rounded-xl border border-brand/25 text-brand text-[12px] sm:text-sm hover:bg-brand/10 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            ↑ {t('read.loadPrevious')}
            {previousLabel ? ` · ${previousLabel}` : ''}
          </button>
        )}

        {visible.map((id) => {
          const segment = segments[id];
          return segment ? <SegmentBlock key={id} segment={segment} /> : null;
        })}

        {error && (
          <ChapterUnavailableCard
            error={error}
            onRetry={() => {
              if (position) void goTo(position);
            }}
            onPickTranslation={() => setTranslationOpen(true)}
          />
        )}

        {status === 'loading' && visible.length === 0 && (
          <p className="py-8 text-center text-ink-muted text-sm">{t('read.loading')}</p>
        )}

        {/* Endless-scroll trigger. Not rendered while an error is showing, so a
            dead chapter can't be retried on every scroll frame. */}
        {endless && canLoadNext && !error && <div ref={sentinelRef} className="h-px" />}

        {endless && !canLoadNext && visible.length > 0 && (
          <p className="py-6 text-center text-ink-muted text-sm">
            {/* A list ends; the Bible runs out. Different facts, different words. */}
            {t(
              source.kind === 'list'
                ? 'read.endOfList'
                : source.kind === 'space'
                  ? 'read.endOfSpace'
                  : source.kind === 'selection'
                    ? 'read.endOfSelection'
                    : 'read.endOfBible',
            )}
          </p>
        )}
      </ReadingSurface>

      {!endless && <ReaderFooter onStep={step} />}

      <TranslationPickerSheet
        open={translationOpen}
        value={translation}
        onChange={(code) => {
          setTranslation(code, true);
          setTranslationOpen(false);
          jumpToTop();
        }}
        onClose={() => setTranslationOpen(false)}
      />

      <ReadingAppearanceSheet
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
      />
    </div>
  );
}
