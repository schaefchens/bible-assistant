import type { Board } from '@/types/domain';
import { reorderInArray } from '@/utils/orderingUtils';

/** Pure board-membership operations on `board.cardIds`, each returning a new
 * Board (or the SAME reference when nothing changes, so callers can skip a
 * redundant persist). The store's upsertBoard bumps updatedAt + queues sync. */

export function reorderCardInBoard(board: Board, fromId: string, toId: string): Board {
  const cardIds = reorderInArray(board.cardIds, fromId, toId);
  return cardIds === board.cardIds ? board : { ...board, cardIds };
}

export function withCardInBoard(board: Board, cardId: string): Board {
  if (board.cardIds.includes(cardId)) return board;
  return { ...board, cardIds: [...board.cardIds, cardId] };
}

export function withoutCardInBoard(board: Board, cardId: string): Board {
  if (!board.cardIds.includes(cardId)) return board;
  const cardIds = board.cardIds.filter((id) => id !== cardId);
  if (!board.freeform || !(cardId in board.freeform)) return { ...board, cardIds };
  // Also drop the card's freeform placement so boards.json doesn't accumulate
  // stale layout entries.
  const { [cardId]: _drop, ...freeform } = board.freeform;
  return { ...board, cardIds, freeform };
}
