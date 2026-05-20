import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { CardEditor } from '@/components/cards/CardEditor';
import { CardStack } from '@/components/cards/CardStack';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import type { Card } from '@/types/domain';

export function CardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const cards = useLibraryStore((s) => s.cards);
  const deleteCard = useLibraryStore((s) => s.deleteCard);
  const [draftCard, setDraftCard] = useState<Card | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const editing = useMemo<Card | null>(() => {
    if (draftCard) return draftCard;
    if (routeId) return cards.find((c) => c.id === routeId) ?? null;
    return null;
  }, [draftCard, routeId, cards]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const tag of c.tags ?? []) set.add(tag);
    return Array.from(set).sort();
  }, [cards]);

  const visibleCards = useMemo(() => {
    const filtered = selectedTags.length
      ? cards.filter((c) => {
          const cardTags = c.tags ?? [];
          return selectedTags.every((t) => cardTags.includes(t));
        })
      : cards;
    return filtered.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }, [cards, selectedTags]);

  const closeEditor = () => {
    if (draftCard) {
      setDraftCard(null);
      return;
    }
    if (routeId) navigate(-1);
  };

  if (editing) {
    return <CardEditor card={editing} onClose={closeEditor} />;
  }

  const newCard = () => {
    const card: Card = {
      id: nowId(),
      title: '',
      references: [],
      notes: '',
      tags: [],
      color: 'yellow',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setDraftCard(card);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const emptyLabel =
    selectedTags.length > 0 ? t('cards.noTagsMatch') : t('cards.empty');

  return (
    <div className="flex-1 overflow-y-auto pb-3">
      <div className="p-3 flex items-center justify-between">
        <h2 className="text-xl font-serif text-gold">{t('cards.title')}</h2>
        <button className="btn-primary text-sm" onClick={newCard}>
          {t('cards.new')}
        </button>
      </div>
      <TagFilterBar
        allTags={allTags}
        selected={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
      />
      <CardStack
        cards={visibleCards}
        onEdit={(c) => navigate(`/cards/${c.id}`)}
        onDelete={(c) => {
          if (!confirm(t('cards.confirmDelete'))) return;
          void deleteCard(c.id);
        }}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}
