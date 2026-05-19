import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '@/store/libraryStore';
import { parseReference } from '@/services/bible/referenceParser';
import { formatReference } from '@/services/bible/bookCatalog';
import { useSettingsStore } from '@/store/settingsStore';
import type { Card, CardColor } from '@/types/domain';
import { CARD_COLORS } from '@/types/domain';
import { colorClasses } from './cardColors';
import { TagInput } from './TagInput';

type Props = {
  card: Card;
  onClose: () => void;
};

export function CardEditor({ card, onClose }: Props) {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.locale);
  const boards = useLibraryStore((s) => s.boards);
  const upsertCard = useLibraryStore((s) => s.upsertCard);
  const deleteCard = useLibraryStore((s) => s.deleteCard);
  const upsertBoard = useLibraryStore((s) => s.upsertBoard);

  const [title, setTitle] = useState(card.title);
  const [referencesText, setReferencesText] = useState(card.references.join('\n'));
  const [notes, setNotes] = useState(card.notes ?? '');
  const [tags, setTags] = useState<string[]>(card.tags ?? []);
  const [color, setColor] = useState<CardColor>(card.color ?? 'none');
  const [boardIds, setBoardIds] = useState<string[]>(
    boards.filter((b) => b.cardIds.includes(card.id)).map((b) => b.id),
  );

  const save = async () => {
    const refs = referencesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((raw) => {
        const parsed = parseReference(raw);
        if (!parsed) return raw;
        return formatReference(parsed.bookId, parsed.chapter, parsed.verseStart, parsed.verseEnd, locale);
      });

    await upsertCard({
      ...card,
      title: title.trim(),
      references: refs,
      notes: notes.trim(),
      tags,
      color,
    });

    for (const b of boards) {
      const should = boardIds.includes(b.id);
      const has = b.cardIds.includes(card.id);
      if (should && !has) {
        await upsertBoard({ ...b, cardIds: [...b.cardIds, card.id] });
      } else if (!should && has) {
        await upsertBoard({ ...b, cardIds: b.cardIds.filter((id) => id !== card.id) });
      }
    }

    onClose();
  };

  const remove = async () => {
    if (!confirm(t('cards.confirmDelete'))) return;
    await deleteCard(card.id);
    onClose();
  };

  const toggleBoard = (id: string) => {
    setBoardIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      <div className="flex items-center justify-between">
        <button className="btn-ghost text-sm" onClick={onClose}>
          ← {t('common.back')}
        </button>
        <button className="btn-primary text-sm" onClick={save}>
          {t('cards.save')}
        </button>
      </div>

      <Field label={t('cards.cardTitle')}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-navy-soft rounded-xl px-3 py-2 text-cream outline-none focus:ring-2 focus:ring-gold/60"
        />
      </Field>

      <Field label={t('cards.verses')}>
        <textarea
          value={referencesText}
          onChange={(e) => setReferencesText(e.target.value)}
          rows={3}
          className="w-full bg-navy-soft rounded-xl px-3 py-2 text-cream font-serif outline-none focus:ring-2 focus:ring-gold/60"
          placeholder="Galatians 5:22"
        />
      </Field>

      <Field label={t('cards.notes')}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full bg-navy-soft rounded-xl px-3 py-2 text-cream outline-none focus:ring-2 focus:ring-gold/60"
        />
      </Field>

      <Field label={t('cards.color')}>
        <div className="flex flex-wrap gap-2">
          {CARD_COLORS.map((c) => {
            const cls = colorClasses(c);
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={t(`cards.colors.${c}`) as string}
                aria-pressed={selected}
                className={[
                  'w-8 h-8 rounded-full border transition-all',
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
      </Field>

      <Field label={t('cards.tags')}>
        <TagInput value={tags} onChange={setTags} placeholder={t('cards.tagPlaceholder') as string} />
      </Field>

      {boards.length > 0 && (
        <Field label={t('cards.boards')}>
          <div className="flex flex-wrap gap-2">
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBoard(b.id)}
                className={
                  'rounded-full px-3 py-1 text-xs transition-colors ' +
                  (boardIds.includes(b.id)
                    ? 'bg-gold text-navy'
                    : 'bg-navy-soft text-cream-dim hover:text-cream')
                }
              >
                {b.name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {card.title && (
        <div className="pt-6">
          <button onClick={remove} className="text-xs text-red-400 hover:text-red-300">
            {t('cards.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-gold-dim mb-1">{label}</span>
      {children}
    </label>
  );
}
