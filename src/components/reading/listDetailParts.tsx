import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PassageRow } from './PassageRow';
import { passageDetail } from '@/services/reading/readingEntries';
import { PlayIcon } from '@/components/common/icons';
import type { ReadingDay, ReadingEntry } from '@/types/domain';

/**
 * The pieces `ReadingListDetail` is assembled from: its pager, a day's heading,
 * a passage row, the inline rename field, and the icon button the last three
 * share.
 *
 * They live here rather than in the screen because every one of them is driven
 * entirely by its props — none reads a store or closes over the screen's state,
 * which is what made the move a move rather than a redesign. `IconButton` is
 * deliberately *not* exported: it is the shared shape of the controls in this
 * file, and a sixth caller elsewhere would want `components/common/icons.tsx`.
 *
 * `pageOf` and the two per-page constants stayed behind — they are what the
 * screen pages *with*, and the screen is the only thing that pages.
 */
/**
 * Step through a long list. Rendered above and below the passages, because a
 * page of a week is taller than the screen and scrolling back up to move on is
 * the kind of small friction that makes a plan feel like work.
 */
export function PagePicker({
  label,
  page,
  pageCount,
  onGo,
}: {
  label: string;
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page === 0}
        aria-label={t('lists.previousPage') as string}
        className="h-8 w-9 shrink-0 rounded-lg text-lg leading-none text-brand hover:bg-brand/10 disabled:opacity-25 disabled:pointer-events-none transition-colors"
      >
        ‹
      </button>
      <span className="min-w-0 truncate text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page >= pageCount - 1}
        aria-label={t('lists.nextPage') as string}
        className="h-8 w-9 shrink-0 rounded-lg text-lg leading-none text-brand hover:bg-brand/10 disabled:opacity-25 disabled:pointer-events-none transition-colors"
      >
        ›
      </button>
    </div>
  );
}

export function DayHeading({
  day,
  index,
  editing,
  onRename,
  onRemove,
}: {
  day: ReadingDay;
  index: number;
  editing: boolean;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const fallback = t('lists.day', { number: index + 1 });

  if (!editing) {
    return (
      <h2 className="font-serif text-brand-muted text-sm uppercase tracking-wider mb-2">
        {day.title || fallback}
      </h2>
    );
  }
  return (
    <div className="flex items-center gap-2 mb-2">
      <DraftInput
        value={day.title ?? ''}
        onCommit={onRename}
        placeholder={fallback}
        aria-label={t('lists.dayTitle') as string}
        className="flex-1 min-w-0 bg-surface-raised rounded-lg px-2 py-1 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('lists.deleteDay') as string}
        title={t('lists.deleteDay') as string}
        className="h-7 w-7 shrink-0 rounded-lg text-ink-muted hover:text-red-400 transition-colors"
      >
        ×
      </button>
    </div>
  );
}

export function EntryRow({
  entry,
  text,
  done,
  current,
  editing,
  onToggle,
  onOpen,
  onPlay,
  onMove,
  onRemove,
}: {
  entry: ReadingEntry;
  text: string;
  done: boolean;
  current: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPlay: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <PassageRow
        text={text}
        detail={passageDetail([entry.label, entry.translation])}
        done={done}
        current={current}
        onToggle={onToggle}
        onOpen={onOpen}
        trailing={
          editing ? (
            <span className="flex items-center gap-0.5 shrink-0">
              <IconButton label={t('lists.moveUp') as string} onClick={() => onMove(-1)}>
                ↑
              </IconButton>
              <IconButton label={t('lists.moveDown') as string} onClick={() => onMove(1)}>
                ↓
              </IconButton>
              <IconButton label={t('lists.removeEntry') as string} onClick={onRemove} danger>
                ×
              </IconButton>
            </span>
          ) : (
            <IconButton label={t('lists.play') as string} onClick={onPlay}>
              <PlayIcon />
            </IconButton>
          )
        }
      />
    </li>
  );
}

/**
 * A text field that keeps its own draft and commits on blur (or Enter).
 *
 * Writing through on every keystroke does not work here: `upsertReadingList`
 * awaits a Dexie put before it updates the store, so a controlled
 * `value={list.name}` reads stale text between keystrokes and silently drops
 * characters — and it queued one sync op per character typed. The store is the
 * record; this is the edit in progress.
 */
export function DraftInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [adopted, setAdopted] = useState(value);

  // Adopt an outside change (a pull from another device, an assistant rename)
  // while the user isn't in the middle of typing. Adjusted during render rather
  // than in an effect: this is state derived from a prop, not state
  // synchronized to an external system.
  if (!focused && value !== adopted) {
    setAdopted(value);
    setDraft(value);
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'h-7 w-7 rounded-lg text-sm transition-colors',
        danger ? 'text-ink-muted hover:text-red-400' : 'text-ink-muted hover:text-brand',
      )}
    >
      {children}
    </button>
  );
}

