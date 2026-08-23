import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AddPassageForm } from './AddPassageForm';
import { ProgressBar } from './ProgressBar';
import { playReadingList, playSegmentInReader } from '@/lib/readingListPlayback';
import { BIBLE_SOURCE, expandList } from '@/services/reading/readingSequence';
import { useGoBack } from '@/hooks/useGoBack';
import { ROUTES } from '@/lib/appRoutes';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  formatReadingEntry,
  isFlatList,
  listChapterCount,
  listEntries,
} from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import {
  withDayAdded,
  withDayRemoved,
  withDayTitle,
  withEntriesAdded,
  withEntryMoved,
  withEntryRemoved,
} from '@/lib/readingListOperations';
import type { ReadingDay, ReadingEntry, ReadingList } from '@/types/domain';

type Props = {
  list: ReadingList;
  /** Opens in edit mode — used right after "New list", where the name is blank
   * and there is nothing to look at yet. */
  startEditing?: boolean;
};

/**
 * One reading list: its days, its passages, and what has been read.
 *
 * View mode is the daily surface — tick things off, tap a passage to open it —
 * and edit mode reveals the structural controls. Same split as a board's
 * "edit layout", and for the same reason: the controls that rearrange things
 * are in the way of the controls that use them.
 */
export function ReadingListDetail({ list, startEditing = false }: Props) {
  const { t, i18n } = useTranslation();
  const locale: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const navigate = useNavigate();

  const upsert = useLibraryStore((s) => s.upsertReadingList);
  const remove = useLibraryStore((s) => s.deleteReadingList);
  const setEntryDone = useLibraryStore((s) => s.setEntryDone);
  const progress = useLibraryStore((s) => s.readingProgress[list.id]);
  const translation = useSettingsStore((s) => s.translation);
  const goTo = useReaderStore((s) => s.goTo);

  // Back to wherever this was opened from — the index, or the picker on Chat or
  // Read when the sheet's edit button jumped straight here.
  const goBack = useGoBack(ROUTES.lists);
  const [editing, setEditing] = useState(startEditing);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const stats = useMemo(() => progressStats(list, progress), [list, progress]);
  const allEntries = useMemo(() => listEntries(list), [list]);
  const flat = isFlatList(list);
  const completed = useMemo(
    () => new Set(progress?.completed ?? []),
    [progress?.completed],
  );

  const save = useCallback(
    (next: ReadingList) => {
      // The operations return the same reference when nothing changed, which is
      // exactly the "don't bump updatedAt and don't queue a sync" signal.
      if (next !== list) void upsert(next);
    },
    [list, upsert],
  );

  /**
   * Open a passage in the reader, with this list as the reader's source — so
   * the pager's next/previous walk the plan rather than the Bible.
   *
   * Goes through the expanded segments rather than the entry, because a
   * whole-book or multi-chapter entry has several and the first one is what
   * "open this" means.
   */
  const openInReader = useCallback(
    (entry: ReadingEntry) => {
      const segment = expandList(list, translation).find((s) => s.entryId === entry.id);
      if (!segment) return;
      void useReaderStore
        .getState()
        .setSource({ kind: 'list', listId: list.id })
        .then(() => goTo(segment));
      navigate('/read');
    },
    [goTo, list, navigate, translation],
  );

  /** Read the list aloud from where it left off. The reader follows along, so
   * this navigates there too. */
  const play = useCallback(async () => {
    const started = await playReadingList(list.id);
    if (started) navigate('/read');
  }, [list.id, navigate]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back') as string}
          className="text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <BackChevron />
        </button>
        <h1 className="flex-1 min-w-0 font-serif text-brand text-lg truncate">
          {list.emoji ? `${list.emoji} ` : ''}
          {list.name || t('lists.untitled')}
        </h1>
        {allEntries.length > 0 && !editing && (
          <button
            type="button"
            onClick={() => void play()}
            aria-label={t('lists.play') as string}
            title={t('lists.play') as string}
            className="h-8 px-3 shrink-0 rounded-lg bg-brand text-on-brand text-sm flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <PlayIcon />
            {stats.done > 0 && stats.done < stats.total
              ? t('lists.continue')
              : t('lists.start')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            setAddingTo(null);
          }}
          aria-pressed={editing}
          className={clsx(
            'h-8 px-3 rounded-lg text-sm transition-colors',
            editing ? 'bg-brand/20 text-brand' : 'text-ink-muted hover:text-ink',
          )}
        >
          {editing ? t('lists.done') : t('lists.edit')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28">
        {editing && (
          <div className="space-y-2 mb-5">
            <DraftInput
              value={list.name}
              onCommit={(name) => void upsert({ ...list, name })}
              placeholder={t('lists.namePlaceholder') as string}
              aria-label={t('lists.name') as string}
              className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink font-serif outline-none focus:ring-2 focus:ring-brand/60"
            />
            <DraftInput
              value={list.description ?? ''}
              onCommit={(description) =>
                void upsert({ ...list, description: description || undefined })
              }
              placeholder={t('lists.descriptionPlaceholder') as string}
              aria-label={t('lists.description') as string}
              className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink text-sm outline-none focus:ring-2 focus:ring-brand/60"
            />
          </div>
        )}

        {!editing && list.description && (
          <p className="text-sm text-ink-muted mb-3">{list.description}</p>
        )}

        <div className="mb-5">
          <ProgressBar fraction={stats.fraction} />
          <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-muted">
            <span>{t('lists.progress', { done: stats.done, total: stats.total })}</span>
            <span>{t('lists.chapters', { count: listChapterCount(list) })}</span>
          </div>
        </div>

        {allEntries.length === 0 && !editing && (
          <p className="py-8 text-center text-ink-muted text-sm">{t('lists.emptyList')}</p>
        )}

        {list.days.map((day, dayIndex) => (
          <section key={day.id} className="mb-6">
            {!flat && (
              <DayHeading
                day={day}
                index={dayIndex}
                editing={editing}
                onRename={(title) => save(withDayTitle(list, day.id, title))}
                onRemove={() => save(withDayRemoved(list, day.id))}
              />
            )}

            <ul className="space-y-1">
              {day.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  text={formatReadingEntry(entry, locale)}
                  done={completed.has(entry.id)}
                  current={progress?.currentEntryId === entry.id}
                  editing={editing}
                  onToggle={() => void setEntryDone(list.id, entry.id, !completed.has(entry.id))}
                  onOpen={() => openInReader(entry)}
                  onPlay={() => {
                    const segment = expandList(list, translation).find(
                      (s) => s.entryId === entry.id,
                    );
                    if (!segment) return;
                    void playSegmentInReader(segment).then((started) => {
                      if (started) navigate('/read');
                    });
                  }}
                  onMove={(dir) => save(withEntryMoved(list, entry.id, dir))}
                  onRemove={() => save(withEntryRemoved(list, entry.id))}
                />
              ))}
            </ul>

            {editing && (
              <>
                {addingTo === day.id ? (
                  <AddPassageForm
                    onAdd={(entries) => save(withEntriesAdded(list, day.id, entries))}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTo(day.id)}
                    className="mt-2 h-9 px-3 rounded-lg border border-brand/30 text-brand text-sm hover:bg-brand/10 active:scale-95 transition-all"
                  >
                    + {t('lists.addPassage')}
                  </button>
                )}
              </>
            )}
          </section>
        ))}

        {editing && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-raised/50">
            <button
              type="button"
              onClick={() => save(withDayAdded(list))}
              className="h-9 px-3 rounded-lg border border-brand/30 text-brand text-sm hover:bg-brand/10 active:scale-95 transition-all"
            >
              + {t('lists.addDay')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t('lists.confirmDelete', { name: list.name || t('lists.untitled') }))) return;
                // Send the reader back to the Bible if it was following this
                // list, rather than leaving it in a plan that no longer exists.
                const reader = useReaderStore.getState();
                if (reader.source.kind === 'list' && reader.source.listId === list.id) {
                  void reader.setSource(BIBLE_SOURCE);
                }
                void remove(list.id);
                navigate('/lists');
              }}
              className="h-9 px-3 rounded-lg border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10 active:scale-95 transition-all"
            >
              {t('lists.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DayHeading({
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

function EntryRow({
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
    <li
      className={clsx(
        'flex items-center gap-2 rounded-xl px-2 py-1.5',
        current ? 'bg-brand/10 ring-1 ring-brand/30' : 'hover:bg-surface-raised/40',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={(done ? t('lists.markNotDone') : t('lists.markDone')) as string}
        className={clsx(
          'h-6 w-6 shrink-0 rounded-md border flex items-center justify-center transition-colors',
          done ? 'bg-brand border-brand text-on-brand' : 'border-ink-muted/40 text-transparent',
        )}
      >
        <CheckIcon />
      </button>

      <button
        type="button"
        onClick={onOpen}
        aria-label={t('lists.openPassage') as string}
        className="flex-1 min-w-0 text-left"
      >
        <span
          className={clsx(
            'font-serif text-[15px] truncate block',
            done ? 'text-ink-muted line-through' : 'text-ink',
          )}
        >
          {text}
        </span>
        {(entry.label || entry.translation) && (
          <span className="block text-[11px] text-ink-muted truncate">
            {[entry.label, entry.translation].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>

      {!editing && (
        <IconButton label={t('lists.play') as string} onClick={onPlay}>
          <PlayIcon />
        </IconButton>
      )}

      {editing && (
        <span className="flex items-center gap-0.5 shrink-0">
          <IconButton label={t('lists.moveUp') as string} onClick={() => onMove(-1)}>
            ↑
          </IconButton>
          <IconButton label={t('lists.moveDown') as string} onClick={() => onMove(1)}>
            ↓
          </IconButton>
          <IconButton
            label={t('lists.removeEntry') as string}
            onClick={onRemove}
            danger
          >
            ×
          </IconButton>
        </span>
      )}
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
function DraftInput({
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

function PlayIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="inline-block"
    >
      <path d="M7 4l14 8-14 8V4z" />
    </svg>
  );
}

function BackChevron() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
