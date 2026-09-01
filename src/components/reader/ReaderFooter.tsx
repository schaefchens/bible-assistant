import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useBottomBarHeight } from '@/hooks/useBottomBarHeight';
import { useReaderSequence } from '@/hooks/useReaderSequence';
import { formatSegment } from '@/services/reading/readingSequence';
import { useReaderStore } from '@/store/readerStore';

type Props = { onStep: (dir: 1 | -1) => void };

/**
 * Paged navigation — one segment at a time, like turning a page. Hidden in
 * endless-scroll mode, where the scroll itself is the navigation.
 *
 * "Next" means next in whatever the reader is walking through: the following
 * chapter of the Bible, or the following passage of a reading list.
 */
export function ReaderFooter({ onStep }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';

  const position = useReaderStore((s) => s.position);
  const source = useReaderStore((s) => s.source);
  const loading = useReaderStore((s) => s.status === 'loading');
  const sequence = useReaderSequence();
  // Publish our height so the mic and playback bar float above the pager
  // instead of covering it.
  const barRef = useRef<HTMLElement>(null);
  useBottomBarHeight(barRef);
  if (!position) return null;

  const prev = sequence.prev(position);
  const next = sequence.next(position);
  // Three sources, three ways to say "there is nothing before/after this".
  const edge =
    source.kind === 'list'
      ? 'List'
      : source.kind === 'space'
        ? 'Space'
        : source.kind === 'selection'
          ? 'Selection'
          : 'Bible';

  return (
    <nav
      ref={barRef}
      className="flex items-stretch gap-2 px-3 py-2 border-t border-surface-raised/50 bg-surface/90 backdrop-blur"
    >
      <StepButton
        disabled={!prev || loading}
        onClick={() => onStep(-1)}
        aria-label={t('read.prevChapter') as string}
      >
        {prev ? <>← {formatSegment(prev, lang)}</> : t(`read.startOf${edge}`)}
      </StepButton>
      <StepButton
        disabled={!next || loading}
        onClick={() => onStep(1)}
        aria-label={t('read.nextChapter') as string}
      >
        {next ? <>{formatSegment(next, lang)} →</> : t(`read.endOf${edge}`)}
      </StepButton>
    </nav>
  );
}

function StepButton({
  children,
  disabled,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex-1 min-w-0 h-10 px-2 rounded-xl border border-brand/30 text-brand',
        'text-[12px] sm:text-sm truncate',
        'hover:bg-brand/10 active:scale-[0.98] transition-all',
        'disabled:opacity-35 disabled:pointer-events-none',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
