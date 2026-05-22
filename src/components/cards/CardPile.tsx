import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';
import { FlipCard } from './FlipCard';

type Props = {
  cards: Card[];
  onEdit: (card: Card) => void;
  emptyLabel?: string;
};

const TAP_MOVE_TOLERANCE_PX = 6;
const AXIS_LOCK_THRESHOLD_PX = 8;
const SWIPE_THRESHOLD_RATIO = 1 / 3;
const EXIT_MS = 220;

export function CardPile({ cards, onEdit, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [topIdx, setTopIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leavingDx, setLeavingDx] = useState<number | null>(null);

  // Reset transient state when the deck reference changes (board switch,
  // cards added/removed). In-render reset pattern matches the codebase
  // convention (see BoardsPage tag-filter reset).
  const [deckRef, setDeckRef] = useState(cards);
  if (deckRef !== cards) {
    setDeckRef(cards);
    setFlipped(false);
    setDragDx(0);
    setDragging(false);
    setLeavingDx(null);
    setTopIdx((i) => (cards.length === 0 ? 0 : i % cards.length));
  }

  const gestureRef = useRef<{
    startX: number;
    startY: number;
    lockedAxis: 'x' | 'y' | null;
    pointerId: number;
  } | null>(null);

  if (cards.length === 0) {
    return <p className="text-cream-dim italic px-4 py-6">{emptyLabel ?? '—'}</p>;
  }

  const len = cards.length;
  const top = cards[topIdx % len];
  const next = len > 1 ? cards[(topIdx + 1) % len] : null;
  const nextNext = len > 2 ? cards[(topIdx + 2) % len] : null;

  const cycle = () => {
    setTopIdx((i) => (i + 1) % len);
    setFlipped(false);
    setLeavingDx(null);
    setDragDx(0);
    setDragging(false);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leavingDx !== null) return;
    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lockedAxis: null,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.lockedAxis) {
      if (Math.hypot(dx, dy) < AXIS_LOCK_THRESHOLD_PX) return;
      g.lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.lockedAxis === 'x') setDragging(true);
    }
    if (g.lockedAxis === 'x') {
      e.preventDefault();
      setDragDx(dx);
    }
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const moved = Math.hypot(dx, dy);
    gestureRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    if (g.lockedAxis === 'x') {
      const threshold = window.innerWidth * SWIPE_THRESHOLD_RATIO;
      if (Math.abs(dx) > threshold) {
        const exit = Math.sign(dx) * (window.innerWidth + 400);
        setDragging(false);
        setLeavingDx(exit);
        return;
      }
      setDragging(false);
      setDragDx(0);
      return;
    }
    if (g.lockedAxis === null && moved < TAP_MOVE_TOLERANCE_PX) {
      setFlipped((f) => !f);
    }
    setDragging(false);
    setDragDx(0);
  };

  const topTransform = (() => {
    if (leavingDx !== null) {
      const rot = Math.sign(leavingDx) * 18;
      return `translate3d(${leavingDx}px, 0, 0) rotate(${rot}deg)`;
    }
    if (dragDx !== 0) {
      const rot = dragDx * 0.05;
      return `translate3d(${dragDx}px, 0, 0) rotate(${rot}deg)`;
    }
    return undefined;
  })();

  const topTransition = (() => {
    if (leavingDx !== null) return `transform ${EXIT_MS}ms ease-in`;
    if (dragging) return 'none';
    return 'transform 180ms ease-out';
  })();

  const flipLabel = t(flipped ? 'cards.front' : 'cards.flip') as string;
  const editLabel = t('cards.edit') as string;

  return (
    <div className="flex-1 flex items-center justify-center px-4 pb-24 select-none">
      <div
        className="relative w-full"
        style={{
          maxWidth: 'min(80vw, 28rem)',
        }}
      >
        <div className="relative w-full" style={{ aspectRatio: '3 / 4' }}>
          {nextNext && (
            <PileLayer card={nextNext} depth={2} />
          )}
          {next && <PileLayer card={next} depth={1} />}
          <div
            className="absolute inset-0 touch-none"
            style={{
              transform: topTransform,
              transition: topTransition,
              willChange: 'transform',
              zIndex: 3,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onTransitionEnd={(e) => {
              if (e.propertyName === 'transform' && leavingDx !== null) {
                cycle();
              }
            }}
          >
            <FlipCard
              flipped={flipped}
              front={<CardFace card={top} size="full" isActive />}
              back={<CardBack card={top} emptyLabel={t('cards.noNotes')} isActive />}
            />
            <div
              className="absolute top-2 right-2 flex gap-2"
              style={{ zIndex: 1100 }}
            >
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped((f) => !f);
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
                  onEdit(top);
                }}
                className="rounded-full bg-black/50 hover:bg-black/70 text-cream text-xs px-2.5 py-1"
                aria-label={editLabel}
              >
                ✎
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PileLayer({ card, depth }: { card: Card; depth: 1 | 2 }) {
  // Pure translateY so the peek shows as a clean band below the top card.
  // Scaling pulled the bottom edge back inside the parent box, defeating the
  // stack illusion — translateY without scale makes each layer's bottom poke
  // out exactly `offsetY` pixels below the one in front.
  const offsetY = depth === 1 ? 14 : 28;
  const opacity = depth === 1 ? 0.85 : 0.65;
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `translateY(${offsetY}px)`,
        opacity,
        zIndex: 3 - depth,
      }}
    >
      <CardFace card={card} size="full" />
    </div>
  );
}
