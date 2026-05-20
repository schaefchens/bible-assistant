import type { Card } from '@/types/domain';
import { colorClasses } from './cardColors';
import { useVerseText } from '@/hooks/useVerseText';

type Size = 'grid' | 'full';

type Props = {
  card: Card;
  size: Size;
  isActive?: boolean;
};

export function CardFace({ card, size: _size, isActive = false }: Props) {
  const c = colorClasses(card.color);
  void _size;
  const showTags = card.tags && card.tags.length > 0;
  const titleSize = isActive ? 'text-lg sm:text-xl' : 'text-base sm:text-lg';
  const emojiSize = isActive ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl';

  return (
    <div
      className={[
        c.bg,
        c.fg,
        'card-paper rounded-2xl shadow-md w-full h-full px-4 py-3 flex flex-col gap-2 overflow-hidden',
      ].join(' ')}
    >
      <div className="shrink-0 flex items-start gap-2">
        {card.emoji && (
          <span className={[emojiSize, 'leading-snug shrink-0'].join(' ')} aria-hidden>
            {card.emoji}
          </span>
        )}
        <div className={['font-serif font-bold leading-snug line-clamp-2 break-words', titleSize].join(' ')}>
          {card.title || '—'}
        </div>
      </div>
      {card.references.length > 0 && (
        <div className="flex-1 min-h-0 overflow-hidden space-y-2">
          {card.references.map((r, i) => (
            <VerseBlock key={i} reference={r} dimClass={c.fgDim} isActive={isActive} />
          ))}
        </div>
      )}
      {showTags && (
        <div className="shrink-0 pt-2 flex flex-wrap gap-1">
          {card.tags!.map((tag) => (
            <span
              key={tag}
              className={[
                'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                'bg-black/10',
                c.fgDim,
              ].join(' ')}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VerseBlock({
  reference,
  dimClass,
  isActive,
}: {
  reference: string;
  dimClass: string;
  isActive: boolean;
}) {
  const text = useVerseText(reference);
  const verseSize = isActive ? 'text-lg sm:text-xl' : 'text-base sm:text-lg';
  return (
    <div>
      <div className={['font-sans text-[11px] uppercase tracking-wide', dimClass].join(' ')}>
        {reference}
      </div>
      <div className={['font-serif mt-0.5 leading-snug', verseSize].join(' ')}>
        {text ?? <span className={dimClass}>…</span>}
      </div>
    </div>
  );
}
