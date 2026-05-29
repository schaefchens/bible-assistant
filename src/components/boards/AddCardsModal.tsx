import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCardReferenceHeading } from '@/services/bible/cardReference';
import { TagFilterBar } from '@/components/cards/TagFilterBar';
import type { Card } from '@/types/domain';

/** Modal that lists cards not yet on the active board (filterable by tag) and
 * adds the tapped one. Closes on overlay click, Done, or Escape. */
export function AddCardsModal({
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
