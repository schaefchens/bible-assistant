import i18n from '@/i18n';
import { getBookById } from '@/services/bible/bookCatalog';
import type { Translation } from '@/services/bible/bibleApi';
import type { Locale, VerseSummary } from '@/types/domain';
import { localeForTranslation } from './translationLocaleMap';

export type PlanItem =
  | {
      kind: 'heading';
      /** Index into the original verses array — set to the first verse of the
       * chapter so the WordHighlighter shows that verse as "current" during
       * the announcement. */
      verseIndex: number;
      text: string;
      /** Inherited from the chapter's verses so browser TTS picks a voice
       * matching the Bible's language (not the UI locale). */
      translation: Translation;
      pauseAfterMs: number;
    }
  | {
      kind: 'number';
      verseIndex: number;
      text: string;
      translation: Translation;
      pauseAfterMs: number;
    }
  | {
      kind: 'verse';
      verseIndex: number;
      verse: VerseSummary;
      pauseAfterMs: number;
    };

export type VerseNumberStyle = 'spoken' | 'plain';

export type PlaybackPlanOptions = {
  /** UI locale — used only as a fallback if a verse somehow has no
   * translation; announcement language is normally derived from the
   * verse's own translation. */
  locale: Locale;
  readChapterHeadings: boolean;
  readVerseNumbers: boolean;
  /** 'spoken' → "Verse 16" / "Vers 16"; 'plain' → just "16". */
  verseNumberStyle: VerseNumberStyle;
  pauseBetweenVersesMs: number;
  pauseBetweenChaptersMs: number;
  /** When true, the run is a complete chapter read: heading announces
   * just "Book, chapter N". When false (default), the heading includes
   * the actual verse(s) being read so the listener knows the scope. */
  wholeChapter?: boolean;
};

type ChapterRun = {
  bookId: number;
  chapter: number;
  /** indexes into the original verses array */
  items: { verseIndex: number; verse: VerseSummary }[];
};

function groupRuns(verses: VerseSummary[]): ChapterRun[] {
  const runs: ChapterRun[] = [];
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    const last = runs[runs.length - 1];
    if (last && last.bookId === v.bookId && last.chapter === v.chapter) {
      last.items.push({ verseIndex: i, verse: v });
    } else {
      runs.push({
        bookId: v.bookId,
        chapter: v.chapter,
        items: [{ verseIndex: i, verse: v }],
      });
    }
  }
  return runs;
}

type HeadingScope =
  | { kind: 'chapter' }
  | { kind: 'single'; verse: number }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'list'; verses: number[] };

function headingTextFor(
  bookId: number,
  chapter: number,
  locale: Locale,
  scope: HeadingScope,
): string {
  const book = getBookById(bookId);
  const bookName = book ? (locale === 'de' ? book.nameDe : book.nameEn) : '';
  if (scope.kind === 'single') {
    return i18n.t('announce.chapterVerse', {
      book: bookName,
      n: chapter,
      v: scope.verse,
      lng: locale,
    });
  }
  if (scope.kind === 'range') {
    return i18n.t('announce.chapterRange', {
      book: bookName,
      n: chapter,
      from: scope.from,
      to: scope.to,
      lng: locale,
    });
  }
  if (scope.kind === 'list') {
    const formatter = new Intl.ListFormat(locale, {
      style: 'long',
      type: 'conjunction',
    });
    const versesStr = formatter.format(scope.verses.map(String));
    return i18n.t('announce.chapterList', {
      book: bookName,
      n: chapter,
      verses: versesStr,
      lng: locale,
    });
  }
  return i18n.t('announce.chapter', {
    book: bookName,
    n: chapter,
    lng: locale,
  });
}

function numberTextFor(
  verseNumber: number,
  locale: Locale,
  style: VerseNumberStyle,
): string {
  if (style === 'plain') return String(verseNumber);
  return i18n.t('announce.verse', { n: verseNumber, lng: locale });
}

/**
 * Turn a verse list into the sequence of audio items to play, interleaving
 * optional chapter announcements and verse-number announcements and tagging
 * each item with the pause that should follow it.
 *
 * The last item's `pauseAfterMs` is always 0 — no point waiting after the
 * queue ends.
 */
export function buildPlaybackPlan(
  verses: VerseSummary[],
  opts: PlaybackPlanOptions,
): PlanItem[] {
  if (verses.length === 0) return [];

  const runs = groupRuns(verses);
  const plan: PlanItem[] = [];

  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const isLastRun = r === runs.length - 1;
    // Announce in the Bible's language, not the UI locale — a German user
    // reading ESV should hear "Galatians, chapter 5", and an English user
    // reading Schlachter should hear "Galater, Kapitel 5".
    const runTranslation = run.items[0].verse.translation;
    const runLang = localeForTranslation(runTranslation);

    if (opts.readChapterHeadings) {
      const verses = run.items.map((it) => it.verse.verse);
      const firstVerse = verses[0];
      const lastVerse = verses[verses.length - 1];
      // Contiguous iff every step is +1 from the previous.
      let isContiguous = true;
      for (let i = 1; i < verses.length; i++) {
        if (verses[i] !== verses[i - 1] + 1) {
          isContiguous = false;
          break;
        }
      }
      let scope: HeadingScope;
      if (opts.wholeChapter) {
        scope = { kind: 'chapter' };
      } else if (verses.length === 1) {
        scope = { kind: 'single', verse: firstVerse };
      } else if (isContiguous) {
        scope = { kind: 'range', from: firstVerse, to: lastVerse };
      } else {
        scope = { kind: 'list', verses };
      }
      plan.push({
        kind: 'heading',
        verseIndex: run.items[0].verseIndex,
        text: headingTextFor(run.bookId, run.chapter, runLang, scope),
        translation: runTranslation,
        // Brief breath after the announcement before the first verse.
        pauseAfterMs: opts.pauseBetweenVersesMs,
      });
    }

    for (let i = 0; i < run.items.length; i++) {
      const { verseIndex, verse } = run.items[i];
      const isLastVerseInRun = i === run.items.length - 1;
      const isVeryLast = isLastRun && isLastVerseInRun;

      if (opts.readVerseNumbers) {
        plan.push({
          kind: 'number',
          verseIndex,
          text: numberTextFor(
            verse.verse,
            localeForTranslation(verse.translation),
            opts.verseNumberStyle,
          ),
          translation: verse.translation,
          // No pause between "Verse 16" and the verse itself.
          pauseAfterMs: 0,
        });
      }

      let pauseAfterMs = 0;
      if (!isVeryLast) {
        pauseAfterMs = isLastVerseInRun
          ? opts.pauseBetweenChaptersMs
          : opts.pauseBetweenVersesMs;
      }
      plan.push({
        kind: 'verse',
        verseIndex,
        verse,
        pauseAfterMs,
      });
    }
  }

  return plan;
}

/**
 * Drop plan items that fall before `startVerseIndex`. Used when the user taps
 * a word mid-verse — we skip preceding verses AND their preceding
 * announcements so playback resumes at the chosen verse.
 *
 * The first kept item is always the verse at startVerseIndex if present;
 * its preceding heading/number are dropped so we don't re-announce mid-flow.
 */
export function sliceFromVerseIndex(
  plan: PlanItem[],
  startVerseIndex: number,
): PlanItem[] {
  if (startVerseIndex <= 0) return plan;
  // Find the first 'verse' item at startVerseIndex.
  const target = plan.findIndex(
    (it) => it.kind === 'verse' && it.verseIndex === startVerseIndex,
  );
  if (target < 0) return plan;
  return plan.slice(target);
}
