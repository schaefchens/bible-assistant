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
  const current = usePlaybackStore((s) => s.current);
  const isCurrent =
    current?.messageId === messageId && current.verseIndex === verseIndex;
  const activeWordIndex = isCurrent ? current.currentWordIndex : -1;

  const words = useMemo(() => verse.text.split(/(\s+)/), [verse.text]);
  let wordCounter = -1;

  return (
    <p className="leading-relaxed font-serif text-cream">
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
