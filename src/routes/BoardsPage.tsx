import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { BoardGrid } from '@/components/cards/BoardGrid';
import { CardStack } from '@/components/cards/CardStack';
import { CardPile } from '@/components/cards/CardPile';
import { FreeformBoard } from '@/components/cards/freeform/FreeformBoard';
import { BoardViewToggle } from '@/components/cards/BoardViewToggle';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import { TabRow, type BoardValues } from '@/components/boards/TabRow';
import { AddCardsModal } from '@/components/boards/AddCardsModal';
import {
  reorderCardInBoard,
  withCardInBoard,
  withoutCardInBoard,
} from '@/lib/boardOperations';
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

export function BoardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();

  const boardsRaw = useLibraryStore((s) => s.boards);
  const boardOrder = useLibraryStore((s) => s.boardOrder);
  const cards = useLibraryStore((s) => s.cards);
  const activeBoardId = useLibraryStore((s) => s.activeBoardId);
  const setActiveBoardId = useLibraryStore((s) => s.setActiveBoardId);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const setCardLayout = useLibraryStore((s) => s.setCardLayout);
  const deleteBoard = useLibraryStore((s) => s.deleteBoard);
  const reorderBoards = useLibraryStore((s) => s.reorderBoards);
  const initialized = useLibraryStore((s) => s.initialized);

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

  // Deep-link: /boards/:id → set active and rewrite URL to /boards.
  useEffect(() => {
    if (!routeId) return;
    if (!initialized) return;
    if (boards.some((b) => b.id === routeId)) {
      void setActiveBoardId(routeId);
    }
    navigate('/boards', { replace: true });
  }, [routeId, initialized, boards, navigate, setActiveBoardId]);

  // Fallback: if no active board (or stale id), pick the first one.
  useEffect(() => {
    if (!initialized) return;
    if (boards.length === 0) {
      if (activeBoardId !== null) void setActiveBoardId(null);
      return;
    }
    if (!activeBoardId || !boards.some((b) => b.id === activeBoardId)) {
      void setActiveBoardId(boards[0].id);
    }
  }, [initialized, boards, activeBoardId, setActiveBoardId]);

  const activeBoard: Board | undefined = useMemo(
    () => boards.find((b) => b.id === activeBoardId),
    [boards, activeBoardId],
  );

  const boardCards: Card[] = useMemo(() => {
    if (!activeBoard) return [];
    const byId = new Map(cards.map((c) => [c.id, c]));
    return activeBoard.cardIds
      .map((cid) => byId.get(cid))
      .filter((c): c is Card => Boolean(c));
  }, [cards, activeBoard]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of boardCards) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [boardCards]);

  // Reset tag filter when the active board changes — React's in-render
  // reset pattern (https://react.dev/learn/you-might-not-need-an-effect).
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Corkboard arrange/view mode. Lifted here so the toggle can live in the
  // header (TabRow). Resets to view mode when the active board changes.
  const [freeformEdit, setFreeformEdit] = useState(false);
  const [tagsBoardId, setTagsBoardId] = useState<string | null>(activeBoardId);
  if (tagsBoardId !== activeBoardId) {
    setTagsBoardId(activeBoardId);
    setSelectedTags([]);
    setFreeformEdit(false);
  }

  const visibleCards = useMemo(() => {
    if (selectedTags.length === 0) return boardCards;
    return boardCards.filter((c) => {
      const ct = c.tags ?? [];
      return selectedTags.some((t) => ct.includes(t));
    });
  }, [boardCards, selectedTags]);

  const candidates = useMemo(() => {
    if (!activeBoard) return [];
    const inBoard = new Set(activeBoard.cardIds);
    return cards.filter((c) => !inBoard.has(c.id));
  }, [cards, activeBoard]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
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
    await deleteBoard(activeBoard.id);
  };

  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const boardHasNoCards = Boolean(activeBoard) && boardCards.length === 0;
  const showBoardEmptyCta = boardHasNoCards && selectedTags.length === 0;
  const emptyGridLabel =
    selectedTags.length > 0 ? t('cards.noTagsMatch') : '—';

  const viewMode: BoardViewMode = activeBoard?.viewMode ?? 'grid';
  const setViewMode = async (mode: BoardViewMode) => {
    if (!activeBoard) return;
    if ((activeBoard.viewMode ?? 'grid') === mode) return;
    await upsertBoard({ ...activeBoard, viewMode: mode });
  };
  const openCard = (c: Card) => navigate(`/cards/${c.id}`);
  const showViewToggle = Boolean(activeBoard) && !showBoardEmptyCta;
  // Board background image. The corkboard paints it on its own A4 sheet
  // (FreeformBoard), so the page-level backdrop is only for the other views.
  const boardBg = activeBoard?.background?.trim();
  // Full-brightness image (matching the corkboard sheet); the header/filter
  // chrome is frosted instead of darkening the whole image, and cards are
  // opaque. A failed/empty image just falls back to the normal app background.
  const showPageBg = Boolean(boardBg) && viewMode !== 'freeform';
  const pageStyle = showPageBg
    ? {
        backgroundImage: cssUrl(boardBg as string),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : undefined;
  const toggleOrientation = async () => {
    if (!activeBoard) return;
    const next = (activeBoard.orientation ?? 'portrait') === 'portrait' ? 'landscape' : 'portrait';
    await upsertBoard({ ...activeBoard, orientation: next });
  };

  return (
    <div className="flex-1 overflow-y-auto pb-3 flex flex-col" style={pageStyle}>
      <TabRow
        boards={boards}
        activeBoardId={activeBoard?.id ?? null}
        onSelect={setActiveBoardId}
        onCreate={createBoard}
        onEdit={editBoard}
        onDelete={removeBoard}
        onReorder={reorderBoards}
        onRequestAddCards={() => setAddPickerOpen(true)}
        showEditToggle={viewMode === 'freeform' && !showBoardEmptyCta}
        editMode={freeformEdit}
        onToggleEditMode={() => setFreeformEdit((v) => !v)}
        orientation={activeBoard?.orientation}
        onToggleOrientation={() => void toggleOrientation()}
        solidBackdrop={showPageBg}
      />

      {boards.length === 0 ? (
        <EmptyState onCreate={createBoard} />
      ) : activeBoard ? (
        showBoardEmptyCta ? (
          <CenteredEmpty
            text={t('boards.emptyBoard')}
            ctaLabel={t('boards.addCards')}
            onCta={() => setAddPickerOpen(true)}
          />
        ) : viewMode === 'freeform' ? (
          <FreeformBoard
            key={activeBoard.id}
            board={activeBoard}
            cards={boardCards}
            editMode={freeformEdit}
            onOpen={openCard}
            onLayoutCommit={(cardId, layout) =>
              void setCardLayout(activeBoard.id, cardId, layout)
            }
          />
        ) : (
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
                onOpen={openCard}
                onReorder={reorderInBoard}
                onRemove={removeFromBoard}
                emptyLabel={emptyGridLabel}
              />
            )}
            {viewMode === 'stack' && (
              <CardStack
                cards={visibleCards}
                onEdit={openCard}
                onDelete={removeFromBoard}
                onReorder={reorderInBoard}
                emptyLabel={emptyGridLabel}
              />
            )}
            {viewMode === 'pile' && (
              <CardPile cards={visibleCards} emptyLabel={emptyGridLabel} />
            )}
          </>
        )
      ) : null}

      {showViewToggle && (
        <BoardViewToggle mode={viewMode} onChange={setViewMode} />
      )}

      {addPickerOpen && (
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

function CenteredEmpty({
  text,
  ctaLabel,
  onCta,
}: {
  text: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="text-cream-dim max-w-xs">{text}</p>
      <button
        onClick={onCta}
        className="btn-primary text-base px-6 py-3 rounded-xl"
      >
        + {ctaLabel}
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: (values: BoardValues) => Promise<void> }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const submit = () => void onCreate({ name }).then(() => setName(''));
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="text-cream-dim max-w-xs">{t('boards.noBoards')}</p>
      {creating ? (
        <div className="flex gap-2 w-full max-w-sm">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') setCreating(false);
            }}
            placeholder={t('boards.boardName') as string}
            className="flex-1 bg-navy rounded-xl px-3 py-2 text-cream outline-none focus:ring-2 focus:ring-gold/60"
          />
          <button className="btn-primary text-sm" onClick={submit}>
            {t('boards.save')}
          </button>
        </div>
      ) : (
        <button
          className="btn-primary text-base px-6 py-3 rounded-xl"
          onClick={() => setCreating(true)}
        >
          + {t('boards.createFirst')}
        </button>
      )}
    </div>
  );
}
