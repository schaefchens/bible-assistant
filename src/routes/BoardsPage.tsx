import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCardReferenceHeading } from '@/services/bible/cardReference';
import { BoardGrid } from '@/components/cards/BoardGrid';
import { CardStack } from '@/components/cards/CardStack';
import { CardPile } from '@/components/cards/CardPile';
import { BoardViewToggle } from '@/components/cards/BoardViewToggle';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import { boardTabClasses, colorClasses } from '@/components/cards/cardColors';
import type { Board, BoardViewMode, Card, CardColor } from '@/types/domain';
import { CARD_COLORS } from '@/types/domain';

const TAB_LONG_PRESS_MS = 500;
const TAB_MOVE_TOLERANCE_PX = 6;
const TAB_DRAG_MOVE_THRESHOLD_PX = 8;

type MenuMode = null | 'root' | 'new' | 'rename';

type BoardValues = { name: string; emoji?: string; color?: CardColor };

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
  const [tagsBoardId, setTagsBoardId] = useState<string | null>(activeBoardId);
  if (tagsBoardId !== activeBoardId) {
    setTagsBoardId(activeBoardId);
    setSelectedTags([]);
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
    const order = activeBoard.cardIds;
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = order.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await upsertBoard({ ...activeBoard, cardIds: next });
  };

  const removeFromBoard = async (card: Card) => {
    if (!activeBoard) return;
    await upsertBoard({
      ...activeBoard,
      cardIds: activeBoard.cardIds.filter((id) => id !== card.id),
    });
  };

  const addCardToBoard = async (card: Card) => {
    if (!activeBoard) return;
    if (activeBoard.cardIds.includes(card.id)) return;
    await upsertBoard({
      ...activeBoard,
      cardIds: [...activeBoard.cardIds, card.id],
    });
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
    await upsertBoard({ ...activeBoard, name: trimmed, emoji, color });
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

  return (
    <div className="flex-1 overflow-y-auto pb-3 flex flex-col">
      <TabRow
        boards={boards}
        activeBoardId={activeBoard?.id ?? null}
        onSelect={setActiveBoardId}
        onCreate={createBoard}
        onEdit={editBoard}
        onDelete={removeBoard}
        onReorder={reorderBoards}
        onRequestAddCards={() => setAddPickerOpen(true)}
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

function TabRow({
  boards,
  activeBoardId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
  onRequestAddCards,
}: {
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (id: string) => Promise<void>;
  onCreate: (values: BoardValues) => Promise<void>;
  onEdit: (values: BoardValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onReorder: (fromId: string, toId: string) => Promise<void>;
  onRequestAddCards: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuMode>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: TAB_LONG_PRESS_MS,
        tolerance: TAB_MOVE_TOLERANCE_PX,
      },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const moved = Math.hypot(delta.x, delta.y) > TAB_DRAG_MOVE_THRESHOLD_PX;
    const id = String(active.id);
    if (!moved) {
      // Long-press release without movement → activate then open rename so
      // the editor sees the long-pressed board as active.
      await onSelect(id);
      setMenu('rename');
      return;
    }
    if (over && active.id !== over.id) {
      void onReorder(id, String(over.id));
    }
  };

  useEffect(() => {
    if (!menu) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    // Defer attaching so the same pointerdown that opened the menu can't
    // close it on the document handler.
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const hasActive = Boolean(activeBoard);
  // Tint the baseline rail to the active board's color so the active tab
  // visually merges into it (file-folder seam disappears).
  const railBorder = railBorderClass(activeBoard?.color);

  return (
    <div className={`relative border-b-2 ${railBorder}`} ref={wrapperRef}>
      <div className="flex items-stretch">
        <div className="no-scrollbar flex-1 overflow-x-auto whitespace-nowrap flex items-end gap-1 px-2 pt-2">
          <DndContext
            sensors={sensors}
            modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={boards.map((b) => b.id)}
              strategy={horizontalListSortingStrategy}
            >
              {boards.map((b) => (
                <SortableTab
                  key={b.id}
                  board={b}
                  isActive={b.id === activeBoardId}
                  onSelect={() => onSelect(b.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {boards.length > 0 && (
            <button
              type="button"
              onClick={() => setMenu('new')}
              aria-label={t('boards.new') as string}
              className="shrink-0 -mb-[2px] px-3 py-2 text-base leading-none rounded-t-xl border border-b-0 border-navy-soft/70 bg-navy-deep/70 text-cream-dim hover:text-gold hover:bg-navy-soft/70 transition-colors"
            >
              +
            </button>
          )}
        </div>
        <div className="flex items-center px-2">
          <button
            type="button"
            onClick={() => setMenu((m) => (m ? null : 'root'))}
            className="btn-ghost text-lg leading-none w-9 h-9 inline-flex items-center justify-center"
            aria-label={t('boards.menu') as string}
            aria-expanded={menu !== null}
          >
            ⋮
          </button>
        </div>
      </div>

      {menu === 'root' && (
        <div
          className="absolute right-2 top-full mt-1 z-30 bg-navy-soft rounded-xl shadow-lg border border-navy-soft/70 py-1 w-52"
          role="menu"
        >
          <MenuItem onClick={() => setMenu('new')}>+ {t('boards.new')}</MenuItem>
          <MenuItem disabled={!hasActive} onClick={() => setMenu('rename')}>
            ✎ {t('boards.rename') as string}
          </MenuItem>
          <MenuItem
            disabled={!hasActive}
            onClick={() => {
              setMenu(null);
              onRequestAddCards();
            }}
          >
            + {t('boards.addCards')}
          </MenuItem>
          <MenuItem
            disabled={!hasActive}
            danger
            onClick={async () => {
              setMenu(null);
              await onDelete();
            }}
          >
            ✕ {t('boards.delete')}
          </MenuItem>
        </div>
      )}

      {menu === 'new' && (
        <BoardEditor
          title={t('boards.new') as string}
          onCancel={() => setMenu(null)}
          onSubmit={async (values) => {
            await onCreate(values);
            setMenu(null);
          }}
        />
      )}

      {menu === 'rename' && activeBoard && (
        <BoardEditor
          title={t('boards.rename') as string}
          initial={{
            name: activeBoard.name,
            emoji: activeBoard.emoji,
            color: activeBoard.color,
          }}
          onCancel={() => setMenu(null)}
          onSubmit={async (values) => {
            await onEdit(values);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function SortableTab({
  board,
  isActive,
  onSelect,
}: {
  board: Board;
  isActive: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });
  const tabCls = boardTabClasses(board.color);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2000 : undefined,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? '0 12px 28px rgba(0,0,0,0.55)' : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        'shrink-0 max-w-[12rem] px-4 py-2 text-sm font-serif cursor-pointer touch-none select-none',
        'rounded-t-xl border border-b-0 -mb-[2px] transition-colors relative',
        'flex items-center gap-1.5 focus:outline-none',
        isActive ? tabCls.active : tabCls.inactive,
      ].join(' ')}
    >
      {board.emoji && (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {board.emoji}
        </span>
      )}
      <span className="truncate">{board.name}</span>
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2 text-sm',
        disabled
          ? 'text-cream-dim/40 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-navy'
            : 'text-cream hover:bg-navy',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function BoardEditor({
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: BoardValues;
  onSubmit: (values: BoardValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const [color, setColor] = useState<CardColor>(initial?.color ?? 'none');
  const submit = () => void onSubmit({ name, emoji, color });
  return (
    <div className="absolute right-2 top-full mt-1 z-30 bg-navy-soft rounded-xl shadow-lg border border-navy-soft/70 p-3 w-80 max-w-[calc(100vw-1rem)] space-y-3">
      <div className="text-xs uppercase tracking-wider text-cream-dim">{title}</div>
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          maxLength={4}
          placeholder="✨"
          aria-label={t('boards.emoji') as string}
          className="w-14 bg-navy rounded-lg px-2 py-1.5 text-cream text-center text-xl outline-none focus:ring-2 focus:ring-gold/60"
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          placeholder={t('boards.boardName') as string}
          className="flex-1 bg-navy rounded-lg px-3 py-1.5 text-cream outline-none focus:ring-2 focus:ring-gold/60 text-sm"
        />
      </div>
      <div>
        <div className="text-xs text-cream-dim mb-1.5">{t('boards.color')}</div>
        <div className="flex flex-wrap gap-2">
          {CARD_COLORS.map((c) => {
            const cls = colorClasses(c);
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={t(`boards.colors.${c}`) as string}
                aria-pressed={selected}
                className={[
                  'w-7 h-7 rounded-full border transition-all',
                  cls.swatch,
                  selected
                    ? 'border-gold ring-2 ring-gold/60 scale-110'
                    : 'border-black/20 hover:scale-105',
                  c === 'none' ? 'border-cream-dim/40' : '',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn-primary text-sm" onClick={submit}>
          {t('boards.save')}
        </button>
      </div>
    </div>
  );
}

function railBorderClass(color?: CardColor): string {
  switch (color ?? 'none') {
    case 'yellow':
      return 'border-card-yellow-bg';
    case 'amber':
      return 'border-card-amber-bg';
    case 'coral':
      return 'border-card-coral-bg';
    case 'rose':
      return 'border-card-rose-bg';
    case 'lavender':
      return 'border-card-lavender-bg';
    case 'sage':
      return 'border-card-sage-bg';
    case 'sky':
      return 'border-card-sky-bg';
    case 'none':
    default:
      return 'border-gold/60';
  }
}

function AddCardsModal({
  candidates,
  emptyLabel,
  onAdd,
  onClose,
}: {
  candidates: Card[];
  emptyLabel: string;
  onAdd: (card: Card) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.locale);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidates) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [candidates]);
  const visible = useMemo(() => {
    if (selectedTags.length === 0) return candidates;
    return candidates.filter((c) => {
      const ct = c.tags ?? [];
      return selectedTags.some((t) => ct.includes(t));
    });
  }, [candidates, selectedTags]);
  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-navy-soft rounded-2xl shadow-2xl border border-navy-soft/70 p-3 w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-base text-gold font-serif">{t('boards.addCards')}</span>
          <button className="btn-ghost text-sm" onClick={onClose}>
            {t('boards.done')}
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="-mx-3">
            <TagFilterBar
              allTags={allTags}
              selected={selectedTags}
              onToggle={toggleTag}
              onClear={() => setSelectedTags([])}
            />
          </div>
        )}
        {candidates.length === 0 ? (
          <p className="text-cream-dim italic px-2 py-6 text-sm text-center">{emptyLabel}</p>
        ) : visible.length === 0 ? (
          <p className="text-cream-dim italic px-2 py-6 text-sm text-center">
            {t('cards.noTagsMatch')}
          </p>
        ) : (
          <div className="space-y-1.5 overflow-y-auto">
            {visible.map((c) => (
              <button
                key={c.id}
                onClick={() => void onAdd(c)}
                className="w-full text-left bg-navy/50 rounded-lg p-2 hover:bg-navy"
              >
                <div className="font-serif text-cream text-sm truncate">{c.title || '—'}</div>
                {c.references.length > 0 && (
                  <div className="text-xs text-gold-dim mt-0.5 truncate">
                    {c.references.map((r) => formatCardReferenceHeading(r, locale)).join(' · ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
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
