import type { Card } from '@/types/domain';
import { colorClasses } from './cardColors';
import { useVerseText } from '@/hooks/useVerseText';

type Size = 'grid' | 'full';

type Props = {
  card: Card;
  size: Size;
};

export function CardFace({ card, size: _size }: Props) {
  const c = colorClasses(card.color);
  void _size;
  const showTags = card.tags && card.tags.length > 0;

  return (
    <div
      className={[
        c.bg,
        c.fg,
        'card-paper rounded-2xl shadow-md w-full h-full px-4 py-3 flex flex-col gap-2 overflow-hidden',
      ].join(' ')}
    >
      <div className="shrink-0 font-serif text-base sm:text-lg leading-snug line-clamp-2 break-words">
        {card.title || '—'}
      </div>
      {card.references.length > 0 && (
        <div className="flex-1 min-h-0 overflow-hidden space-y-2">
          {card.references.map((r, i) => (
            <VerseBlock key={i} reference={r} dimClass={c.fgDim} />
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

function VerseBlock({ reference, dimClass }: { reference: string; dimClass: string }) {
  const text = useVerseText(reference);
  return (
    <div>
      <div className={['font-serif text-sm sm:text-base', dimClass].join(' ')}>{reference}</div>
      <div className="font-serif text-xs sm:text-sm mt-0.5 leading-snug opacity-90">
        {text ?? <span className={dimClass}>…</span>}
      </div>
    </div>
  );
}
