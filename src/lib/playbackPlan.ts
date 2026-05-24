import i18n from '@/i18n';
import { getBookById } from '@/services/bible/bookCatalog';
import type { Translation } from '@/services/bible/bibleApi';
import type { Locale, VerseSummary } from '@/types/domain';

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
};

/** Spoken language for a Bible translation — drives both the announcement
 * text (book name, "chapter X" / "Kapitel X") and the browser TTS voice. */
export function localeForTranslation(t: Translation): Locale {
  return t === 'S00' || t === 'LUT' || t === 'HFA' ? 'de' : 'en';
}

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

function headingTextFor(bookId: number, chapter: number, locale: Locale): string {
  const book = getBookById(bookId);
  const bookName = book ? (locale === 'de' ? book.nameDe : book.nameEn) : '';
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
      plan.push({
        kind: 'heading',
        verseIndex: run.items[0].verseIndex,
        text: headingTextFor(run.bookId, run.chapter, runLang),
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
