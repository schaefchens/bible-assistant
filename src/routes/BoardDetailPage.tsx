import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';

export function BoardDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const board = useLibraryStore((s) => s.boards.find((b) => b.id === id));
  const cards = useLibraryStore((s) =>
    s.cards.filter((c) => board?.cardIds.includes(c.id)),
  );
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const deleteBoard = useLibraryStore((s) => s.deleteBoard);
  const allCards = useLibraryStore((s) => s.cards);
  const [picking, setPicking] = useState(false);

  if (!board) {
    return <p className="p-4 text-cream-dim">Not found</p>;
  }

  const candidates = allCards.filter((c) => !board.cardIds.includes(c.id));

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

      <div className="px-3 space-y-2">
        {cards.map((c) => (
          <Link
            key={c.id}
            to={`/cards`}
            className="block bg-navy-soft/50 rounded-xl p-3"
          >
            <div className="font-serif text-cream">{c.title}</div>
            <div className="text-xs text-gold-dim mt-1">{c.references.join(' · ')}</div>
            {c.notes && <div className="text-xs text-cream-dim mt-1 line-clamp-2">{c.notes}</div>}
          </Link>
        ))}
        {cards.length === 0 && <p className="text-cream-dim italic p-4">—</p>}
      </div>

      <div className="px-3 pt-4">
        <button onClick={() => setPicking((v) => !v)} className="btn-ghost text-sm">
          {picking ? t('common.cancel') : t('boards.addCards')}
        </button>
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
