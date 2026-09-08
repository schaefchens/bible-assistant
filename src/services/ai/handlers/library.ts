import { withoutCardInBoard } from '@/lib/boardOperations';
import { autoPlaceCard } from '@/lib/freeformLayout';
import { clamp, clamp01 } from '@/lib/math';
import { parseCardReferenceLine } from '@/services/bible/cardReference';
import {
  listCardsInUserOrder,
  resolveBoard,
  resolveCard,
} from '@/services/library/cardResolver';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import {
  TEXT_SCALE_MIN,
  TEXT_SCALE_MAX,
  type Board,
  type Card,
  type FreeformCardLayout,
} from '@/types/domain';
import type { ToolArgs } from '../tools';
import type { ToolDispatchResult } from '../toolResult';

/** The card and board tools: verse notes, and the boards that group them. */

export function listCards(): ToolDispatchResult {
  return { ok: true, data: listCardsInUserOrder() };
}

export function listBoards(): ToolDispatchResult {
  return { ok: true, data: useLibraryStore.getState().boards };
}

/** Clamp an AI-supplied text scale to the card's allowed range. */
function clampTextScale(v: number): number {
  return clamp(v, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
}

export async function handleCreateCard(args: ToolArgs['create_card']): Promise<ToolDispatchResult> {
  const requestedBoards = args.boards ?? [];
  const resolvedBoards: Board[] = [];
  for (const ref of requestedBoards) {
    const board = resolveBoard(ref);
    if (!board) return { ok: false, error: `board "${ref}" not found` };
    resolvedBoards.push(board);
  }
  const card: Card = {
    id: nowId(),
    title: args.title,
    references: args.references.map(parseCardReferenceLine),
    notes: args.notes,
    color: 'yellow',
    textScale: args.textScale !== undefined ? clampTextScale(args.textScale) : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCard(card);
  for (const board of resolvedBoards) {
    if (board.cardIds.includes(card.id)) continue;
    const fresh = useLibraryStore.getState().boards.find((b) => b.id === board.id) ?? board;
    await useLibraryStore
      .getState()
      .upsertBoard({ ...fresh, cardIds: [...fresh.cardIds, card.id] });
  }
  return {
    ok: true,
    data: {
      id: card.id,
      title: card.title,
      addedToBoards: resolvedBoards.map((b) => ({ id: b.id, name: b.name })),
    },
  };
}

export async function handleReorderCards(
  args: ToolArgs['reorder_cards'],
): Promise<ToolDispatchResult> {
  if (!Array.isArray(args.order)) return { ok: false, error: 'order must be an array' };
  const knownIds = new Set(useLibraryStore.getState().cards.map((c) => c.id));
  const unknown = args.order.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown card ids: ${unknown.join(', ')}` };
  }
  await useLibraryStore.getState().setCardOrder(args.order);
  return { ok: true, data: { order: useLibraryStore.getState().cardOrder } };
}

export async function handleUpdateCard(args: ToolArgs['update_card']): Promise<ToolDispatchResult> {
  const lookup = resolveCard(args.card);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const updated: Card = {
    ...lookup.card,
    title: args.title ?? lookup.card.title,
    references: args.references
      ? args.references.map(parseCardReferenceLine)
      : lookup.card.references,
    notes: args.notes ?? lookup.card.notes,
    textScale:
      args.textScale !== undefined ? clampTextScale(args.textScale) : lookup.card.textScale,
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCard(updated);
  return { ok: true, data: { id: updated.id, title: updated.title } };
}

export async function handleDeleteCard(args: ToolArgs['delete_card']): Promise<ToolDispatchResult> {
  const lookup = resolveCard(args.card);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  await useLibraryStore.getState().deleteCard(lookup.card.id);
  return { ok: true, data: { id: lookup.card.id, title: lookup.card.title } };
}

export async function handleCreateBoard(args: ToolArgs['create_board']): Promise<ToolDispatchResult> {
  const board: Board = {
    id: nowId(),
    name: args.name,
    cardIds: args.cardIds ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertBoard(board);
  return { ok: true, data: { id: board.id, name: board.name } };
}

export async function handleDeleteBoard(args: ToolArgs['delete_board']): Promise<ToolDispatchResult> {
  await useLibraryStore.getState().deleteBoard(args.id);
  return { ok: true };
}

export async function handleAddCardToBoard(
  args: ToolArgs['add_card_to_board'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  if (board.cardIds.includes(cardId)) {
    return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, unchanged: true } };
  }
  await useLibraryStore
    .getState()
    .upsertBoard({ ...board, cardIds: [...board.cardIds, cardId] });
  return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, cardTitle: cardLookup.card.title } };
}

export async function handleRemoveCardFromBoard(
  args: ToolArgs['remove_card_from_board'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  if (!board.cardIds.includes(cardId)) {
    return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, unchanged: true } };
  }
  await useLibraryStore.getState().upsertBoard(withoutCardInBoard(board, cardId));
  return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, cardTitle: cardLookup.card.title } };
}

export async function handleArrangeCard(
  args: ToolArgs['arrange_card'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  // Spatial only — never alters membership. The card must already be on the board.
  if (!board.cardIds.includes(cardId)) {
    return {
      ok: false,
      error: `card "${cardLookup.card.title}" is not on board "${board.name}" — add it first with add_card_to_board`,
    };
  }
  // Base on the existing placement, or the deterministic auto-placement, so a
  // partial call (e.g. rotation only) leaves the other fields sensible.
  const base: FreeformCardLayout =
    board.freeform?.[cardId] ?? autoPlaceCard(cardId, board.cardIds.indexOf(cardId));
  const next: FreeformCardLayout = {
    x: args.x !== undefined ? clamp01(args.x) : base.x,
    y: args.y !== undefined ? clamp01(args.y) : base.y,
    w: args.width !== undefined ? clamp01(args.width) : base.w,
    h: args.height !== undefined ? clamp01(args.height) : base.h,
    rotation: args.rotation !== undefined ? args.rotation : base.rotation,
    z: base.z,
  };
  await useLibraryStore.getState().setCardLayout(board.id, cardId, next);
  return {
    ok: true,
    data: {
      boardId: board.id,
      boardName: board.name,
      cardId,
      cardTitle: cardLookup.card.title,
      layout: next,
    },
  };
}
