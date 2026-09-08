import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardStack } from './CardStack';
import { TagFilterBar } from './TagFilterBar';
import type { Card } from '@/types/domain';

/**
 * The All-cards tab's body: every card there is, in `cardOrder`, filterable by
 * hashtag.
 *
 * Stack only, deliberately. Grid / pile / corkboard are `board.viewMode` — a
 * per-board field — and the corkboard's placements live in `board.freeform`,
 * so a pseudo-board has nowhere to keep either.
 *
 * `raisedId` is owned by the page rather than here: opening the editor swaps
 * this view out, and the card you just edited should still be the raised one
 * when you come back.
 */
export function AllCardsView({
  cards,
  cardOrder,
  raisedId,
  onRaisedIdChange,
  onEdit,
  onDelete,
  onReorder,
  onCardDrag,
  onDropOutside,
  overDropZone,
}: {
  cards: Card[];
  cardOrder: string[];
  raisedId: string | null;
  onRaisedIdChange: (id: string | null) => void;
  onEdit: (card: Card) => void;
  onDelete: (card: Card) => void;
  onReorder: (fromId: string, toId: string) => void;
  /** Carrying a card onto a board's tab — passed straight through to
   * CardStack, wired by the page's `useCardTabDrop`. */
  onCardDrag?: (card: Card | null) => void;
  onDropOutside?: (card: Card) => boolean;
  overDropZone?: boolean;
}) {
  const { t } = useTranslation();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [cards]);

  const visibleCards = useMemo(() => {
    const filtered = selectedTags.length
      ? cards.filter((c) => {
          const cardTags = c.tags ?? [];
          return selectedTags.some((tag) => cardTags.includes(tag));
        })
      : cards;
    const rank = new Map(cardOrder.map((id, i) => [id, i]));
    const unknownFallback = filtered.length + 1;
    return filtered.slice().sort((a, b) => {
      const ra = rank.get(a.id) ?? unknownFallback;
      const rb = rank.get(b.id) ?? unknownFallback;
      if (ra !== rb) return ra - rb;
      return b.updatedAt - a.updatedAt;
    });
  }, [cards, cardOrder, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  };

  return (
    <>
      <TagFilterBar
        allTags={allTags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
      />
      <CardStack
        cards={visibleCards}
        raisedId={raisedId}
        onRaisedIdChange={onRaisedIdChange}
        onEdit={onEdit}
        onDelete={onDelete}
        onReorder={onReorder}
        onCardDrag={onCardDrag}
        onDropOutside={onDropOutside}
        overDropZone={overDropZone}
        emptyLabel={
          selectedTags.length > 0 ? t('cards.noTagsMatch') : t('cards.empty')
        }
      />
    </>
  );
}
