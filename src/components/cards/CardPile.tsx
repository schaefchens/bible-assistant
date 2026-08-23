import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';
import { FlipCard } from './FlipCard';

type Props = {
  cards: Card[];
  emptyLabel?: string;
};

const TAP_MOVE_TOLERANCE_PX = 6;
const AXIS_LOCK_THRESHOLD_PX = 8;
const SWIPE_THRESHOLD_RATIO = 1 / 3;
const EXIT_MS = 220;
const SLOT_OFFSET_PX = 14;
const BRIGHTNESS_BY_SLOT = [1, 0.85, 0.7];

type Leaving = {
  card: Card;
  flipped: boolean;
  fromDx: number;
  toDx: number;
};

export function CardPile({ cards, emptyLabel }: Props) {
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
    return <p className="text-ink-muted italic px-4 py-6">{emptyLabel ?? '—'}</p>;
  }

  const len = cards.length;
  const top = cards[topIdx % len];

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
        // Hand the dragged card off to a separate overlay that flies off; the
        // pile keeps the remaining cards rendered with their `card.id` keys so
        // CSS transitions can carry each peek up to its new slot without jumps.
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

  // Build the list of cards visible in the pile. Each card keeps its identity
  // (key=card.id) so React reuses the same DOM node when it moves between
  // slots — CSS transitions on transform + filter handle the animation.
  // The leaving card is rendered in `LeavingOverlay` instead, so skip it here
  // (it would otherwise reappear in the back-most slot via wraparound during
  // the exit animation).
  const slots: { card: Card; slot: number }[] = [];
  for (let i = 0; i < Math.min(3, len); i++) {
    const card = cards[(topIdx + i) % len];
    if (leaving && card.id === leaving.card.id) continue;
    slots.push({ card, slot: i });
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 pb-24 select-none">
      <div
        className="relative w-full"
        style={{ maxWidth: 'min(80vw, 28rem)' }}
      >
        <div className="relative w-full" style={{ aspectRatio: '3 / 4' }}>
          {slots.map(({ card, slot }) => {
            const isTop = slot === 0;
            const baseY = slot * SLOT_OFFSET_PX;
            const brightness = BRIGHTNESS_BY_SLOT[slot] ?? 1;
            const transform =
              isTop && dragDx !== 0
                ? `translate3d(${dragDx}px, 0, 0) rotate(${dragDx * 0.05}deg)`
                : `translateY(${baseY}px)`;
            const transition =
              isTop && dragging
                ? 'none'
                : `transform ${EXIT_MS}ms ease-out, filter ${EXIT_MS}ms ease-out`;
            return (
              <div
                key={card.id}
                aria-hidden={!isTop}
                className={[
                  'absolute inset-0',
                  isTop ? 'touch-none' : 'pointer-events-none',
                ].join(' ')}
                style={{
                  transform,
                  transition,
                  filter: `brightness(${brightness})`,
                  zIndex: 3 - slot,
                  willChange: 'transform',
                }}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? endGesture : undefined}
                onPointerCancel={isTop ? endGesture : undefined}
              >
                <FlipCard
                  flipped={isTop ? flipped : false}
                  front={<CardFace card={card} size="full" isActive={isTop} />}
                  back={
                    <CardBack
                      card={card}
                      emptyLabel={t('cards.noNotes')}
                      isActive={isTop}
                    />
                  }
                />
              </div>
            );
          })}
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
