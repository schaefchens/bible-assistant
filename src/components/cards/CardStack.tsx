import { useEffect, useMemo, useRef, useState } from 'react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';

type Props = {
  cards: Card[];
  onEdit: (card: Card) => void;
  onDelete: (card: Card) => void;
  onReorder?: (fromId: string, toId: string) => void;
  raisedId?: string | null;
  onRaisedIdChange?: (id: string | null) => void;
  emptyLabel?: string;
};

const PEEK_PX = 96;
const PEEK_JITTER_PX = 10;
const X_JITTER_PX = 10;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;
const DRAG_MOVE_THRESHOLD_PX = 8;

export function CardStack({
  cards,
  onEdit,
  onDelete,
  onReorder,
  raisedId: raisedIdProp,
  onRaisedIdChange,
  emptyLabel,
}: Props) {
  const { t } = useTranslation();
  const [raisedIdLocal, setRaisedIdLocal] = useState<string | null>(null);
  const isControlled = onRaisedIdChange !== undefined;
  const raisedId = isControlled ? raisedIdProp ?? null : raisedIdLocal;
  const setRaisedId = (next: string | null) => {
    if (isControlled) onRaisedIdChange!(next);
    else setRaisedIdLocal(next);
  };
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const raisedRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [raisedHeight, setRaisedHeight] = useState<number>(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: MOVE_TOLERANCE_PX,
      },
    }),
  );

  const jitters = useMemo(
    () =>
      cards.map((card) => ({
        x: jitter(card.id, 'x', X_JITTER_PX),
        peek: jitter(card.id, 'y', PEEK_JITTER_PX),
      })),
    [cards],
  );

  const peekHeights = cards.map((_, idx) =>
    idx === cards.length - 1 ? 0 : Math.max(40, PEEK_PX + jitters[idx].peek),
  );

  useEffect(() => {
    if (!raisedId) return;
    const el = raisedRef.current;
    if (!el) return;
    const update = () => setRaisedHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    return () => ro.disconnect();
  }, [raisedId, flippedId, cards]);

  useEffect(() => {
    if (cards.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      const lastIdx = cards.length - 1;
      const activeIdx = raisedId
        ? cards.findIndex((c) => c.id === raisedId)
        : lastIdx;
      const activeCard = cards[activeIdx];
      if (!activeCard) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        const nextIdx = Math.max(0, Math.min(lastIdx, activeIdx + delta));
        if (nextIdx === activeIdx) return;
        const nextCard = cards[nextIdx];
        setFlippedId(null);
        setRaisedId(nextIdx === lastIdx ? null : nextCard.id);
        const el = itemRefs.current.get(nextCard.id);
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setFlippedId((f) => (f === activeCard.id ? null : activeCard.id));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        onEdit(activeCard);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onDelete(activeCard);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards, raisedId, onEdit, onDelete]);

  if (cards.length === 0) {
    return <p className="text-cream-dim italic px-4 py-6">{emptyLabel ?? '—'}</p>;
  }

  const lastIdx = cards.length - 1;
  const raisedIdx = cards.findIndex((c) => c.id === raisedId);
  const cumulativePeek = peekHeights
    .slice(0, raisedIdx >= 0 ? raisedIdx : 0)
    .reduce((a, b) => a + b, 0);
  const minContainerHeight =
    raisedIdx >= 0 ? cumulativePeek + raisedHeight + 48 : undefined;

  const toggleRaise = (id: string) => {
    setFlippedId(null);
    setRaisedId(raisedId === id ? null : id);
  };

  const toggleFlip = (id: string) => {
    setFlippedId((f) => (f === id ? null : id));
  };

  const handleDragStart = (_event: DragStartEvent) => {
    void _event;
    setRaisedId(null);
    setFlippedId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const moved = Math.hypot(delta.x, delta.y) > DRAG_MOVE_THRESHOLD_PX;
    const card = cards.find((c) => c.id === active.id);
    if (!card) return;
    if (!moved) {
      onEdit(card);
      return;
    }
    if (onReorder && over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  };

  const items = (
    <div className="px-3 pb-12" style={{ minHeight: minContainerHeight }}>
      {cards.map((card, idx) => {
        const isLast = idx === lastIdx;
        const isRaised = raisedId === card.id;
        const isFlipped = flippedId === card.id;
        const isActive = raisedId ? isRaised : isLast;
        const z = isRaised ? 999 : idx + 1;
        const { x: dx } = jitters[idx];

        return (
          <CardStackItem
            key={card.id}
            card={card}
            isLast={isLast}
            isRaised={isRaised}
            isFlipped={isFlipped}
            isActive={isActive}
            wrapperHeight={isLast ? undefined : peekHeights[idx]}
            zIndex={z}
            translateX={isRaised ? 0 : dx}
            raisedRef={isRaised ? raisedRef : null}
            refsMap={itemRefs}
            sortable={Boolean(onReorder)}
            onTap={() => toggleRaise(card.id)}
            onFlip={() => toggleFlip(card.id)}
            onEditClick={() => onEdit(card)}
            flipLabel={t(isFlipped ? 'cards.front' : 'cards.flip') as string}
            editLabel={t('cards.edit') as string}
            noNotesLabel={t('cards.noNotes')}
          />
        );
      })}
    </div>
  );

  if (!onReorder) return items;

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {items}
      </SortableContext>
    </DndContext>
  );
}

function CardStackItem({
  card,
  isLast,
  isRaised,
  isFlipped,
  isActive,
  wrapperHeight,
  zIndex,
  translateX,
  raisedRef,
  refsMap,
  sortable,
  onTap,
  onFlip,
  onEditClick,
  flipLabel,
  editLabel,
  noNotesLabel,
}: {
  card: Card;
  isLast: boolean;
  isRaised: boolean;
  isFlipped: boolean;
  isActive: boolean;
  wrapperHeight: number | undefined;
  zIndex: number;
  translateX: number;
  raisedRef: React.RefObject<HTMLDivElement | null> | null;
  refsMap: React.RefObject<Map<string, HTMLDivElement>>;
  sortable: boolean;
  onTap: () => void;
  onFlip: () => void;
  onEditClick: () => void;
  flipLabel: string;
  editLabel: string;
  noNotesLabel: string;
}) {
  const wrapperEl = useRef<HTMLDivElement | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !sortable });

  useEffect(() => {
    const map = refsMap.current;
    const el = wrapperEl.current;
    if (!map || !el) return;
    map.set(card.id, el);
    return () => {
      map.delete(card.id);
    };
  }, [card.id, refsMap]);

  const clip = !isLast && !isRaised && !isDragging;

  const wrapperStyle: React.CSSProperties = {
    height: wrapperHeight,
    zIndex: isDragging ? 2000 : zIndex,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  const setRefs = (el: HTMLDivElement | null) => {
    wrapperEl.current = el;
    setNodeRef(el);
  };

  return (
    <div
      ref={setRefs}
      className={[
        'relative w-full',
        clip ? 'overflow-hidden rounded-2xl' : '',
      ].join(' ')}
      style={wrapperStyle}
    >
      <div
        ref={raisedRef}
        className={[
          isLast ? 'relative' : 'absolute top-0 left-0 right-0',
          isActive ? 'opacity-100' : 'opacity-80',
        ].join(' ')}
        style={{
          transform: `translateX(${translateX}px)${isDragging ? ' scale(1.03)' : ''}`,
          boxShadow: isDragging ? '0 18px 40px rgba(0,0,0,0.55)' : undefined,
          borderRadius: isDragging ? '1rem' : undefined,
        }}
      >
        <div
          {...attributes}
          {...listeners}
          role={attributes.role ?? 'button'}
          tabIndex={attributes.tabIndex ?? 0}
          className="block w-full text-left cursor-pointer rounded-2xl select-none focus:outline-none"
          onClick={onTap}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTap();
            }
          }}
        >
          {isFlipped ? (
            <div className="grid">
              <div
                className="row-start-1 col-start-1 invisible"
                aria-hidden
              >
                <CardFace card={card} size="full" isActive={isActive} />
              </div>
              <div className="row-start-1 col-start-1">
                <CardBack card={card} emptyLabel={noNotesLabel} isActive={isActive} />
              </div>
            </div>
          ) : (
            <CardFace card={card} size="full" isActive={isActive} />
          )}
        </div>

        <div
          className="absolute top-2 right-2 flex gap-2"
          style={{ zIndex: 1100 }}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onFlip();
            }}
            className="rounded-full bg-black/50 hover:bg-black/70 text-cream text-xs px-2.5 py-1"
          >
            {flipLabel}
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditClick();
            }}
            className="rounded-full bg-black/50 hover:bg-black/70 text-cream text-xs px-2.5 py-1"
            aria-label={editLabel}
          >
            ✎
          </button>
        </div>
      </div>
    </div>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function jitter(id: string, seed: string, range: number): number {
  const h = Math.abs(hashStr(`${id}:${seed}`)) % 1000;
  return (h / 1000 - 0.5) * 2 * range;
}
