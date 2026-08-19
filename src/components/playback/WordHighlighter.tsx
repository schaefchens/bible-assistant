import { useMemo } from 'react';
import clsx from 'clsx';
import { usePlaybackStore } from '@/store/playbackStore';
import type { VerseSummary } from '@/types/domain';


type Props = {
  groupId: string;
  verseIndex: number;
  verse: VerseSummary;
  onWordTap?: (verseIndex: number, wordIndex: number) => void;
  /**
   * `'block'` (default) gives each verse its own paragraph — the chat reader.
   * `'inline'` renders it as a `<span>` so several verses flow together into one
   * paragraph, which is what a print Bible looks like. Inline also switches the
   * verse number to a superscript.
   */
  layout?: 'block' | 'inline';
  /**
   * Render this verse's first letter as an oversized initial (the reader uses it
   * on each chapter's opening verse).
   *
   * Decorative only: the initial is nested *inside* the existing first-word span
   * rather than becoming its own token, so the word index space the TTS alignment
   * depends on is untouched, and tapping the word still resolves to word 0.
   */
  initial?: boolean;
};

export function WordHighlighter({
  groupId,
  verseIndex,
  verse,
  onWordTap,
  layout = 'block',
  initial = false,
}: Props) {
  // Subscribe to primitives rather than the whole `current` object. The
  // playback rAF loop rebuilds `current` ~60×/sec (to advance `position`),
  // so selecting the object would re-render every verse in the chapter every
  // frame. These selectors return stable values for verses that aren't the
  // active one, so only the playing verse re-renders, and only when its word
  // index actually changes.
  const isCurrent = usePlaybackStore(
    (s) => s.current?.groupId === groupId && s.current.verseIndex === verseIndex,
  );
  const activeWordIndex = usePlaybackStore((s) =>
    s.current?.groupId === groupId && s.current.verseIndex === verseIndex
      ? s.current.currentWordIndex
      : -1,
  );

  const words = useMemo(() => verse.text.split(/(\s+)/), [verse.text]);
  let wordCounter = -1;

  const inline = layout === 'inline';
  // Both variants carry `data-verse-key`: it is the contract
  // useAutoScrollActiveVerse queries to follow the reading.
  const Tag = inline ? 'span' : 'p';

  const tokens = words.map((token, i) => {
    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
    wordCounter++;
    const idx = wordCounter;
    const active = activeWordIndex === idx;
    const body =
      initial && idx === 0 && token.length > 0 ? (
        <>
          <span className="chapter-initial">{token[0]}</span>
          {token.slice(1)}
        </>
      ) : (
        token
      );
    const handler = onWordTap
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          onWordTap(verseIndex, idx);
        }
      : undefined;
    return (
      <span
        key={i}
        role={handler ? 'button' : undefined}
        tabIndex={handler ? -1 : undefined}
        onClick={handler}
        className={clsx('word', active && 'word-active', handler && 'cursor-pointer')}
      >
        {body}
      </span>
    );
  });

  return (
    <Tag
      data-verse-key={`${groupId}:${verseIndex}`}
      className={clsx(
        'font-serif text-cream scroll-mt-16',
        inline ? 'verse-inline' : 'verse leading-relaxed',
        isCurrent && 'verse-current',
      )}
    >
      {inline ? (
        <sup className="text-gold-dim text-[0.65em] font-sans mr-0.5 select-none">
          {verse.verse}
        </sup>
      ) : (
        <span className="text-gold-dim text-xs font-sans mr-2 align-baseline">
          {verse.verse}
        </span>
      )}
      {tokens}
    </Tag>
  );
}
