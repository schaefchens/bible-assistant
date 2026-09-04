import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AddPassageForm } from './AddPassageForm';
import { PassageRow } from './PassageRow';
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
  passageDetail,
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
import { PlayIcon } from '@/components/common/icons';
import { ChevronIcon } from '@/components/common/icons';

/** A week of a plan per page — the unit people think in for a daily plan. */
const DAYS_PER_PAGE = 7;
/** Passages per page for a plain list. Roomier than the picker's page: this is a
 * whole screen, and scrolling a screenful is not the problem paging solves. */
const ENTRIES_PER_PAGE = 25;

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

  /**
   * Long lists are paged. A whole-Bible plan is 365 days and 1,189 passages, and
   * rendering them all put 13,000 nodes on the page — every tick then re-rendered
   * the lot, which is half a second of jank on a desktop and worse on a phone.
   *
   * The unit follows the list's own shape, as in the picker: a plan pages by
   * week, a plain list by passage.
   */
  const flatEntries = flat ? (list.days[0]?.entries ?? []) : [];
  const pageCount = flat
    ? Math.max(1, Math.ceil(flatEntries.length / ENTRIES_PER_PAGE))
    : Math.max(1, Math.ceil(list.days.length / DAYS_PER_PAGE));
  const [pageState, setPageState] = useState<{ listId: string; page: number } | null>(null);
  // Opens on the page holding the passage the user is on, so a plan lands on
  // today rather than on day 1 of 365. Not memoized: it is one findIndex, which
  // is nothing next to rendering the rows it decides.
  const defaultPage = pageOf(list, flat, progress?.currentEntryId);
  const page = Math.min(
    pageCount - 1,
    Math.max(0, pageState?.listId === list.id ? pageState.page : defaultPage),
  );
  const goToPage = (next: number) =>
    setPageState({ listId: list.id, page: Math.max(0, Math.min(pageCount - 1, next)) });
  /** Whatever was just added is on the last page — show it rather than leaving
   * the user looking at a page it isn't on. */
  const showLastPage = () => goToPage(pageCount);

  const visibleDays = flat
    ? list.days.map((day, index) => ({ day, index }))
    : list.days
        .map((day, index) => ({ day, index }))
        .slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
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
          <ChevronIcon dir="left" size={20} />
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

        {pageCount > 1 && (
          <PagePicker
            label={
              flat
                ? t('lists.passagesRange', {
                    from: page * ENTRIES_PER_PAGE + 1,
                    to: Math.min((page + 1) * ENTRIES_PER_PAGE, flatEntries.length),
                    total: flatEntries.length,
                  })
                : t('lists.daysRange', {
                    from: page * DAYS_PER_PAGE + 1,
                    to: Math.min((page + 1) * DAYS_PER_PAGE, list.days.length),
                    total: list.days.length,
                  })
            }
            page={page}
            pageCount={pageCount}
            onGo={goToPage}
          />
        )}

        {visibleDays.map(({ day, index: dayIndex }) => (
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
              {(flat
                ? day.entries.slice(page * ENTRIES_PER_PAGE, (page + 1) * ENTRIES_PER_PAGE)
                : day.entries
              ).map((entry) => (
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
                    onAdd={(entries) => {
                      save(withEntriesAdded(list, day.id, entries));
                      if (flat) showLastPage();
                    }}
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

        {pageCount > 1 && (
          <PagePicker
            label={t('lists.page', { page: page + 1, total: pageCount })}
            page={page}
            pageCount={pageCount}
            onGo={goToPage}
          />
        )}

        {editing && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-raised/50">
            <button
              type="button"
              onClick={() => {
                save(withDayAdded(list));
                showLastPage();
              }}
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

/** Which page holds `entryId` — the page a long list should open on. */
function pageOf(list: ReadingList, flat: boolean, entryId: string | undefined): number {
  if (!entryId) return 0;
  if (flat) {
    const at = (list.days[0]?.entries ?? []).findIndex((e) => e.id === entryId);
    return at === -1 ? 0 : Math.floor(at / ENTRIES_PER_PAGE);
  }
  const at = list.days.findIndex((d) => d.entries.some((e) => e.id === entryId));
  return at === -1 ? 0 : Math.floor(at / DAYS_PER_PAGE);
}

/**
 * Step through a long list. Rendered above and below the passages, because a
 * page of a week is taller than the screen and scrolling back up to move on is
 * the kind of small friction that makes a plan feel like work.
 */
function PagePicker({
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

