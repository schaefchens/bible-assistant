import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { AddCardsModal } from '@/components/cards/AddCardsModal';
import { AllCardsView } from '@/components/cards/AllCardsView';
import { BoardCardsView } from '@/components/cards/BoardCardsView';
import { BoardViewToggle } from '@/components/cards/BoardViewToggle';
import { CardEditor } from '@/components/cards/CardEditor';
import { CenteredEmpty } from '@/components/cards/CenteredEmpty';
import { LibraryTabs, type BoardValues } from '@/components/cards/LibraryTabs';
import {
  reorderCardInBoard,
  withCardInBoard,
  withoutCardInBoard,
} from '@/lib/boardOperations';
import { ROUTES } from '@/lib/appRoutes';
import { useCardTabDrop } from '@/hooks/useCardTabDrop';
import { cssUrl } from '@/utils/cssUrl';
import type { Board, BoardViewMode, Card } from '@/types/domain';

/** Cap a board background URL length so a pasted multi-megabyte data: URI
 * can't bloat the synced board record (re-uploaded on every board edit and
 * every freeform layout commit). Empty/oversized → undefined (no background). */
const MAX_BG_URL = 2048;
function normalizeBackground(v?: string): string | undefined {
  const t = v?.trim();
  return t && t.length <= MAX_BG_URL ? t : undefined;
}

/**
 * The card library: every card, and every board, behind one tab strip.
 *
 * Cards and boards used to be two nav tabs with near-identical headers, which
 * meant two screens to hold the same objects and no way to get a card onto a
 * board without going through a modal. Here the leftmost tab is All cards and
 * the rest are the boards, so "which of my cards" is one selector.
 *
 * The selected tab **is** `libraryStore.activeBoardId`, whose `null` — already
 * a real, persisted state (absence of the preference row) — now means All
 * cards. Nothing in the store changed for that; what had to go is the effect
 * that force-selected `boards[0]` whenever the id was null, since that is what
 * made All cards unreachable while any board existed.
 */
export function CardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Two shapes reach this component: /cards/:cardId opens the editor, and
  // /boards/:boardId is the old Boards route, kept because a deep link
  // outlives the nav tab it came from. Distinct param names is what tells
  // them apart.
  const { cardId, boardId } = useParams<{ cardId?: string; boardId?: string }>();

  const cards = useLibraryStore((s) => s.cards);
  const cardOrder = useLibraryStore((s) => s.cardOrder);
  const boardsRaw = useLibraryStore((s) => s.boards);
  const boardOrder = useLibraryStore((s) => s.boardOrder);
  const activeBoardId = useLibraryStore((s) => s.activeBoardId);
  const initialized = useLibraryStore((s) => s.initialized);
  const setActiveBoardId = useLibraryStore((s) => s.setActiveBoardId);
  const deleteCard = useLibraryStore((s) => s.deleteCard);
  const reorderCards = useLibraryStore((s) => s.reorderCards);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const setCardLayout = useLibraryStore((s) => s.setCardLayout);
  const deleteBoard = useLibraryStore((s) => s.deleteBoard);
  const reorderBoards = useLibraryStore((s) => s.reorderBoards);

  const [draftCard, setDraftCard] = useState<Card | null>(null);
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  // Carrying a card from All cards onto a board's tab. It lives at page level
  // because the two halves of the gesture are in different subtrees: the list
  // reports the drag, the strip shows the targets.
  const tabDrop = useCardTabDrop();

  // Tab order follows the synced boardOrder; any board not in the order list
  // (e.g. just created) falls back to createdAt at the tail.
  const boards = useMemo(() => {
    const byId = new Map(boardsRaw.map((b) => [b.id, b]));
    const seen = new Set<string>();
    const ordered: Board[] = [];
    for (const id of boardOrder) {
      const b = byId.get(id);
      if (b && !seen.has(id)) {
        ordered.push(b);
        seen.add(id);
      }
    }
    const rest = boardsRaw
      .filter((b) => !seen.has(b.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    return [...ordered, ...rest];
  }, [boardsRaw, boardOrder]);

  // Deep-link: /boards/:id → select that board and rewrite the URL.
  useEffect(() => {
    if (!boardId) return;
    if (!initialized) return;
    if (boards.some((b) => b.id === boardId)) {
      void setActiveBoardId(boardId);
    }
    navigate(ROUTES.cards, { replace: true });
  }, [boardId, initialized, boards, navigate, setActiveBoardId]);

  const activeBoard: Board | undefined = useMemo(
    () => boards.find((b) => b.id === activeBoardId),
    [boards, activeBoardId],
  );
  // Derived from the board that actually exists, not from the raw id: a
  // persisted id whose board has since been deleted (on another device,
  // between a pull and this render) reads as All cards instead of as a blank
  // screen — which is also where deleteBoard and pullFromServer already land.
  const selection = activeBoard?.id ?? null;

  const boardCards: Card[] = useMemo(() => {
    if (!activeBoard) return [];
    const byId = new Map(cards.map((c) => [c.id, c]));
    return activeBoard.cardIds
      .map((cid) => byId.get(cid))
      .filter((c): c is Card => Boolean(c));
  }, [cards, activeBoard]);

  // Per-tab counts, resolved against the live cards: deleting a card leaves
  // its id behind in every board that held it, so cardIds.length overcounts.
  const boardCounts = useMemo(() => {
    const live = new Set(cards.map((c) => c.id));
    const out = new Map<string, number>();
    for (const b of boards) {
      let n = 0;
      for (const cid of b.cardIds) if (live.has(cid)) n += 1;
      out.set(b.id, n);
    }
    return out;
  }, [boards, cards]);

  const candidates = useMemo(() => {
    if (!activeBoard) return [];
    const inBoard = new Set(activeBoard.cardIds);
    return cards.filter((c) => !inBoard.has(c.id));
  }, [cards, activeBoard]);

  const editing = useMemo<Card | null>(() => {
    if (draftCard) return draftCard;
    if (cardId) return cards.find((c) => c.id === cardId) ?? null;
    return null;
  }, [draftCard, cardId, cards]);

  const handleEdit = useCallback(
    (c: Card) => {
      setRaisedId(c.id);
      navigate(`${ROUTES.cards}/${c.id}`);
    },
    [navigate],
  );

  const handleDelete = useCallback(
    (c: Card) => {
      if (!confirm(t('cards.confirmDelete'))) return;
      void deleteCard(c.id);
    },
    [deleteCard, t],
  );

  const openCard = useCallback(
    (c: Card) => navigate(`${ROUTES.cards}/${c.id}`),
    [navigate],
  );

  // Corkboard arrange/view mode. Lifted out of the board body so the toggle
  // can live in the header. Resets to view mode when the selection changes —
  // adjusted during render, not in an effect (set-state-in-effect is an error
  // here, and an effect would paint the stale mode for a frame first).
  const [freeformEditFor, setFreeformEditFor] = useState<string | null>(selection);
  const [freeformEdit, setFreeformEdit] = useState(false);
  if (freeformEditFor !== selection) {
    setFreeformEditFor(selection);
    setFreeformEdit(false);
  }

  if (editing) {
    const closeEditor = () => {
      if (draftCard) {
        setDraftCard(null);
        return;
      }
      if (cardId) navigate(-1);
    };
    return <CardEditor card={editing} onClose={closeEditor} />;
  }

  const newCard = () => {
    setDraftCard({
      id: nowId(),
      title: '',
      references: [],
      notes: '',
      tags: [],
      color: 'yellow',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const reorderInBoard = async (fromId: string, toId: string) => {
    if (!activeBoard) return;
    const next = reorderCardInBoard(activeBoard, fromId, toId);
    if (next === activeBoard) return;
    await upsertBoard(next);
  };

  const removeFromBoard = async (card: Card) => {
    if (!activeBoard) return;
    await upsertBoard(withoutCardInBoard(activeBoard, card.id));
  };

  const addCardToBoard = async (card: Card) => {
    if (!activeBoard) return;
    const next = withCardInBoard(activeBoard, card.id);
    if (next === activeBoard) return;
    await upsertBoard(next);
  };

  const createBoard = async (values: BoardValues) => {
    const trimmed = values.name.trim();
    if (!trimmed) return;
    const emoji = values.emoji?.trim() || undefined;
    const color = values.color && values.color !== 'none' ? values.color : undefined;
    const board: Board = {
      id: nowId(),
      name: trimmed,
      cardIds: [],
      color,
      emoji,
      background: normalizeBackground(values.background),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await upsertBoard(board);
    await setActiveBoardId(board.id);
  };

  const editBoard = async (values: BoardValues) => {
    if (!activeBoard) return;
    const trimmed = values.name.trim();
    if (!trimmed) return;
    const emoji = values.emoji?.trim() || undefined;
    const color = values.color && values.color !== 'none' ? values.color : undefined;
    await upsertBoard({
      ...activeBoard,
      name: trimmed,
      emoji,
      color,
      background: normalizeBackground(values.background),
    });
  };

  const removeBoard = async () => {
    if (!activeBoard) return;
    if (!confirm(t('boards.deleteConfirm'))) return;
    // deleteBoard clears activeBoardId, which lands on All cards.
    await deleteBoard(activeBoard.id);
  };

  const viewMode: BoardViewMode = activeBoard?.viewMode ?? 'grid';
  const setViewMode = async (mode: BoardViewMode) => {
    if (!activeBoard) return;
    if ((activeBoard.viewMode ?? 'grid') === mode) return;
    await upsertBoard({ ...activeBoard, viewMode: mode });
  };

  const toggleOrientation = async () => {
    if (!activeBoard) return;
    const next =
      (activeBoard.orientation ?? 'portrait') === 'portrait' ? 'landscape' : 'portrait';
    await upsertBoard({ ...activeBoard, orientation: next });
  };

  const boardHasCards = Boolean(activeBoard) && boardCards.length > 0;
  // Board background image. The corkboard paints it on its own A4 sheet
  // (FreeformBoard), so the page-level backdrop is only for the other views.
  // Full-brightness image (matching the corkboard sheet); the tab strip is
  // opaque instead of darkening the whole image, and cards are opaque. A
  // failed/empty image just falls back to the normal app background.
  const boardBg = activeBoard?.background?.trim();
  const pageStyle =
    boardBg && viewMode !== 'freeform'
      ? {
          backgroundImage: cssUrl(boardBg),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }
      : undefined;

  return (
    <div className="flex-1 overflow-y-auto pb-3 flex flex-col" style={pageStyle}>
      <LibraryTabs
        boards={boards}
        selection={selection}
        cardCount={cards.length}
        boardCounts={boardCounts}
        onSelect={setActiveBoardId}
        onNewCard={newCard}
        onCreate={createBoard}
        onEdit={editBoard}
        onDelete={removeBoard}
        onReorder={reorderBoards}
        onRequestAddCards={() => setAddPickerOpen(true)}
        showEditToggle={viewMode === 'freeform' && boardHasCards}
        editMode={freeformEdit}
        onToggleEditMode={() => setFreeformEdit((v) => !v)}
        orientation={activeBoard?.orientation}
        onToggleOrientation={() => void toggleOrientation()}
        cardDrag={tabDrop.cardDrag}
        flashBoardId={tabDrop.flashBoardId}
      />

      {activeBoard ? (
        boardCards.length === 0 ? (
          <CenteredEmpty
            text={t('boards.emptyBoard')}
            ctaLabel={t('boards.addCards')}
            onCta={() => setAddPickerOpen(true)}
            hint={t('boards.dragHint')}
          />
        ) : (
          <BoardCardsView
            key={activeBoard.id}
            board={activeBoard}
            cards={boardCards}
            editMode={freeformEdit}
            onOpen={openCard}
            onReorder={(fromId, toId) => void reorderInBoard(fromId, toId)}
            onRemove={(card) => void removeFromBoard(card)}
            onLayoutCommit={(cid, layout) =>
              void setCardLayout(activeBoard.id, cid, layout)
            }
          />
        )
      ) : cards.length === 0 ? (
        <CenteredEmpty text={t('cards.empty')} ctaLabel={t('cards.new')} onCta={newCard} />
      ) : (
        <AllCardsView
          cards={cards}
          cardOrder={cardOrder}
          raisedId={raisedId}
          onRaisedIdChange={setRaisedId}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReorder={reorderCards}
          onCardDrag={boards.length > 0 ? tabDrop.onCardDrag : undefined}
          onDropOutside={boards.length > 0 ? tabDrop.onDropOutside : undefined}
          overDropZone={tabDrop.overDropZone}
        />
      )}

      {boardHasCards && <BoardViewToggle mode={viewMode} onChange={setViewMode} />}

      {addPickerOpen && activeBoard && (
        <AddCardsModal
          candidates={candidates}
          emptyLabel={t('boards.noCardsLeft')}
          onAdd={addCardToBoard}
          onClose={() => setAddPickerOpen(false)}
        />
      )}
    </div>
  );
}
