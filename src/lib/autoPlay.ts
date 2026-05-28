import { audioPlayback, type PlaybackTrack } from './audioPlaybackManager';
import { browserTts, type BrowserTtsItem } from './browserTts';
import { buildPlaybackPlan } from './playbackPlan';
import { planToBrowserItems, planToOpenAiTracks } from './startPlayback';
import {
  getChapter,
  verseSpeakable,
  type Translation,
} from '@/services/bible/bibleApi';
import { formatReference, getBookById } from '@/services/bible/bookCatalog';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { isBrowserVoice, type OpenAiVoiceId, type VerseSummary } from '@/types/domain';

/**
 * Auto-play continues the current reading once it naturally ends. Mode
 * detection looks at the last reading's trailing chapter slice:
 *   - covers the whole chapter (verse 1 .. chapter-end)  → next full chapter
 *   - otherwise                                          → next ~5 verses
 *
 * Crosses book boundaries automatically; only stops at Revelation 22.
 *
 * Prefetches the next chunk's TTS while the current chunk plays so the
 * transition feels seamless.
 */

const CHUNK_SIZE = 5;
const LAST_BOOK_ID = 66;

type Continuation = {
  bookId: number;
  chapter: number;
  /** verseStart undefined → entire chapter (chapter mode). */
  verseStart?: number;
  verseEnd?: number;
};

type PrefetchCache = {
  key: string;
  cont: Continuation;
  translation: Translation;
  summaries: VerseSummary[];
  /** Pre-built tracks (OpenAI voice) — ready to enqueue. */
  tracks: PlaybackTrack[] | null;
  /** For browser TTS, we only prefetch verse text; tracks are null. */
  isBrowserVoice: boolean;
};

let lastPlayedMessageId: string | null = null;
let prefetched: PrefetchCache | null = null;
let prefetchController: AbortController | null = null;
/** The messageId we last started (or completed) a prefetch for. The
 * playbackStore subscriber fires on every frame's currentWordIndex tick,
 * so without this guard each tick would abort + restart the in-flight
 * prefetch and it'd never finish. */
let prefetchAnchorMessageId: string | null = null;
let firingContinuation = false;

function chunkKey(cont: Continuation, translation: Translation): string {
  return `${translation}:${cont.bookId}:${cont.chapter}:${cont.verseStart ?? 'all'}:${cont.verseEnd ?? 'all'}`;
}

function getMessage(messageId: string) {
  return useChatStore.getState().messages.find((m) => m.id === messageId);
}

function autoPlayOn(): boolean {
  return useSettingsStore.getState().autoPlayReading;
}

export function cancelAutoPlayPrefetch(): void {
  if (prefetchController) {
    prefetchController.abort();
    prefetchController = null;
  }
  prefetched = null;
  prefetchAnchorMessageId = null;
}

/**
 * Decide what plays after the message's current verses. Returns null when
 * the Bible is fully read or the message has no verses to anchor on.
 */
async function computeNextChunk(
  messageId: string,
): Promise<{ cont: Continuation; translation: Translation } | null> {
  const msg = getMessage(messageId);
  const verses = msg?.verses;
  if (!verses || verses.length === 0) return null;

  const last = verses[verses.length - 1];
  // Trailing slice for the last verse's (book, chapter).
  const trailing: VerseSummary[] = [];
  for (let i = verses.length - 1; i >= 0; i--) {
    const v = verses[i];
    if (v.bookId === last.bookId && v.chapter === last.chapter) {
      trailing.unshift(v);
    } else {
      break;
    }
  }

  const chapterVerses = await getChapter(last.translation, last.bookId, last.chapter);
  if (chapterVerses.length === 0) return null;
  const chapterEnd = chapterVerses[chapterVerses.length - 1].verse;

  const atChapterEnd = last.verse >= chapterEnd;
  const fullyReadThisChapter =
    trailing[0].verse === 1 && trailing[trailing.length - 1].verse === chapterEnd;

  // Determine where to go next.
  if (fullyReadThisChapter) {
    // Chapter mode → next chapter (whole), possibly next book.
    return nextWholeChapter(last.bookId, last.chapter, last.translation);
  }

  // Verse mode → next N verses, rolling over chapters/books as needed.
  if (!atChapterEnd) {
    const start = last.verse + 1;
    const end = Math.min(start + CHUNK_SIZE - 1, chapterEnd);
    return {
      cont: {
        bookId: last.bookId,
        chapter: last.chapter,
        verseStart: start,
        verseEnd: end,
      },
      translation: last.translation,
    };
  }
  // Past chapter end → roll to next chapter, first N verses (or next book).
  return nextVerseChunkAfterChapterEnd(last.bookId, last.chapter, last.translation);
}

function nextWholeChapter(
  bookId: number,
  chapter: number,
  translation: Translation,
): { cont: Continuation; translation: Translation } | null {
  const book = getBookById(bookId);
  if (!book) return null;
  if (chapter < book.chapters) {
    return { cont: { bookId, chapter: chapter + 1 }, translation };
  }
  // End of book → next book, chapter 1.
  if (bookId >= LAST_BOOK_ID) return null;
  return { cont: { bookId: bookId + 1, chapter: 1 }, translation };
}

async function nextVerseChunkAfterChapterEnd(
  bookId: number,
  chapter: number,
  translation: Translation,
): Promise<{ cont: Continuation; translation: Translation } | null> {
  const book = getBookById(bookId);
  if (!book) return null;
  let nextBookId = bookId;
  let nextChapter = chapter + 1;
  if (nextChapter > book.chapters) {
    if (bookId >= LAST_BOOK_ID) return null;
    nextBookId = bookId + 1;
    nextChapter = 1;
  }
  const verses = await getChapter(translation, nextBookId, nextChapter);
  if (verses.length === 0) return null;
  const lastVerseNo = verses[verses.length - 1].verse;
  return {
    cont: {
      bookId: nextBookId,
      chapter: nextChapter,
      verseStart: 1,
      verseEnd: Math.min(CHUNK_SIZE, lastVerseNo),
    },
    translation,
  };
}

async function buildSummariesFor(
  cont: Continuation,
  translation: Translation,
  locale: 'en' | 'de',
): Promise<VerseSummary[]> {
  const verses = await getChapter(translation, cont.bookId, cont.chapter);
  if (verses.length === 0) return [];
  const slice =
    cont.verseStart === undefined
      ? verses
      : verses.filter(
          (v) =>
            v.verse >= (cont.verseStart as number) &&
            v.verse <= (cont.verseEnd ?? (cont.verseStart as number)),
        );
  return slice.map((v) => ({
    translation,
    bookId: cont.bookId,
    chapter: cont.chapter,
    verse: v.verse,
    text: verseSpeakable(v),
    display: formatReference(cont.bookId, cont.chapter, v.verse, v.verse, locale),
  }));
}

function rangeHistoryNote(
  summaries: VerseSummary[],
  locale: 'en' | 'de',
): string {
  // Collapse contiguous (book, chapter, verse) runs in this single chunk.
  type Range = { bookId: number; chapter: number; start: number; end: number };
  const ranges: Range[] = [];
  for (const v of summaries) {
    const last = ranges[ranges.length - 1];
    if (
      last &&
      last.bookId === v.bookId &&
      last.chapter === v.chapter &&
      v.verse === last.end + 1
    ) {
      last.end = v.verse;
    } else {
      ranges.push({ bookId: v.bookId, chapter: v.chapter, start: v.verse, end: v.verse });
    }
  }
  const formatted = ranges
    .map((r) => formatReference(r.bookId, r.chapter, r.start, r.end, locale))
    .join('; ');
  return `(Played aloud: ${formatted}.)`;
}

/**
 * Enqueue an auto-play continuation as a NEW assistant message — auto-play
 * never modifies the original reading. Each chunk appears in chat as its
 * own ReaderPanel, audio bridges via soft-end + the chapter-pause.
 */
async function enqueueContinuationFor(
  _anchorMessageId: string,
  cont: Continuation,
  translation: Translation,
): Promise<void> {
  const settings = useSettingsStore.getState();
  let summaries: VerseSummary[];
  let tracksFromPrefetch: PlaybackTrack[] | null = null;

  const key = chunkKey(cont, translation);
  if (prefetched && prefetched.key === key) {
    summaries = prefetched.summaries;
    tracksFromPrefetch = prefetched.tracks;
    prefetched = null;
  } else {
    summaries = await buildSummariesFor(cont, translation, settings.locale);
  }
  if (summaries.length === 0) return;

  // Continuation is a whole chapter only when `cont.verseStart` is
  // undefined (chapter mode in computeNextChunk).
  const wholeChapter = cont.verseStart === undefined;

  // Create a fresh assistant message for this chunk.
  const newMessageId = crypto.randomUUID();
  useChatStore.getState().appendMessage({
    id: newMessageId,
    role: 'assistant',
    text: '',
    verses: summaries,
    historyNote: rangeHistoryNote(summaries, settings.locale),
    headingWholeChapter: wholeChapter,
    createdAt: Date.now(),
  });

  const readerVoice = effectiveReadingVoice();
  if (isBrowserVoice(readerVoice)) {
    const plan = buildPlaybackPlan(summaries, {
      locale: settings.locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter,
    });
    const items: BrowserTtsItem[] = planToBrowserItems(plan, newMessageId);
    void browserTts.enqueue(items);
    return;
  }

  // Prefetched tracks were built against the new message's id ahead of
  // time (see schedulePrefetchFor); if no prefetch hit, build fresh.
  let tracks = tracksFromPrefetch;
  if (tracks) {
    // Tracks were tagged with the prefetch's reserved messageId — swap to
    // our actual new message so the WordHighlighter binds correctly.
    tracks = tracks.map((t) => ({ ...t, messageId: newMessageId }));
  } else {
    const plan = buildPlaybackPlan(summaries, {
      locale: settings.locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter,
    });
    tracks = await planToOpenAiTracks(
      plan,
      newMessageId,
      readerVoice as OpenAiVoiceId,
      effectiveVoiceStyle() || undefined,
      undefined,
    );
  }
  if (tracks.length > 0) {
    void audioPlayback.enqueue(tracks);
  }
}

async function schedulePrefetchFor(messageId: string): Promise<void> {
  if (!autoPlayOn()) return;
  // Already prefetching for this anchor — let it finish.
  if (prefetchAnchorMessageId === messageId && (prefetchController || prefetched)) {
    return;
  }
  cancelAutoPlayPrefetch();
  prefetchAnchorMessageId = messageId;
  const controller = new AbortController();
  prefetchController = controller;
  try {
    const next = await computeNextChunk(messageId);
    if (!next || controller.signal.aborted) return;
    const settings = useSettingsStore.getState();
    const summaries = await buildSummariesFor(
      next.cont,
      next.translation,
      settings.locale,
    );
    if (controller.signal.aborted || summaries.length === 0) return;

    const key = chunkKey(next.cont, next.translation);
    let tracks: PlaybackTrack[] | null = null;
    const prefetchVoice = effectiveReadingVoice();
    const usingBrowser = isBrowserVoice(prefetchVoice);
    if (!usingBrowser) {
      const plan = buildPlaybackPlan(summaries, {
        locale: settings.locale,
        readChapterHeadings: settings.readChapterHeadings,
        readVerseNumbers: settings.readVerseNumbers,
        verseNumberStyle: settings.verseNumberStyle,
        pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
        pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
        wholeChapter: next.cont.verseStart === undefined,
      });
      tracks = await planToOpenAiTracks(
        plan,
        messageId,
        prefetchVoice as OpenAiVoiceId,
        effectiveVoiceStyle() || undefined,
        controller.signal,
      );
    }
    if (controller.signal.aborted) return;
    prefetched = {
      key,
      cont: next.cont,
      translation: next.translation,
      summaries,
      tracks,
      isBrowserVoice: usingBrowser,
    };
  } catch {
    /* abort or fetch failure — retry on next trigger */
  } finally {
    if (prefetchController === controller) prefetchController = null;
  }
}

/** Last messageId whose verses we played. Survives `softEnd()` clearing
 * the playback store's `current`, so the manual next-button path can
 * still pick up the conversation thread. Returns null before anything has
 * played in this session. */
export function getLastPlayedMessageId(): string | null {
  return lastPlayedMessageId;
}

/**
 * Same flow as the automatic soft-end continuation, exposed so the
 * floating playback bar's next button can fire it on demand even when
 * auto-play is off. The `firingContinuation` guard below protects against
 * double-tap spam.
 */
export const triggerContinuation = (messageId: string): Promise<void> =>
  onSoftEnd(messageId);

async function onSoftEnd(messageId: string): Promise<void> {
  if (firingContinuation) return;
  firingContinuation = true;
  try {
    const next = await computeNextChunk(messageId);
    if (!next) {
      // Nothing to continue with (e.g. end of Bible). If the manual
      // next-button path poked us into a 'loading' state for instant
      // feedback, restore idle so the thinking drone and PlayButton pulse
      // don't get stuck.
      const ps = usePlaybackStore.getState();
      if (ps.status === 'loading' && !ps.current) ps.setStatus('idle');
      return;
    }
    await enqueueContinuationFor(messageId, next.cont, next.translation);
    // Kick off the next prefetch right after enqueueing.
    void schedulePrefetchFor(messageId);
  } finally {
    firingContinuation = false;
  }
}

/** Subscribe to playback + settings; call once at app startup. */
export function initAutoPlay(): void {
  // Track the last playing messageId so we can recover it on soft-end
  // (current is null by then).
  usePlaybackStore.subscribe((state, prev) => {
    if (state.current?.messageId) {
      lastPlayedMessageId = state.current.messageId;
    }

    const wasPlaying = prev.status === 'playing' || prev.status === 'loading';
    const becameIdle = state.status === 'idle';
    if (
      wasPlaying &&
      becameIdle &&
      (audioPlayback.isSoftEnded() || browserTts.isSoftEnded()) &&
      autoPlayOn() &&
      lastPlayedMessageId
    ) {
      void onSoftEnd(lastPlayedMessageId);
    }

    // Prefetch trigger: only when the playing message CHANGES. The
    // subscribe callback fires on every per-frame currentWordIndex tick;
    // anchoring on messageId means we kick off one prefetch per message
    // and let it complete (rather than aborting + restarting 60×/sec).
    if (state.current && autoPlayOn() && state.current.messageId) {
      const msgId = state.current.messageId;
      if (msgId !== prefetchAnchorMessageId) {
        void schedulePrefetchFor(msgId);
      }
    }
  });

  // React when the user toggles auto-play ON mid-playback.
  useSettingsStore.subscribe((state, prev) => {
    if (state.autoPlayReading && !prev.autoPlayReading && lastPlayedMessageId) {
      void schedulePrefetchFor(lastPlayedMessageId);
    }
    if (!state.autoPlayReading && prev.autoPlayReading) {
      cancelAutoPlayPrefetch();
    }
  });
}
