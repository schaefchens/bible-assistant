import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const cardOrder = useLibraryStore((s) => s.cardOrder);
  const deleteCard = useLibraryStore((s) => s.deleteCard);
  const reorderCards = useLibraryStore((s) => s.reorderCards);
  const [draftCard, setDraftCard] = useState<Card | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [raisedId, setRaisedId] = useState<string | null>(null);

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
          return selectedTags.some((t) => cardTags.includes(t));
        })
      : cards;
    const rank = new Map(cardOrder.map((id, i) => [id, i]));
    const unknownFallback = filtered.length + 1;
    return filtered.slice().sort((a, b) => {
      const ra = rank.get(a.id) ?? unknownFallback;
      const rb = rank.get(b.id) ?? unknownFallback;
      if (ra !== rb) return ra - rb;
      return b.updatedAt - a.updatedAt;
    });
  }, [cards, cardOrder, selectedTags]);

  const closeEditor = () => {
    if (draftCard) {
      setDraftCard(null);
      return;
    }
    if (routeId) navigate(-1);
  };

  const handleEdit = useCallback(
    (c: Card) => {
      setRaisedId(c.id);
      navigate(`/cards/${c.id}`);
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
    <div className="flex-1 overflow-y-auto pb-3 flex flex-col">
      <div className="relative border-b-2 border-brand/60">
        <div className="flex items-stretch">
          <div className="flex-1 flex items-center gap-1 px-2 pt-2 pb-1">
            <div className="shrink-0 px-3 py-1 text-sm font-serif text-ink-muted">
              {t('boards.cardCount', { count: cards.length })}
            </div>
            <button
              type="button"
              onClick={newCard}
              aria-label={t('cards.new') as string}
              className="shrink-0 px-3 py-1 text-base leading-none rounded-xl border border-surface-raised/70 bg-surface-sunken/70 text-ink-muted hover:text-brand hover:bg-surface-raised/70 transition-colors"
            >
              +
            </button>
          </div>
          <div className="flex items-center px-2">
            <KebabMenu menuLabel={t('boards.menu')}>
              <MenuItem onClick={newCard}>+ {t('cards.new')}</MenuItem>
            </KebabMenu>
          </div>
        </div>
      </div>
      {cards.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
          <p className="text-ink-muted max-w-xs">{t('cards.empty')}</p>
          <button
            onClick={newCard}
            className="btn-primary text-base px-6 py-3 rounded-xl"
          >
            + {t('cards.new')}
          </button>
        </div>
      ) : (
        <>
          <TagFilterBar
            allTags={allTags}
            selected={selectedTags}
            onToggle={toggleTag}
            onClear={() => setSelectedTags([])}
          />
          <CardStack
            cards={visibleCards}
            raisedId={raisedId}
            onRaisedIdChange={setRaisedId}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onReorder={reorderCards}
            emptyLabel={emptyLabel}
          />
        </>
      )}
    </div>
  );
}

function KebabMenu({
  menuLabel,
  children,
}: {
  menuLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost text-lg leading-none w-9 h-9 inline-flex items-center justify-center"
        aria-label={menuLabel}
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 bg-surface-raised rounded-xl shadow-lg border border-surface-raised/70 py-1 w-52"
          role="menu"
          onClick={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest('[role="menuitem"]')) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-surface"
    >
      {children}
    </button>
  );
}
