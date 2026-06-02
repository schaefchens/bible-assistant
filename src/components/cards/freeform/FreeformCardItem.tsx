import { useCallback } from 'react';
import type { Card, FreeformCardLayout } from '@/types/domain';
import { BOARD_W, BOARD_H, type HandleId } from '@/lib/freeformLayout';
import { CardFace } from '../CardFace';
import { CardBack } from '../CardBack';
import { FlipCard } from '../FlipCard';
import { FreeformHandles } from './FreeformHandles';

type Props = {
  card: Card;
  layout: FreeformCardLayout;
  selected: boolean;
  /** Current board zoom, so handles can counter-scale to stay finger-sized. */
  scale: number;
  noNotesLabel: string;
  /** Register the wrapper DOM node so FreeformBoard can mutate its style
   * imperatively during a gesture (the 60fps hot path, zero React renders). */
  registerEl: (id: string, el: HTMLDivElement | null) => void;
  onCardPointerDown: (e: React.PointerEvent, cardId: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, cardId: string, handle: HandleId) => void;
};

export function FreeformCardItem({
  card,
  layout,
  selected,
  scale,
  noNotesLabel,
  registerEl,
  onCardPointerDown,
  onHandlePointerDown,
}: Props) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => registerEl(card.id, node),
    [card.id, registerEl],
  );

  const style: React.CSSProperties = {
    position: 'absolute',
    left: layout.x * BOARD_W,
    top: layout.y * BOARD_H,
    width: layout.w * BOARD_W,
    height: layout.h * BOARD_H,
    transform: `rotate(${layout.rotation}deg)`,
    transformOrigin: 'center center',
    zIndex: layout.z,
    touchAction: 'none',
  };

  return (
    <div ref={ref} style={style} data-card-id={card.id}>
      <div
        className="w-full h-full select-none cursor-grab active:cursor-grabbing focus:outline-none"
        onPointerDown={(e) => onCardPointerDown(e, card.id)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <FlipCard
          flipped={false}
          front={<CardFace card={card} size="grid" />}
          back={<CardBack card={card} emptyLabel={noNotesLabel} />}
        />
      </div>

      {selected && (
        <>
          {/* Selection outline — rotates with the card, ignores pointer events. */}
          <div className="absolute inset-0 rounded-2xl ring-2 ring-gold pointer-events-none" />
          <FreeformHandles
            cardId={card.id}
            scale={scale}
            onHandlePointerDown={onHandlePointerDown}
          />
        </>
      )}
    </div>
  );
}
