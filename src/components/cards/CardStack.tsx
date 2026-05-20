import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';

type Props = {
  cards: Card[];
  onEdit: (card: Card) => void;
  onDelete: (card: Card) => void;
  raisedId?: string | null;
  onRaisedIdChange?: (id: string | null) => void;
  emptyLabel?: string;
};

const PEEK_PX = 96;
const PEEK_JITTER_PX = 10;
const X_JITTER_PX = 10;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;

export function CardStack({
  cards,
  onEdit,
  onDelete,
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

  // Deterministic per-card jitter so positions are stable across renders.
  const jitters = useMemo(
    () =>
      cards.map((card) => ({
        x: jitter(card.id, 'x', X_JITTER_PX),
        peek: jitter(card.id, 'y', PEEK_JITTER_PX),
      })),
    [cards],
  );

  // Per-card peek heights (last card consumes its own intrinsic height).
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
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return () => ro.disconnect();
  }, [raisedId, flippedId, cards]);

  // Keyboard control over the active card.
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
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  return (
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
            wrapperRef={(el) => {
              if (el) itemRefs.current.set(card.id, el);
              else itemRefs.current.delete(card.id);
            }}
            onTap={() => toggleRaise(card.id)}
            onLongPress={() => onEdit(card)}
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
  wrapperRef,
  onTap,
  onLongPress,
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
  raisedRef: React.RefObject<HTMLDivElement> | null;
  wrapperRef: (el: HTMLDivElement | null) => void;
  onTap: () => void;
  onLongPress: () => void;
  onFlip: () => void;
  onEditClick: () => void;
  flipLabel: string;
  editLabel: string;
  noNotesLabel: string;
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

  const clip = !isLast && !isRaised;

  return (
    <div
      ref={wrapperRef}
      className={[
        'relative w-full',
        clip ? 'overflow-hidden rounded-2xl' : '',
      ].join(' ')}
      style={{ height: wrapperHeight, zIndex }}
    >
      <div
        ref={raisedRef}
        className={[
          isLast ? 'relative' : 'absolute top-0 left-0 right-0',
          'transition-opacity duration-200',
          isActive ? 'opacity-100' : 'opacity-80',
        ].join(' ')}
        style={{ transform: `translateX(${translateX}px)` }}
      >
        <div
          role="button"
          tabIndex={0}
          className="block w-full text-left cursor-pointer rounded-2xl select-none focus:outline-none"
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            startRef.current = { x: e.clientX, y: e.clientY };
            didLongPress.current = false;
            clearTimer();
            timerRef.current = setTimeout(() => {
              didLongPress.current = true;
              onLongPress();
            }, LONG_PRESS_MS);
          }}
          onPointerMove={(e) => {
            if (!startRef.current) return;
            const dx = e.clientX - startRef.current.x;
            const dy = e.clientY - startRef.current.y;
            if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) clearTimer();
          }}
          onPointerUp={() => {
            clearTimer();
            if (!didLongPress.current) onTap();
            startRef.current = null;
          }}
          onPointerCancel={() => {
            clearTimer();
            startRef.current = null;
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTap();
            }
          }}
        >
          <div className="grid">
            <div
              className="row-start-1 col-start-1"
              style={{ visibility: isFlipped ? 'hidden' : 'visible' }}
              aria-hidden={isFlipped}
            >
              <CardFace card={card} size="full" />
            </div>
            <div
              className="row-start-1 col-start-1"
              style={{ visibility: isFlipped ? 'visible' : 'hidden' }}
              aria-hidden={!isFlipped}
            >
              <CardBack card={card} emptyLabel={noNotesLabel} />
            </div>
          </div>
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
            className="rounded-full bg-black/30 hover:bg-black/50 text-cream text-xs px-2.5 py-1 backdrop-blur-sm"
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
            className="rounded-full bg-black/30 hover:bg-black/50 text-cream text-xs px-2.5 py-1 backdrop-blur-sm"
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
