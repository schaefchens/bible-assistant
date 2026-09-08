import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
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
import {
  DRAG_MOVE_THRESHOLD_PX,
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
} from '@/lib/gestureConstants';
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
  /** Carrying a card out of the list (onto a board's tab — see
   * `useCardTabDrop`). Reported at drag start with the card and at drag
   * end/cancel with null, so the caller can arm the drop targets. */
  onCardDrag?: (card: Card | null) => void;
  /** Offered the drop before the reorder; `true` means the caller took it.
   * Passing this also unclamps the drag from the list's box (see `modifiers`)
   * and stops the carried card taking pointer events, so whatever is under the
   * finger can be hit-tested. */
  onDropOutside?: (card: Card) => boolean;
  /** The carried card is over the drop zone (the sticky tab strip). Two
   * consequences, which is why the prop names the *state* and not either one:
   * dnd-kit's edge autoscroll is paused, since the strip sits inside the
   * scroller's top threshold band and would otherwise scroll the list to the
   * top while you aim; and the card fades, so the tab it is covering — the
   * card spans the column, so it covers all of them — stays readable. */
  overDropZone?: boolean;
};

const PEEK_PX = 96;
const PEEK_JITTER_PX = 10;
const X_JITTER_PX = 10;

export function CardStack({
  cards,
  onEdit,
  onDelete,
  onReorder,
  raisedId: raisedIdProp,
  onRaisedIdChange,
  emptyLabel,
  onCardDrag,
  onDropOutside,
  overDropZone,
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

  // MouseSensor + TouchSensor (not PointerSensor) so quick vertical touch swipes
  // pass through to native scroll on iOS/Android. Both sensors use a long-press
  // delay so a hold-without-moving still enters drag mode — that's the "long
  // press to edit" gesture (handleDragEnd fires onEdit when delta < threshold).
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: MOVE_TOLERANCE_PX,
      },
    }),
    useSensor(TouchSensor, {
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
    return <p className="text-ink-muted italic px-4 py-6">{emptyLabel ?? '—'}</p>;
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

  const handleDragStart = (event: DragStartEvent) => {
    setRaisedId(null);
    setFlippedId(null);
    onCardDrag?.(cards.find((c) => c.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const moved = Math.hypot(delta.x, delta.y) > DRAG_MOVE_THRESHOLD_PX;
    const card = cards.find((c) => c.id === active.id);
    // The drop is offered *before* the carry is torn down, because the holder
    // of the drop target is the same thing tracking the carry — asking it
    // afterwards gets an answer it has just forgotten. A press that never
    // moved is the edit gesture and never a drop, so it isn't offered at all.
    const consumed = card && moved ? Boolean(onDropOutside?.(card)) : false;
    onCardDrag?.(null);
    if (!card) return;
    if (!moved) {
      onEdit(card);
      return;
    }
    if (consumed) return;
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
            carryable={Boolean(onDropOutside)}
            faded={Boolean(overDropZone)}
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
      // restrictToParentElement is dropped when a card may be carried out of
      // the list: it is what pins the drag inside the list's box, and the tab
      // strip is above it. The vertical clamp stays either way — the drop is
      // hit-tested from the finger, not from the card, so the card has no
      // reason to leave its column.
      modifiers={
        onDropOutside
          ? [restrictToVerticalAxis]
          : [restrictToVerticalAxis, restrictToParentElement]
      }
      autoScroll={!overDropZone}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => onCardDrag?.(null)}
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
  carryable,
  faded,
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
  carryable: boolean;
  faded: boolean;
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
    // 2000 keeps a carried card above the sticky tab strip (z 1000), which in
    // turn is above a merely raised card (999). The three are coupled.
    zIndex: isDragging ? 2000 : zIndex,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? (faded ? 0.45 : 0.85) : 1,
    // The card sits under the finger, so while it is being carried it must not
    // be what elementFromPoint answers with — see lib/boardTabDrop.ts. dnd-kit
    // tracks the pointer on the document once a drag is active, so giving the
    // card away costs the drag nothing.
    pointerEvents: carryable && isDragging ? 'none' : undefined,
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
          isActive ? 'opacity-100' : 'opacity-[0.85]',
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
            className="rounded-full bg-black/50 hover:bg-black/70 text-ink text-xs px-2.5 py-1"
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
            className="rounded-full bg-black/50 hover:bg-black/70 text-ink text-xs px-2.5 py-1"
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
