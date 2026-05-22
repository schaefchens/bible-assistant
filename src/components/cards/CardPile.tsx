import { useEffect, useRef, useState } from 'react';
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

type Leaving = {
  card: Card;
  flipped: boolean;
  fromDx: number;
  toDx: number;
};

export function CardPile({ cards, onEdit, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [topIdx, setTopIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);

  // Reset transient state when the deck reference changes (board switch,
  // cards added/removed). In-render reset pattern matches the codebase
  // convention (see BoardsPage tag-filter reset).
  const [deckRef, setDeckRef] = useState(cards);
  if (deckRef !== cards) {
    setDeckRef(cards);
    setFlipped(false);
    setDragDx(0);
    setDragging(false);
    setLeaving(null);
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leaving) return;
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
        // Hand the dragged card off to a separate overlay that will animate
        // off-screen, and advance to the next card immediately so the new
        // top is already in place — no snap-back glitch.
        setLeaving({
          card: top,
          flipped,
          fromDx: dx,
          toDx: Math.sign(dx) * (window.innerWidth + 400),
        });
        setTopIdx((i) => (i + 1) % len);
        setFlipped(false);
        setDragDx(0);
        setDragging(false);
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

  const topTransform = dragDx !== 0
    ? `translate3d(${dragDx}px, 0, 0) rotate(${dragDx * 0.05}deg)`
    : undefined;
  const topTransition = dragging ? 'none' : 'transform 180ms ease-out';

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
          {nextNext && <PileLayer card={nextNext} depth={2} />}
          {next && <PileLayer card={next} depth={1} />}
          {/* key={topIdx}: mount a fresh div for each new top card so the
              previous drag transform doesn't transition back to center on
              the new card. */}
          <div
            key={topIdx}
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
          {leaving && (
            <LeavingOverlay
              key={`${leaving.card.id}-${leaving.toDx}`}
              leaving={leaving}
              emptyLabel={t('cards.noNotes')}
              onDone={() => setLeaving(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LeavingOverlay({
  leaving,
  emptyLabel,
  onDone,
}: {
  leaving: Leaving;
  emptyLabel: string;
  onDone: () => void;
}) {
  // Render at fromDx with no transition first, then on the next frame switch
  // to toDx so the browser sees the change and animates between them.
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase('exit'));
    return () => cancelAnimationFrame(id);
  }, []);
  const dx = phase === 'enter' ? leaving.fromDx : leaving.toDx;
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 4,
        transform: `translate3d(${dx}px, 0, 0) rotate(${dx * 0.05}deg)`,
        transition:
          phase === 'enter' ? 'none' : `transform ${EXIT_MS}ms ease-in`,
        willChange: 'transform',
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'transform' && phase === 'exit') onDone();
      }}
    >
      <FlipCard
        flipped={leaving.flipped}
        front={<CardFace card={leaving.card} size="full" isActive />}
        back={<CardBack card={leaving.card} emptyLabel={emptyLabel} isActive />}
      />
    </div>
  );
}

function PileLayer({ card, depth }: { card: Card; depth: 1 | 2 }) {
  // Pure translateY so the peek shows as a clean band below the top card.
  // Scaling pulled the bottom edge back inside the parent box, defeating the
  // stack illusion — translateY without scale makes each layer's bottom poke
  // out exactly `offsetY` pixels below the one in front.
  // `filter: brightness` dims the peek to suggest depth without making it
  // translucent — opacity < 1 would let the layer behind bleed through when
  // the top card swipes away.
  const offsetY = depth === 1 ? 14 : 28;
  const brightness = depth === 1 ? 0.85 : 0.7;
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `translateY(${offsetY}px)`,
        filter: `brightness(${brightness})`,
        zIndex: 3 - depth,
      }}
    >
      <CardFace card={card} size="full" />
    </div>
  );
}
