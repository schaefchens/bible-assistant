import type { Card } from '@/types/domain';
import { colorClasses } from './cardColors';

type Props = {
  card: Card;
  emptyLabel?: string;
  isActive?: boolean;
};

export function CardBack({ card, emptyLabel, isActive = false }: Props) {
  const c = colorClasses(card.color);
  const notes = card.notes?.trim();
  // em-based so notes scale off the root font-size (card.textScale).
  const notesSize = isActive ? 'text-[1em]' : 'text-[0.875em]';

  return (
    <div
      className={[
        c.bg,
        c.fg,
        'card-paper card-back-ruled rounded-2xl shadow-md w-full h-full px-4 py-3 flex flex-col gap-2 overflow-y-auto',
      ].join(' ')}
      style={{ fontSize: `${card.textScale ?? 1}em` }}
    >
      <div className={['text-[10px] uppercase tracking-wide', c.fgDim].join(' ')}>
        {card.title || '—'}
      </div>
      <div className={['flex-1 whitespace-pre-wrap break-words leading-relaxed', notesSize].join(' ')}>
        {notes || (
          <span className={['italic', c.fgDim].join(' ')}>{emptyLabel ?? '—'}</span>
        )}
      </div>
    </div>
  );
}
