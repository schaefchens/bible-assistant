import { useCallback } from 'react';
import type { Card, FreeformCardLayout } from '@/types/domain';
import { type HandleId } from '@/lib/freeformLayout';
import { CardFace } from '../CardFace';
import { CardBack } from '../CardBack';
import { FlipCard } from '../FlipCard';
import { FreeformHandles } from './FreeformHandles';

type Props = {
  card: Card;
  layout: FreeformCardLayout;
  selected: boolean;
  /** Edit mode shows resize/rotate handles; view mode only shows the ring. */
  editMode: boolean;
  /** Board design dimensions (px) for the current orientation. */
  boardW: number;
  boardH: number;
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
  editMode,
  boardW,
  boardH,
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
    left: layout.x * boardW,
    top: layout.y * boardH,
    width: layout.w * boardW,
    height: layout.h * boardH,
    transform: `rotate(${layout.rotation}deg)`,
    transformOrigin: 'center center',
    zIndex: layout.z,
    touchAction: 'none',
  };

  return (
    <div ref={ref} style={style} data-card-id={card.id}>
      <div
        className="w-full h-full select-none cursor-grab active:cursor-grabbing focus:outline-none"
        style={{
          touchAction: 'none',
          // Shadow so cards read as physical pieces pinned to the board.
          // drop-shadow follows the card's rounded silhouette and rotates with
          // it (unlike a box-shadow on the rectangular wrapper).
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3)) drop-shadow(0 6px 10px rgba(0,0,0,0.4))',
        }}
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
          {editMode && (
            <FreeformHandles
              cardId={card.id}
              scale={scale}
              onHandlePointerDown={onHandlePointerDown}
            />
          )}
        </>
      )}
    </div>
  );
}
