import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { BoardGrid } from '@/components/cards/BoardGrid';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import type { Card } from '@/types/domain';

export function BoardDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Zustand selectors must return stable references — `.find` and `.filter`
  // inside a selector produce a fresh array each call, which trips
  // useSyncExternalStore's getSnapshot stability check (React error #185).
  // Read raw arrays from the store, then derive with useMemo.
  const allBoards = useLibraryStore((s) => s.boards);
  const allCards = useLibraryStore((s) => s.cards);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const deleteBoard = useLibraryStore((s) => s.deleteBoard);
  const board = useMemo(() => allBoards.find((b) => b.id === id), [allBoards, id]);
  const cards = useMemo(() => {
    if (!board) return [];
    const byId = new Map(allCards.map((c) => [c.id, c]));
    return board.cardIds
      .map((cid) => byId.get(cid))
      .filter((c): c is Card => Boolean(c));
  }, [allCards, board]);
  const candidates = useMemo(
    () => (board ? allCards.filter((c) => !board.cardIds.includes(c.id)) : []),
    [allCards, board],
  );
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [cards]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const visibleCards = useMemo(() => {
    if (selectedTags.length === 0) return cards;
    return cards.filter((c) => {
      const ct = c.tags ?? [];
      return selectedTags.some((t) => ct.includes(t));
    });
  }, [cards, selectedTags]);
  const [picking, setPicking] = useState(false);
  const [reordering, setReordering] = useState(false);

  if (!board) {
    return <p className="p-4 text-cream-dim">Not found</p>;
  }

  const remove = async () => {
    if (!confirm('Delete board?')) return;
    await deleteBoard(board.id);
    navigate('/boards');
  };

  const toggle = async (cardId: string) => {
    const has = board.cardIds.includes(cardId);
    await upsertBoard({
      ...board,
      cardIds: has ? board.cardIds.filter((x) => x !== cardId) : [...board.cardIds, cardId],
    });
  };

  const move = async (cardId: string, dir: 'prev' | 'next') => {
    const idx = board.cardIds.indexOf(cardId);
    if (idx === -1) return;
    const target = dir === 'prev' ? idx - 1 : idx + 1;
    if (target < 0 || target >= board.cardIds.length) return;
    const next = board.cardIds.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    await upsertBoard({ ...board, cardIds: next });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const gridEmptyLabel =
    selectedTags.length > 0 ? t('cards.noTagsMatch') : '—';

  return (
    <div className="flex-1 overflow-y-auto pb-3">
      <div className="p-3 flex items-center justify-between">
        <Link to="/boards" className="btn-ghost text-sm">
          ← {t('common.back')}
        </Link>
        <h2 className="font-serif text-gold">{board.name}</h2>
        <button onClick={remove} className="text-xs text-red-400">
          {t('boards.delete')}
        </button>
      </div>

      <TagFilterBar
        allTags={allTags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
      />

      <BoardGrid
        cards={visibleCards}
        onOpen={(c) => navigate(`/cards/${c.id}`)}
        reorderMode={reordering}
        onMove={move}
        emptyLabel={gridEmptyLabel}
      />

      <div className="px-3 pt-4 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setReordering((v) => !v);
            if (picking) setPicking(false);
          }}
          className={['text-sm', reordering ? 'btn-primary' : 'btn-ghost'].join(' ')}
        >
          {reordering ? t('boards.doneReordering') : t('boards.reorder')}
        </button>
        {!reordering && (
          <button onClick={() => setPicking((v) => !v)} className="btn-ghost text-sm">
            {picking ? t('common.cancel') : t('boards.addCards')}
          </button>
        )}
      </div>

      {picking && candidates.length > 0 && (
        <div className="px-3 mt-2 space-y-2">
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className="w-full text-left bg-navy-soft/40 rounded-xl p-3 hover:bg-navy-soft"
            >
              <div className="font-serif text-cream">{c.title}</div>
              <div className="text-xs text-gold-dim mt-1">{c.references.join(' · ')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
