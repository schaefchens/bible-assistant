import { memo, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { groupIntoParagraphs } from '@/lib/readerParagraphs';
import { playFromVerseWord, startPlaybackForVerses } from '@/lib/startPlayback';
import { formatRangeList, formatReference } from '@/services/bible/bookCatalog';
import { isPostSegment, isWholeChapter } from '@/services/reading/readingSequence';
import type { LoadedSegment } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

type Props = { segment: LoadedSegment };

/**
 * One segment of flowing prose — a whole chapter, the slice of one a
 * reading-list entry asked for, or one user-written post.
 *
 * A post differs in exactly three ways, all of them because it is not
 * scripture: its heading is its title, its paragraphs are the author's rather
 * than inferred, and its units carry no verse numbers.
 *
 * Memoized on the `LoadedSegment` object identity (stable in the store), so
 * appending or prepending under endless scroll doesn't re-render what's already
 * on screen.
 */
export const SegmentBlock = memo(function SegmentBlock({ segment }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const { ref, verses, id } = segment;

  const isPost = isPostSegment(ref);

  // A post's paragraphs are the author's own: `postToUnits` already produced one
  // unit per authored paragraph, so grouping them again by the sentence
  // heuristic would re-flow breaks somebody chose deliberately. That heuristic
  // exists because *no* source bible carries paragraph markup — a post does.
  const paragraphs = useMemo(
    () => (isPost ? verses.map((_, i) => [i]) : groupIntoParagraphs(verses)),
    [isPost, verses],
  );
  const dualColumn = useSettingsStore((s) => s.readingAppearance.dualColumn);

  const handleWordTap = useCallback(
    (verseIndex: number, wordIndex: number) => {
      playFromVerseWord(id, verses, verseIndex, wordIndex);
    },
    [id, verses],
  );

  // A partial segment names its verses, because "Psalms 23" over six verses of
  // a longer psalm would misdescribe what is on the page. A post's reference is
  // its title — there is no book to name.
  const heading = isPost
    ? (ref.postTitle ?? verses[0]?.unit?.title ?? '')
    : isWholeChapter(ref)
      ? formatReference(ref.bookId, ref.chapter, undefined, undefined, lang)
      : formatRangeList(ref.bookId, ref.chapter, ref.ranges ?? [], lang);

  // Who wrote it, for a post; otherwise the list's own words for this reading:
  // the entry note, else the day.
  const subheading = isPost
    ? (verses[0]?.unit?.author || undefined)
    : (ref.label ??
      (ref.dayTitle ??
        (ref.dayIndex === undefined ? undefined : t('lists.day', { number: ref.dayIndex + 1 }))));

  return (
    // The generous bottom padding is the segment separator: together with the
    // ruled heading below it, a new chapter is unmistakable while scrolling.
    <section
      data-segment-id={id}
      className={clsx('reading-column pb-16', dualColumn && 'is-dual')}
    >
      <header className="relative flex items-center justify-center mb-6">
        {/* A rule spanning the column, with the heading punching a gap in it. */}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-brand/20" />
        <h2 className="chapter-heading relative bg-surface px-5 text-[1.1em]">{heading}</h2>
        {/* Absolutely positioned so it can't pull the heading off centre. Its own
            bg-surface opens a matching gap in the rule. */}
        <span className="absolute right-0 bg-surface pl-3">
          <button
            type="button"
            aria-label={t(isPost ? 'read.playPost' : 'read.playChapter') as string}
            title={t(isPost ? 'read.playPost' : 'read.playChapter') as string}
            onClick={() => {
              // The tap is the user gesture that unlocks audio on iOS;
              // startPlaybackForVerses calls ensureContext() synchronously.
              audioPlayback.ensureContext();
              void startPlaybackForVerses(id, verses, 0);
            }}
            className="h-8 w-8 rounded-full flex items-center justify-center text-brand border border-brand/40 hover:bg-brand/10 active:scale-95 transition-all"
          >
            <PlayIcon />
          </button>
        </span>
      </header>

      {subheading && (
        <p className="-mt-4 mb-5 text-center text-[0.65em] uppercase tracking-wider text-brand-muted">
          {subheading}
        </p>
      )}

      <div className="reading-prose text-ink/95 space-y-4">
        {paragraphs.map((indices) => (
          <p key={indices[0]}>
            {indices.map((verseIndex, n) => (
              <span key={verseIndex}>
                {n > 0 && ' '}
                <WordHighlighter
                  groupId={id}
                  verseIndex={verseIndex}
                  verse={verses[verseIndex]}
                  onWordTap={handleWordTap}
                  layout="inline"
                  initial={verseIndex === 0}
                  showNumber={!isPost}
                />
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  );
});

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4l14 8-14 8V4z" />
    </svg>
  );
}
