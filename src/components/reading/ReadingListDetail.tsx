import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { AddPassageForm } from './AddPassageForm';
import { ProgressBar } from './ProgressBar';
import { DayHeading, DraftInput, EntryRow, PagePicker } from './listDetailParts';
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
import type { ReadingEntry, ReadingList } from '@/types/domain';
import { PlayIcon } from '@/components/common/icons';
import { ChevronIcon } from '@/components/common/icons';
import { useLocale } from '@/hooks/useLocale';

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
  const { t } = useTranslation();
  const locale = useLocale();
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
