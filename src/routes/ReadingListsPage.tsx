import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ROUTES } from '@/lib/appRoutes';
import { useGoBack } from '@/hooks/useGoBack';
import { ReadingListDetail } from '@/components/reading/ReadingListDetail';
import { ProgressBar } from '@/components/reading/ProgressBar';
import { useLibraryStore } from '@/store/libraryStore';
import {
  listChapterCount,
  listEntries,
  newReadingList,
} from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import type { ReadingList } from '@/types/domain';
import { ChevronIcon } from '@/components/common/icons';

/**
 * Reading lists: plans and custom lists of what to read.
 *
 * Not a bottom-nav tab — it's reached from the book picker in the Chat and Read
 * headers, which is where the question "what should I read" already gets asked.
 * `/lists/:id` opens one, mirroring `/cards/:id`.
 */
export function ReadingListsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const lists = useLibraryStore((s) => s.readingLists);
  const upsert = useLibraryStore((s) => s.upsertReadingList);
  /** Ids created in this session, so the detail view opens straight into edit
   * mode for a list that is still blank. */
  const [freshIds, setFreshIds] = useState<string[]>([]);

  // Not a nav tab, so without this the index is a dead end: you arrive from the
  // picker on Chat or Read and nothing returns you there.
  const goBack = useGoBack(ROUTES.chat);

  const create = useCallback(async () => {
    const list = newReadingList('');
    setFreshIds((ids) => [...ids, list.id]);
    await upsert(list);
    navigate(`/lists/${list.id}`);
  }, [navigate, upsert]);

  const open = routeId ? lists.find((l) => l.id === routeId) : undefined;
  if (routeId) {
    // A list deleted on another device (or a stale link) shouldn't strand the
    // user on a blank screen.
    if (!open) return <MissingList />;
    return <ReadingListDetail list={open} startEditing={freshIds.includes(open.id)} />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back') as string}
          className="shrink-0 text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <ChevronIcon dir="left" size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-brand text-lg truncate">{t('lists.title')}</h1>
          <p className="text-[11px] text-ink-muted truncate">{t('lists.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void create()}
          className="h-9 px-3 shrink-0 rounded-lg bg-brand text-on-brand text-sm active:scale-95 transition-transform"
        >
          + {t('lists.new')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28">
        {lists.length === 0 ? (
          <p className="py-10 text-center text-ink-muted text-sm leading-relaxed">
            {t('lists.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {lists.map((list) => (
              <li key={list.id}>
                <ListRow list={list} onOpen={() => navigate(`/lists/${list.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ListRow({ list, onOpen }: { list: ReadingList; onOpen: () => void }) {
  const { t } = useTranslation();
  const progress = useLibraryStore((s) => s.readingProgress[list.id]);
  const stats = progressStats(list, progress);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-surface-raised/70 bg-surface-raised/30 px-4 py-3 hover:border-brand/40 active:scale-[0.99] transition-all"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-ink text-[16px] truncate">
          {list.emoji ? `${list.emoji} ` : ''}
          {list.name || t('lists.untitled')}
        </span>
        <span className="text-[11px] text-ink-muted shrink-0">
          {t('lists.entries', { count: listEntries(list).length })}
        </span>
      </div>
      {list.description && (
        <p className="text-xs text-ink-muted mt-0.5 truncate">{list.description}</p>
      )}
      <div className="mt-2">
        <ProgressBar fraction={stats.fraction} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px] text-ink-muted">
        <span>{t('lists.progress', { done: stats.done, total: stats.total })}</span>
        <span>{t('lists.chapters', { count: listChapterCount(list) })}</span>
      </div>
    </button>
  );
}

function MissingList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
      <p className="text-ink-muted text-sm text-center">{t('lists.empty')}</p>
      <button
        type="button"
        onClick={() => navigate('/lists')}
        className="h-9 px-4 rounded-lg border border-brand/40 text-brand text-sm"
      >
        {t('common.back')}
      </button>
    </div>
  );
}
