import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReaderHeader } from '@/components/reader/ReaderHeader';
import { ReaderFooter } from '@/components/reader/ReaderFooter';
import { ChapterBlock } from '@/components/reader/ChapterBlock';
import { ChapterUnavailableCard } from '@/components/reader/ChapterUnavailableCard';
import { TranslationPickerSheet } from '@/components/bible/TranslationPickerSheet';
import { useAutoScrollActiveVerse } from '@/hooks/useAutoScrollActiveVerse';
import { useEndlessChapters } from '@/hooks/useEndlessChapters';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { usePlaybackStore } from '@/store/playbackStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { prevChapterRef, nextChapterRef } from '@/services/bible/chapterNavigation';
import { formatReference } from '@/services/bible/bookCatalog';
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
  const chapters = useReaderStore((s) => s.chapters);
  const position = useReaderStore((s) => s.position);
  const status = useReaderStore((s) => s.status);
  const error = useReaderStore((s) => s.error);
  const ensureOpen = useReaderStore((s) => s.ensureOpen);
  const stepChapter = useReaderStore((s) => s.stepChapter);
  const goTo = useReaderStore((s) => s.goTo);

  const translation = useSettingsStore((s) => s.translation);
  const setTranslation = useSettingsStore((s) => s.setTranslation);
  const endless = useSettingsStore((s) => s.readerEndlessScroll);

  const [translationOpen, setTranslationOpen] = useState(false);

  useAutoScrollActiveVerse(scrollRef);
  const { sentinelRef, loadPrevious } = useEndlessChapters(scrollRef);

  // Open the persisted position (seeded from the audio resume point the very
  // first time) whenever the tab is entered with nothing loaded.
  useEffect(() => {
    void ensureOpen();
  }, [ensureOpen]);

  /**
   * A translation switch invalidates every reader group, because the group id
   * embeds the translation and the queued TTS is the old text's audio. Word
   * counts differ between translations, so letting it play on against
   * re-rendered verses would desync the highlight with no way back — stopping
   * is the honest option.
   */
  useEffect(() => {
    const loaded = visible[0] ? chapters[visible[0]] : undefined;
    if (!loaded || loaded.translation === translation) return;
    const current = usePlaybackStore.getState().current;
    if (current && readingHosts.hostFor(current.groupId)?.ns === 'reader') {
      audioPlayback.stop();
    }
    void useReaderStore.getState().reloadForTranslation(translation);
  }, [translation, visible, chapters]);

  // Paged navigation replaces the window, so the scroll position has to be set
  // deliberately. Going back lands at the *end* of the previous chapter, the way
  // turning back a page in a physical book does.
  const pendingScroll = useRef<'top' | 'bottom' | null>(null);
  const step = useCallback(
    (dir: 1 | -1) => {
      pendingScroll.current = dir === 1 ? 'top' : 'bottom';
      void stepChapter(dir);
    },
    [stepChapter],
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const want = pendingScroll.current;
    if (!el || !want || visible.length === 0) return;
    pendingScroll.current = null;
    el.scrollTop = want === 'top' ? 0 : el.scrollHeight;
  }, [visible]);

  const jumpToTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const canLoadPrevious =
    endless &&
    !!visible[0] &&
    !!chapters[visible[0]] &&
    prevChapterRef(chapters[visible[0]].bookId, chapters[visible[0]].chapter) !== null;

  const lastLoaded = visible.length > 0 ? chapters[visible[visible.length - 1]] : undefined;
  const canLoadNext =
    !!lastLoaded && nextChapterRef(lastLoaded.bookId, lastLoaded.chapter) !== null;

  const previousLabel = canLoadPrevious
    ? (() => {
        const first = chapters[visible[0]];
        const ref = prevChapterRef(first.bookId, first.chapter);
        return ref
          ? formatReference(ref.bookId, ref.chapter, undefined, undefined, lang)
          : '';
      })()
    : '';

  return (
    <div className="flex flex-col h-full min-h-0">
      <ReaderHeader onOpenTranslations={() => setTranslationOpen(true)} />

      {/* One scroll container for every loaded chapter — that's what
          useAutoScrollActiveVerse needs to find the active verse. pb-28 keeps
          the last verse clear of the mic and the floating playback bar, which
          anchor above the bottom nav. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-28">
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
          const chapter = chapters[id];
          return chapter ? <ChapterBlock key={id} chapter={chapter} /> : null;
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
          <p className="py-6 text-center text-ink-muted text-sm">{t('read.endOfBible')}</p>
        )}
      </div>

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
    </div>
  );
}
