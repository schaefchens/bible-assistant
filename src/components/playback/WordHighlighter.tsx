import { useMemo } from 'react';
import clsx from 'clsx';
import { usePlaybackStore } from '@/store/playbackStore';
import type { VerseSummary } from '@/types/domain';


type Props = {
  messageId: string;
  verseIndex: number;
  verse: VerseSummary;
  onWordTap?: (verseIndex: number, wordIndex: number) => void;
};

export function WordHighlighter({ messageId, verseIndex, verse, onWordTap }: Props) {
  // Subscribe to primitives rather than the whole `current` object. The
  // playback rAF loop rebuilds `current` ~60×/sec (to advance `position`),
  // so selecting the object would re-render every verse in the chapter every
  // frame. These selectors return stable values for verses that aren't the
  // active one, so only the playing verse re-renders, and only when its word
  // index actually changes.
  const isCurrent = usePlaybackStore(
    (s) => s.current?.messageId === messageId && s.current.verseIndex === verseIndex,
  );
  const activeWordIndex = usePlaybackStore((s) =>
    s.current?.messageId === messageId && s.current.verseIndex === verseIndex
      ? s.current.currentWordIndex
      : -1,
  );

  const words = useMemo(() => verse.text.split(/(\s+)/), [verse.text]);
  let wordCounter = -1;

  return (
    <p
      data-verse-key={`${messageId}:${verseIndex}`}
      className={clsx(
        'verse leading-relaxed font-serif text-cream scroll-mt-16',
        isCurrent && 'verse-current',
      )}
    >
      <span className="text-gold-dim text-xs font-sans mr-2 align-baseline">
        {verse.verse}
      </span>
      {words.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        wordCounter++;
        const idx = wordCounter;
        const active = activeWordIndex === idx;
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
            className={clsx(
              'word',
              active && 'word-active',
              handler && 'cursor-pointer',
            )}
          >
            {token}
          </span>
        );
      })}
    </p>
  );
}
