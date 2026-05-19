import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';
import { FlipCard } from './FlipCard';

type Props = {
  cards: Card[];
  onOpen: (card: Card) => void;
  reorderMode?: boolean;
  onMove?: (cardId: string, dir: 'prev' | 'next') => void;
  emptyLabel?: string;
};

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;

export function BoardGrid({ cards, onOpen, reorderMode, onMove, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  if (cards.length === 0) {
    return <p className="text-cream-dim italic px-4 py-6">{emptyLabel ?? '—'}</p>;
  }

  const toggleFlip = (id: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="px-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((card, idx) => (
        <BoardCell
          key={card.id}
          card={card}
          flipped={flipped.has(card.id)}
          reorderMode={!!reorderMode}
          canMovePrev={idx > 0}
          canMoveNext={idx < cards.length - 1}
          onTap={() => toggleFlip(card.id)}
          onLongPress={() => onOpen(card)}
          onEditClick={() => onOpen(card)}
          onMovePrev={() => onMove?.(card.id, 'prev')}
          onMoveNext={() => onMove?.(card.id, 'next')}
          editLabel={t('cards.edit') as string}
          noNotesLabel={t('cards.noNotes')}
          prevLabel={t('boards.movePrev') as string}
          nextLabel={t('boards.moveNext') as string}
        />
      ))}
    </div>
  );
}

function BoardCell({
  card,
  flipped,
  reorderMode,
  canMovePrev,
  canMoveNext,
  onTap,
  onLongPress,
  onEditClick,
  onMovePrev,
  onMoveNext,
  editLabel,
  noNotesLabel,
  prevLabel,
  nextLabel,
}: {
  card: Card;
  flipped: boolean;
  reorderMode: boolean;
  canMovePrev: boolean;
  canMoveNext: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onEditClick: () => void;
  onMovePrev: () => void;
  onMoveNext: () => void;
  editLabel: string;
  noNotesLabel: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPress = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const interactive = !reorderMode;

  return (
    <div
      className={[
        'relative aspect-[3/4] select-none',
        reorderMode ? 'ring-2 ring-gold/40 rounded-2xl' : '',
      ].join(' ')}
    >
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : -1}
        className={interactive ? 'w-full h-full cursor-pointer' : 'w-full h-full'}
        onPointerDown={
          interactive
            ? (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                startRef.current = { x: e.clientX, y: e.clientY };
                didLongPress.current = false;
                clearTimer();
                timerRef.current = setTimeout(() => {
                  didLongPress.current = true;
                  onLongPress();
                }, LONG_PRESS_MS);
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (e) => {
                if (!startRef.current) return;
                const dx = e.clientX - startRef.current.x;
                const dy = e.clientY - startRef.current.y;
                if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
                  clearTimer();
                }
              }
            : undefined
        }
        onPointerUp={
          interactive
            ? () => {
                clearTimer();
                if (!didLongPress.current) onTap();
                startRef.current = null;
              }
            : undefined
        }
        onPointerCancel={
          interactive
            ? () => {
                clearTimer();
                startRef.current = null;
              }
            : undefined
        }
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onTap();
                }
              }
            : undefined
        }
      >
        <FlipCard
          flipped={flipped}
          front={<CardFace card={card} size="grid" />}
          back={<CardBack card={card} emptyLabel={noNotesLabel} />}
        />
      </div>

      {!reorderMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditClick();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 z-10 rounded-full bg-black/40 hover:bg-black/60 text-cream text-xs w-7 h-7 inline-flex items-center justify-center backdrop-blur-sm"
          aria-label={editLabel}
        >
          ✎
        </button>
      )}

      {reorderMode && (
        <div className="absolute inset-x-1.5 bottom-1.5 z-10 flex justify-between gap-1">
          <button
            type="button"
            onClick={onMovePrev}
            disabled={!canMovePrev}
            className="rounded-full bg-black/50 hover:bg-black/70 text-cream text-base w-8 h-8 inline-flex items-center justify-center backdrop-blur-sm disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={prevLabel}
          >
            ←
          </button>
          <button
            type="button"
            onClick={onMoveNext}
            disabled={!canMoveNext}
            className="rounded-full bg-black/50 hover:bg-black/70 text-cream text-base w-8 h-8 inline-flex items-center justify-center backdrop-blur-sm disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={nextLabel}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
