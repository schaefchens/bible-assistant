import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { CardEditor } from '@/components/cards/CardEditor';
import type { Card } from '@/types/domain';

export function CardsPage() {
  const { t } = useTranslation();
  const cards = useLibraryStore((s) => s.cards);
  const [editing, setEditing] = useState<Card | null>(null);

  if (editing) {
    return <CardEditor card={editing} onClose={() => setEditing(null)} />;
  }

  const newCard = () => {
    const card: Card = {
      id: nowId(),
      title: '',
      references: [],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setEditing(card);
  };

  return (
    <div className="flex-1 overflow-y-auto pb-3">
      <div className="p-3 flex items-center justify-between">
        <h2 className="text-xl font-serif text-gold">{t('cards.title')}</h2>
        <button className="btn-primary text-sm" onClick={newCard}>
          {t('cards.new')}
        </button>
      </div>
      {cards.length === 0 && (
        <p className="text-cream-dim italic px-4 py-6">{t('cards.empty')}</p>
      )}
      <div className="px-3 space-y-2">
        {cards
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => setEditing(c)}
              className="w-full text-left bg-navy-soft/50 rounded-xl p-3 hover:bg-navy-soft transition-colors"
            >
              <div className="font-serif text-cream">{c.title || '—'}</div>
              <div className="text-xs text-gold-dim mt-1">{c.references.join(' · ')}</div>
              {c.notes && (
                <div className="text-xs text-cream-dim mt-1 line-clamp-2">{c.notes}</div>
              )}
            </button>
          ))}
      </div>
    </div>
  );
}
