import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { BoardGrid } from '@/components/cards/BoardGrid';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import type { Board, Card } from '@/types/domain';

type MenuMode = null | 'root' | 'new' | 'rename';

export function BoardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();

  const boardsRaw = useLibraryStore((s) => s.boards);
  const cards = useLibraryStore((s) => s.cards);
  const activeBoardId = useLibraryStore((s) => s.activeBoardId);
  const setActiveBoardId = useLibraryStore((s) => s.setActiveBoardId);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const deleteBoard = useLibraryStore((s) => s.deleteBoard);
  const initialized = useLibraryStore((s) => s.initialized);

  // Stable createdAt-ascending order for tabs.
  const boards = useMemo(
    () => boardsRaw.slice().sort((a, b) => a.createdAt - b.createdAt),
    [boardsRaw],
  );

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

  const createBoard = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const board: Board = {
      id: nowId(),
      name: trimmed,
      cardIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await upsertBoard(board);
    await setActiveBoardId(board.id);
  };

  const renameBoard = async (name: string) => {
    if (!activeBoard) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    await upsertBoard({ ...activeBoard, name: trimmed });
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

  return (
    <div className="flex-1 overflow-y-auto pb-3 flex flex-col">
      <TabRow
        boards={boards}
        activeBoardId={activeBoard?.id ?? null}
        onSelect={(id) => void setActiveBoardId(id)}
        onCreate={createBoard}
        onRename={renameBoard}
        onDelete={removeBoard}
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
            <BoardGrid
              cards={visibleCards}
              onOpen={(c) => navigate(`/cards/${c.id}`)}
              onReorder={reorderInBoard}
              onRemove={removeFromBoard}
              emptyLabel={emptyGridLabel}
            />
          </>
        )
      ) : null}

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
  onRename,
  onDelete,
  onRequestAddCards,
}: {
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRequestAddCards: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuMode>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="relative border-b border-navy-soft" ref={wrapperRef}>
      <div className="flex items-stretch">
        <div className="flex-1 overflow-x-auto whitespace-nowrap flex items-end gap-1 px-2 pt-2">
          {boards.map((b) => {
            const isActive = b.id === activeBoardId;
            return (
              <button
                key={b.id}
                onClick={() => onSelect(b.id)}
                className={[
                  'shrink-0 max-w-[10rem] truncate px-3 py-2 text-sm font-serif rounded-t-xl border',
                  '-mb-px transition-colors',
                  isActive
                    ? 'bg-navy-soft text-gold border-navy-soft border-b-navy-soft'
                    : 'bg-navy/40 text-cream-dim hover:text-cream border-transparent',
                ].join(' ')}
                aria-pressed={isActive}
              >
                {b.name}
              </button>
            );
          })}
          {boards.length > 0 && (
            <button
              type="button"
              onClick={() => setMenu('new')}
              aria-label={t('boards.new') as string}
              className="shrink-0 -mb-px px-3 py-2 text-base leading-none rounded-t-xl border border-transparent text-cream-dim hover:text-gold hover:bg-navy/40 transition-colors"
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
            ✎ {t('boards.rename')}
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
        <InlineInput
          placeholder={t('boards.boardName') as string}
          onCancel={() => setMenu(null)}
          onSubmit={async (value) => {
            await onCreate(value);
            setMenu(null);
          }}
        />
      )}

      {menu === 'rename' && activeBoard && (
        <InlineInput
          placeholder={t('boards.boardName') as string}
          initialValue={activeBoard.name}
          onCancel={() => setMenu(null)}
          onSubmit={async (value) => {
            await onRename(value);
            setMenu(null);
          }}
        />
      )}
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

function InlineInput({
  placeholder,
  initialValue = '',
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initialValue?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  return (
    <div className="absolute right-2 top-full mt-1 z-30 bg-navy-soft rounded-xl shadow-lg border border-navy-soft/70 p-2 w-72 max-w-[calc(100vw-1rem)]">
      <div className="flex gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSubmit(value);
            else if (e.key === 'Escape') onCancel();
          }}
          placeholder={placeholder}
          className="flex-1 bg-navy rounded-lg px-3 py-1.5 text-cream outline-none focus:ring-2 focus:ring-gold/60 text-sm"
        />
        <button className="btn-primary text-sm" onClick={() => void onSubmit(value)}>
          {t('boards.save')}
        </button>
      </div>
    </div>
  );
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
                    {c.references.join(' · ')}
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

function EmptyState({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
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
              if (e.key === 'Enter') void onCreate(name).then(() => setName(''));
              else if (e.key === 'Escape') setCreating(false);
            }}
            placeholder={t('boards.boardName') as string}
            className="flex-1 bg-navy rounded-xl px-3 py-2 text-cream outline-none focus:ring-2 focus:ring-gold/60"
          />
          <button
            className="btn-primary text-sm"
            onClick={() => void onCreate(name).then(() => setName(''))}
          >
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
