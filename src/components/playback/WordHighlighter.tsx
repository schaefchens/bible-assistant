import { useMemo } from 'react';
import clsx from 'clsx';
import { usePlaybackStore } from '@/store/playbackStore';
import type { VerseSummary } from '@/types/domain';

type Props = {
  messageId: string;
  verseIndex: number;
  verse: VerseSummary;
};

export function WordHighlighter({ messageId, verseIndex, verse }: Props) {
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
        const active = activeWordIndex === wordCounter;
        return (
          <span key={i} className={clsx('word', active && 'word-active')}>
            {token}
          </span>
        );
      })}
    </p>
  );
}
