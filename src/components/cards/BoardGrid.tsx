import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';
import { FlipCard } from './FlipCard';

type Props = {
  cards: Card[];
  onOpen: (card: Card) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onRemove?: (card: Card) => void;
  emptyLabel?: string;
};

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;
const DRAG_MOVE_THRESHOLD_PX = 8;

export function BoardGrid({ cards, onOpen, onReorder, onRemove, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: MOVE_TOLERANCE_PX,
      },
    }),
  );

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

  const handleDragStart = (_event: DragStartEvent) => {
    void _event;
    // Clear all flipped states on drag start so the dragged card shows its face.
    setFlipped(new Set());
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const moved = Math.hypot(delta.x, delta.y) > DRAG_MOVE_THRESHOLD_PX;
    const card = cards.find((c) => c.id === active.id);
    if (!card) return;
    if (!moved) {
      onOpen(card);
      return;
    }
    if (onReorder && over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  };

  const grid = (
    <div className="px-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((card) => (
        <BoardCell
          key={card.id}
          card={card}
          flipped={flipped.has(card.id)}
          sortable={Boolean(onReorder)}
          onTap={() => toggleFlip(card.id)}
          onRemoveClick={onRemove ? () => onRemove(card) : undefined}
          noNotesLabel={t('cards.noNotes')}
          removeLabel={t('boards.removeFromBoard') as string}
        />
      ))}
    </div>
  );

  if (!onReorder) return grid;

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToParentElement]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  );
}

function BoardCell({
  card,
  flipped,
  sortable,
  onTap,
  onRemoveClick,
  noNotesLabel,
  removeLabel,
}: {
  card: Card;
  flipped: boolean;
  sortable: boolean;
  onTap: () => void;
  onRemoveClick?: () => void;
  noNotesLabel: string;
  removeLabel: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !sortable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2000 : undefined,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? '0 18px 40px rgba(0,0,0,0.55)' : undefined,
    borderRadius: isDragging ? '1rem' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className="relative aspect-[3/4] select-none"
      style={style}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        className="w-full h-full cursor-pointer touch-pan-y focus:outline-none"
        onClick={onTap}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTap();
          }
        }}
      >
        <FlipCard
          flipped={flipped}
          front={<CardFace card={card} size="grid" />}
          back={<CardBack card={card} emptyLabel={noNotesLabel} />}
        />
      </div>

      {onRemoveClick && (
        <div className="absolute top-1.5 right-1.5 z-10">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveClick();
            }}
            className="rounded-full bg-black/40 hover:bg-black/60 text-cream text-xs w-7 h-7 inline-flex items-center justify-center backdrop-blur-sm"
            aria-label={removeLabel}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
