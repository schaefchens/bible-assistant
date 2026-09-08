import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { ReadingList, ReadingProgress } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import { formatSegment, type SegmentRef } from '@/services/reading/readingSequence';
import { listChapterCount, passageDetail } from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import { listWindow } from '@/services/reading/listWindow';
import { PassageRow } from '@/components/reading/PassageRow';
import { ProgressBar } from '@/components/reading/ProgressBar';
import { NarrationDownloadButton } from '@/components/reader/NarrationDownloadButton';
import { NarrationGroupButton } from '@/components/reader/NarrationGroupButton';
import { subjectsForSegments } from '@/lib/narrationGroup';
import {
  CheckMark,
  ChevronRight,
  PagerButton,
  PickerBody,
  PickerEmpty,
  PlayGlyph,
} from './pickerRows';

/**
 * Picking from a reading list: the index of lists, and one list's passages.
 * `{ kind: 'list' }`'s half of the picker.
 *
 * The windowing — which day, which page, where the reader is — is not decided
 * here. It comes from `services/reading/listWindow`, which is also what the
 * reader resumes from, so the sheet and the page cannot disagree about where
 * you left off.
 */

/** Pick a list to read through. */
export function ListsView({
  lists,
  progress,
  onSelect,
  onManage,
}: {
  lists: ReadingList[];
  progress: Record<string, ReadingProgress>;
  onSelect: (listId: string) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PickerBody>
      {lists.length === 0 ? (
        <PickerEmpty>{t('lists.empty')}</PickerEmpty>
      ) : (
        <ul className="py-2 space-y-1">
          {lists.map((list) => {
            const stats = progressStats(list, progress[list.id]);
            return (
              <li key={list.id}>
                <button
                  type="button"
                  onClick={() => onSelect(list.id)}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand/10 active:bg-brand/15 transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-serif text-ink text-sm truncate">
                      {list.emoji ? `${list.emoji} ` : ''}
                      {list.name || t('lists.untitled')}
                    </span>
                    <span className="block text-[11px] text-ink-muted mt-0.5">
                      {t('lists.progress', { done: stats.done, total: stats.total })}
                    </span>
                  </span>
                  <ChevronRight />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={onManage}
        className="w-full mt-1 mb-3 h-10 rounded-xl border border-brand/30 text-brand text-sm hover:bg-brand/10 transition-colors"
      >
        {t('lists.manage')}
      </button>
    </PickerBody>
  );
}

/**
 * The selected list's passages: a window onto it, one day or one page at a
 * time, with progress and a way in.
 *
 * A ninety-day plan is not something anyone picks from whole, so the
 * neighbouring days are *named* in the pager rather than listed — and a
 * finished day is ticked wherever it is named, so "have I done that one" is
 * answerable without stepping onto it.
 */
export function ListPassages({
  list,
  progress,
  translation,
  lang,
  browseAt,
  onBrowse,
  onPick,
  onContinue,
  onToggleEntry,
}: {
  list: ReadingList;
  progress: ReadingProgress | undefined;
  translation: Translation;
  lang: 'en' | 'de';
  /** Where the user has stepped to, or `null` to open where the reader is. */
  browseAt: number | null;
  onBrowse: (at: number) => void;
  onPick: (ref: SegmentRef) => void;
  onContinue: (ref: SegmentRef) => void;
  onToggleEntry: (entryId: string, done: boolean) => void;
}) {
  const { t } = useTranslation();
  const w = useMemo(
    () => listWindow(list, progress, translation, browseAt),
    [list, progress, translation, browseAt],
  );
  const stats = progressStats(list, progress);
  const done = (entryId: string | undefined) =>
    !!entryId && (progress?.completed.includes(entryId) ?? false);
  const resume = w.resume;
  /** Only a *day* is ticked as finished. A flat list's one day is not a day. */
  const focusDone = w.grouped && (w.days[w.focus]?.done ?? false);

  const dayLabel = (index: number) =>
    w.days[index]?.title ?? (t('lists.day', { number: index + 1 }) as string);
  const dayPagerLabel = (index: number) => (
    <>
      {w.days[index]?.done && <CheckMark className="shrink-0" />}
      <span className="truncate">{dayLabel(index)}</span>
    </>
  );

  if (w.days.length === 0) {
    return (
      <PickerBody>
        <p className="py-8 text-center text-ink-muted text-sm">{t('lists.emptyList')}</p>
      </PickerBody>
    );
  }

  return (
    <PickerBody>
      <div className="pt-1 pb-3">
        <ProgressBar fraction={stats.fraction} />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] text-ink-muted truncate">
            {t('lists.progress', stats)}
            {' · '}
            {t('lists.chapters', { count: listChapterCount(list) })}
          </p>
          {resume && (
            <button
              type="button"
              onClick={() => onContinue(resume)}
              className="h-8 shrink-0 px-3 rounded-lg bg-brand text-on-brand text-sm flex items-center gap-1.5 active:scale-95 transition-transform"
            >
              <PlayGlyph />
              {stats.done > 0 && stats.done < stats.total
                ? t('lists.continue')
                : t('lists.start')}
            </button>
          )}
        </div>
      </div>

      {/* One step at a time — a day of a plan, or ten passages of a plain list.
          The neighbours are named rather than listed: a ninety-day plan is not
          something to scroll, and rows this size don't fit three abreast on a
          phone. */}
      <div className="flex items-center justify-between gap-2 pb-1">
        <PagerButton
          onClick={() => onBrowse(w.focus - 1)}
          disabled={!w.canBack}
          label={t('chat.bookPicker.earlier') as string}
          side="start"
        >
          {w.grouped && w.canBack ? dayPagerLabel(w.focus - 1) : null}
        </PagerButton>
        <span
          className={clsx(
            'flex items-center gap-1 min-w-0 rounded-full px-3 py-1',
            'text-[12px] uppercase tracking-wider font-serif',
            focusDone ? 'bg-brand/10 text-brand-muted' : 'bg-brand/15 text-brand',
          )}
        >
          {focusDone && <CheckMark />}
          <span className="truncate">
            {w.grouped
              ? dayLabel(w.focus)
              : t('chat.bookPicker.pageOf', { page: w.focus + 1, total: w.span })}
          </span>
        </span>
        <PagerButton
          onClick={() => onBrowse(w.focus + 1)}
          disabled={!w.canForward}
          label={t('chat.bookPicker.later') as string}
          side="end"
        >
          {w.grouped && w.canForward ? dayPagerLabel(w.focus + 1) : null}
        </PagerButton>
      </div>

      {/* Above the passages and right-aligned, so it sits at the head of the
          column of per-passage download buttons it stands for. Its scope is
          whatever the pager is showing — the day, or this page of a plain list —
          which is the unit someone actually wants before a flight. */}
      <div className="flex justify-end pb-1">
        <NarrationGroupButton
          subjects={subjectsForSegments(w.visible)}
          label={
            (w.grouped
              ? t('read.narration.downloadDay')
              : t('read.narration.downloadPassages')) as string
          }
        />
      </div>

      {/* A touch more than the list screen's `space-y-1`: these rows carry no
          play button, so they stay a little shorter and the same gap reads
          tighter between them. */}
      <ul className="space-y-1.5 pb-3">
        {w.visible.map((seg, i) => (
          <li key={`${seg.entryId ?? seg.bookId}:${seg.chapter}:${i}`}>
            <PassageRow
              text={formatSegment(seg, lang)}
              detail={passageDetail([
                seg.label,
                seg.translationPinned ? seg.translation : undefined,
              ])}
              done={done(seg.entryId)}
              current={!!seg.entryId && seg.entryId === resume?.entryId}
              onToggle={
                seg.entryId
                  ? () => onToggleEntry(seg.entryId as string, !done(seg.entryId))
                  : undefined
              }
              onOpen={() => onPick(seg)}
              trailing={
                <NarrationDownloadButton
                  subject={{
                    kind: 'chapter',
                    // The segment's own translation, not the active one: an
                    // entry pinned to LUT is downloaded in LUT, which is what
                    // it will be read in.
                    translation: seg.translation,
                    bookId: seg.bookId,
                    chapter: seg.chapter,
                  }}
                />
              }
            />
          </li>
        ))}
      </ul>
    </PickerBody>
  );
}
