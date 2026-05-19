import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@/types/domain';
import { CardFace } from './CardFace';
import { CardBack } from './CardBack';

type Props = {
  cards: Card[];
  onEdit: (card: Card) => void;
  emptyLabel?: string;
};

const PEEK_PX = 96;

export function CardStack({ cards, onEdit, emptyLabel }: Props) {
  const { t } = useTranslation();
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const raisedRef = useRef<HTMLDivElement | null>(null);
  const [raisedHeight, setRaisedHeight] = useState<number>(0);

  useEffect(() => {
    if (!raisedId) return;
    const el = raisedRef.current;
    if (!el) return;
    const update = () => setRaisedHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [raisedId, flippedId, cards]);

  if (cards.length === 0) {
    return <p className="text-cream-dim italic px-4 py-6">{emptyLabel ?? '—'}</p>;
  }

  const lastIdx = cards.length - 1;
  const raisedIdx = cards.findIndex((c) => c.id === raisedId);
  const minContainerHeight =
    raisedIdx >= 0 ? raisedIdx * PEEK_PX + raisedHeight + 48 : undefined;

  const toggleRaise = (id: string) => {
    setFlippedId(null);
    setRaisedId((cur) => (cur === id ? null : id));
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
        const z = isRaised ? 999 : idx + 1;

        return (
          <div
            key={card.id}
            className="relative w-full"
            style={{
              height: isLast ? undefined : PEEK_PX,
              zIndex: z,
            }}
          >
            <div
              ref={isRaised ? raisedRef : null}
              className={isLast ? 'relative' : 'absolute top-0 left-0 right-0'}
            >
              <button
                type="button"
                onClick={() => toggleRaise(card.id)}
                className="block w-full text-left focus:outline-none rounded-2xl"
              >
                {isFlipped ? (
                  <CardBack card={card} emptyLabel={t('cards.noNotes')} />
                ) : (
                  <CardFace card={card} size="full" />
                )}
              </button>

              <div className="absolute top-2 right-2 flex gap-2" style={{ zIndex: 1100 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFlip(card.id);
                  }}
                  className="rounded-full bg-black/30 hover:bg-black/50 text-cream text-xs px-2.5 py-1 backdrop-blur-sm"
                >
                  {isFlipped ? t('cards.front') : t('cards.flip')}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(card);
                  }}
                  className="rounded-full bg-black/30 hover:bg-black/50 text-cream text-xs px-2.5 py-1 backdrop-blur-sm"
                  aria-label={t('cards.edit') as string}
                >
                  ✎
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
