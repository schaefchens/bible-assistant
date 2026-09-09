import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardGrid } from './BoardGrid';
import { CardPile } from './CardPile';
import { CardStack } from './CardStack';
import { TagFilterBar } from './TagFilterBar';
import { FreeformBoard } from './freeform/FreeformBoard';
import type { Board, Card, FreeformCardLayout } from '@/types/domain';

/**
 * One board's body, in whichever of the four views that board is set to.
 *
 * The tag filter is state here rather than in the page, so the page can drop
 * it by remounting on a board switch (`key={board.id}`) instead of resetting
 * it during render. The corkboard's arrange toggle can't do the same — it is
 * drawn in the header — so that one stays lifted.
 */
export function BoardCardsView({
  board,
  cards,
  editMode,
  onOpen,
  onReorder,
  onRemove,
  onLayoutCommit,
}: {
  board: Board;
  /** The board's cards, already resolved against the live card list. */
  cards: Card[];
  editMode: boolean;
  onOpen: (card: Card) => void;
  /**
   * The three mutating paths, all optional together.
   *
   * A shared board omits them, which is what makes it read-only *by
   * construction* rather than by a set of guards somebody has to keep right:
   * the sortable is not armed, the remove control is not rendered, and the
   * corkboard has nothing to commit. Passing no-ops instead would leave every
   * gesture live and only the outcome missing.
   */
  onReorder?: (fromId: string, toId: string) => void;
  onRemove?: (card: Card) => void;
  onLayoutCommit?: (cardId: string, layout: FreeformCardLayout) => void;
}) {
  const { t } = useTranslation();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const viewMode = board.viewMode ?? 'grid';

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [cards]);

  const visibleCards = useMemo(() => {
    if (selectedTags.length === 0) return cards;
    return cards.filter((c) => {
      const ct = c.tags ?? [];
      return selectedTags.some((tag) => ct.includes(tag));
    });
  }, [cards, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  };

  if (viewMode === 'freeform') {
    return (
      <FreeformBoard
        key={board.id}
        board={board}
        cards={cards}
        // Arranging is a mutation, so a board with nowhere to commit to is
        // never in edit mode however the caller was rendered.
        editMode={editMode && onLayoutCommit !== undefined}
        onOpen={onOpen}
        onLayoutCommit={onLayoutCommit}
      />
    );
  }

  const emptyLabel = selectedTags.length > 0 ? t('cards.noTagsMatch') : '—';

  return (
    <>
      <TagFilterBar
        allTags={allTags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
      />
      {viewMode === 'grid' && (
        <BoardGrid
          cards={visibleCards}
          onOpen={onOpen}
          onReorder={onReorder}
          onRemove={onRemove}
          emptyLabel={emptyLabel}
        />
      )}
      {viewMode === 'stack' && (
        <CardStack
          cards={visibleCards}
          onEdit={onOpen}
          onDelete={onRemove}
          onReorder={onReorder}
          emptyLabel={emptyLabel}
        />
      )}
      {viewMode === 'pile' && <CardPile cards={visibleCards} emptyLabel={emptyLabel} />}
    </>
  );
}
