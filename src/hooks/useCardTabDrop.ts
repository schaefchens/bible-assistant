import { useCallback, useEffect, useRef, useState } from 'react';
import { tabDropAtPoint } from '@/lib/boardTabDrop';
import { withCardInBoard } from '@/lib/boardOperations';
import { useLibraryStore } from '@/store/libraryStore';
import type { Card } from '@/types/domain';

/** How long the target tab keeps its ring after a card lands on it. The list
 * itself doesn't change — the card stays in All cards — so without this the
 * only evidence of the drop is the tab's count ticking up under the finger. */
const FLASH_MS = 800;

/** A card being carried over the strip, for the tab styling. */
export type CardDragState = {
  /** The board tab under the finger, or null between tabs. */
  overBoardId: string | null;
  /** That board already holds this card, so the drop is a no-op. */
  already: boolean;
};

/**
 * Dragging a card from All cards onto a board's tab to add it to that board.
 *
 * The pointer is tracked here rather than read out of dnd-kit's drag events:
 * `activatorEvent + delta` is dnd-kit's *transform*, which carries scroll
 * compensation and so drifts from the finger exactly when the list scrolls
 * mid-drag. A `pointermove` listener cannot drift, and it covers mouse and
 * touch in one path.
 *
 * Boards are read through `getState()` instead of being taken as an argument on
 * purpose: the move handler has to be referentially stable, or the listener
 * added on drag start is not the one removed on drag end.
 */
export function useCardTabDrop() {
  const [cardDrag, setCardDrag] = useState<CardDragState | null>(null);
  const [overStrip, setOverStrip] = useState(false);
  const [flashBoardId, setFlashBoardId] = useState<string | null>(null);
  const draggedRef = useRef<Card | null>(null);
  const targetRef = useRef<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const card = draggedRef.current;
    if (!card) return;
    const hit = tabDropAtPoint(e.clientX, e.clientY);
    targetRef.current = hit.boardId;
    setOverStrip(hit.overStrip);
    const already = hit.boardId
      ? (useLibraryStore
          .getState()
          .boards.find((b) => b.id === hit.boardId)
          ?.cardIds.includes(card.id) ?? false)
      : false;
    setCardDrag((prev) =>
      prev && prev.overBoardId === hit.boardId && prev.already === already
        ? prev
        : { overBoardId: hit.boardId, already },
    );
  }, []);

  /** CardStack reports the card at drag start and null at drag end/cancel. */
  const onCardDrag = useCallback(
    (card: Card | null) => {
      if (card) {
        draggedRef.current = card;
        targetRef.current = null;
        setCardDrag({ overBoardId: null, already: false });
        window.addEventListener('pointermove', onPointerMove);
        return;
      }
      draggedRef.current = null;
      targetRef.current = null;
      setCardDrag(null);
      setOverStrip(false);
      window.removeEventListener('pointermove', onPointerMove);
    },
    [onPointerMove],
  );

  /** Offered the drop before the list reorders. Consumed only over a board tab
   * — a miss elsewhere on the strip falls through, because the sortable has
   * been showing the card at the top of the list the whole way up and
   * cancelling would contradict what the user is looking at. */
  const onDropOutside = useCallback((card: Card): boolean => {
    const boardId = targetRef.current;
    if (!boardId) return false;
    const board = useLibraryStore.getState().boards.find((b) => b.id === boardId);
    if (!board) return false;
    const next = withCardInBoard(board, card.id);
    // Same reference = already on the board. Still consumed: the user aimed at
    // a tab, and reordering the list instead would be a surprise.
    if (next !== board) void useLibraryStore.getState().upsertBoard(next);
    setFlashBoardId(boardId);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashBoardId(null), FLASH_MS);
    return true;
  }, []);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [onPointerMove],
  );

  return {
    /** → LibraryTabs */
    cardDrag,
    flashBoardId,
    /** → CardStack */
    onCardDrag,
    onDropOutside,
    overDropZone: overStrip,
  };
}
