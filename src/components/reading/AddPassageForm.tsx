import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookChapterPicker } from '@/components/chat/BookChapterPicker';
import {
  newEntryId,
  parseReadingEntryLines,
} from '@/services/reading/readingEntries';
import type { ReadingEntry } from '@/types/domain';

type Props = {
  onAdd: (entries: ReadingEntry[]) => void;
};

/**
 * The two ways a passage gets into a list: typed as a reference line, or tapped
 * out of the Bible picker.
 *
 * Both exist because they serve different moments — entering a printed 90-day
 * plan is typing (and pasting, hence the multi-line parse), while "what was that
 * chapter called" is browsing. The picker is the same sheet the headers use, so
 * there is one book/chapter UI in the app.
 */
export function AddPassageForm({ onAdd }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [rejected, setRejected] = useState(0);

  const submit = () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const entries = parseReadingEntryLines(text);
    setRejected(lines.length - entries.length);
    if (entries.length > 0) {
      onAdd(entries);
      setText('');
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-brand/20 bg-surface-raised/40 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter commits, Shift+Enter keeps the multi-line paste workflow.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={t('lists.addPassagePlaceholder') as string}
        className="w-full bg-surface rounded-lg px-3 py-2 text-ink font-serif text-sm outline-none focus:ring-2 focus:ring-brand/60"
      />
      <p className="text-[11px] text-ink-muted mt-1">{t('lists.addPassageHint')}</p>
      {rejected > 0 && (
        <p role="alert" className="text-[11px] text-amber-400 mt-1">
          {t('lists.unparsed', { count: rejected })}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={submit}
          disabled={text.trim() === ''}
          className="h-9 px-3 rounded-lg bg-brand text-on-brand text-sm disabled:opacity-40 active:scale-95 transition-all"
        >
          {t('lists.addPassage')}
        </button>
        <BookChapterPicker
          onPick={(bookId, chapter) => onAdd([{ id: newEntryId(), bookId, chapter }])}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="h-9 px-3 rounded-lg border border-brand/40 text-brand text-sm hover:bg-brand/10 active:scale-95 transition-all"
            >
              {t('lists.addFromPicker')}
            </button>
          )}
        />
      </div>
    </div>
  );
}
