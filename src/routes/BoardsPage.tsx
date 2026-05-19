import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import type { Board } from '@/types/domain';

export function BoardsPage() {
  const { t } = useTranslation();
  const boards = useLibraryStore((s) => s.boards);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = async () => {
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
    setName('');
    setCreating(false);
  };

  return (
    <div className="flex-1 overflow-y-auto pb-3">
      <div className="p-3 flex items-center justify-between">
        <h2 className="text-xl font-serif text-gold">{t('boards.title')}</h2>
        <button className="btn-primary text-sm" onClick={() => setCreating(true)}>
          {t('boards.new')}
        </button>
      </div>

      {creating && (
        <div className="px-3 mb-3 flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder={t('boards.boardName')}
            className="flex-1 bg-navy-soft rounded-xl px-3 py-2 text-cream outline-none focus:ring-2 focus:ring-gold/60"
          />
          <button className="btn-primary text-sm" onClick={create}>
            {t('boards.save')}
          </button>
        </div>
      )}

      {boards.length === 0 && (
        <p className="text-cream-dim italic px-4 py-6">{t('boards.empty')}</p>
      )}

      <div className="px-3 space-y-2">
        {boards
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((b) => (
            <Link
              key={b.id}
              to={`/boards/${b.id}`}
              className="block bg-navy-soft/50 rounded-xl p-3 hover:bg-navy-soft transition-colors"
            >
              <div className="font-serif text-cream">{b.name}</div>
              <div className="text-xs text-gold-dim mt-1">
                {t('boards.cardCount', { count: b.cardIds.length })}
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
}
