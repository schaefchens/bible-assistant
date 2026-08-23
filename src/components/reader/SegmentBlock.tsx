import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { groupIntoParagraphs } from '@/lib/readerParagraphs';
import { playFromVerseWord, startPlaybackForVerses } from '@/lib/startPlayback';
import { formatRangeList, formatReference } from '@/services/bible/bookCatalog';
import { isWholeChapter } from '@/services/reading/readingSequence';
import type { LoadedSegment } from '@/store/readerStore';

type Props = { segment: LoadedSegment };

/**
 * One segment of flowing prose — a whole chapter, or the slice of one a
 * reading-list entry asked for.
 *
 * Memoized on the `LoadedSegment` object identity (stable in the store), so
 * appending or prepending under endless scroll doesn't re-render what's already
 * on screen.
 */
export const SegmentBlock = memo(function SegmentBlock({ segment }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const { ref, verses, id } = segment;

  const paragraphs = useMemo(() => groupIntoParagraphs(verses), [verses]);

  const handleWordTap = useCallback(
    (verseIndex: number, wordIndex: number) => {
      playFromVerseWord(id, verses, verseIndex, wordIndex);
    },
    [id, verses],
  );

  // A partial segment names its verses, because "Psalms 23" over six verses of
  // a longer psalm would misdescribe what is on the page.
  const heading = isWholeChapter(ref)
    ? formatReference(ref.bookId, ref.chapter, undefined, undefined, lang)
    : formatRangeList(ref.bookId, ref.chapter, ref.ranges ?? [], lang);

  // The list's own words for this reading: the entry note, else the day.
  const subheading =
    ref.label ??
    (ref.dayTitle ??
      (ref.dayIndex === undefined ? undefined : t('lists.day', { number: ref.dayIndex + 1 })));

  return (
    // The generous bottom padding is the segment separator: together with the
    // ruled heading below it, a new chapter is unmistakable while scrolling.
    <section data-segment-id={id} className="pb-16">
      <header className="relative flex items-center justify-center mb-6">
        {/* A rule spanning the column, with the heading punching a gap in it. */}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-brand/20" />
        <h2 className="chapter-heading relative bg-surface px-5 text-lg">{heading}</h2>
        {/* Absolutely positioned so it can't pull the heading off centre. Its own
            bg-surface opens a matching gap in the rule. */}
        <span className="absolute right-0 bg-surface pl-3">
          <button
            type="button"
            aria-label={t('read.playChapter') as string}
            title={t('read.playChapter') as string}
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
        <p className="-mt-4 mb-5 text-center text-[11px] uppercase tracking-wider text-brand-muted">
          {subheading}
        </p>
      )}

      <div className="font-serif text-ink/95 text-[17px] leading-8 space-y-4">
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
