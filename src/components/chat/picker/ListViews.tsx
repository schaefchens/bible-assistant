import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { MirroredList, ReadingList, ReadingProgress } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import {
  formatSegment,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { listChapterCount, passageDetail } from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import { listWindow } from '@/services/reading/listWindow';
import { PassageRow } from '@/components/reading/PassageRow';
import { ProgressBar } from '@/components/reading/ProgressBar';
import { NarrationDownloadButton } from '@/components/reader/NarrationDownloadButton';
import { NarrationGroupButton } from '@/components/reader/NarrationGroupButton';
import { subjectsForSegments } from '@/lib/narrationGroup';
import { useCommunityStore } from '@/store/communityStore';
import {
  AuthorGroup,
  CheckMark,
  PagerButton,
  PickerBody,
  PickerEmpty,
  PlayGlyph,
  SourceRow,
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

/**
 * Pick a plan to read through: the user's own first, then the ones shared into
 * rooms they follow.
 *
 * Grouped by author below the rule, with the same furniture the spaces view
 * uses — and grouped on the **pinned signing key**, never on the display name,
 * for the reason `groupSubscriptionsByAuthor` records: a name is neither unique
 * nor claimed, and merging two people called Christoph is the one mistake a
 * feature about knowing whose writing you are reading must not make.
 *
 * The mirrored plans are read from the store here rather than handed down by
 * the shell, matching how the spaces views do it: a feed refresh then
 * re-renders this list and not the whole sheet.
 */
export function ListsView({
  lists,
  progress,
  onSelect,
  onManage,
}: {
  lists: ReadingList[];
  progress: Record<string, ReadingProgress>;
  /** A source rather than an id, so a shared plan can name the room it is in. */
  onSelect: (source: ReaderSource) => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const mirroredLists = useCommunityStore((s) => s.mirroredLists);
  const authorGroups = useMemo(() => groupMirroredByAuthor(mirroredLists), [mirroredLists]);

  return (
    <PickerBody>
      {lists.length === 0 && mirroredLists.length === 0 ? (
        <PickerEmpty>{t('lists.empty')}</PickerEmpty>
      ) : (
        <ul className="py-2 space-y-1">
          {lists.map((list) => (
            <li key={list.id}>
              <ListSourceRow
                list={list}
                progress={progress[list.id]}
                onSelect={() => onSelect({ kind: 'list', listId: list.id })}
              />
            </li>
          ))}

          {lists.length > 0 && authorGroups.length > 0 && (
            <li aria-hidden className="pt-1 pb-1">
              <span className="block border-t border-surface-raised/60" />
            </li>
          )}

          {authorGroups.map((group) => (
            <AuthorGroup
              key={group.authorKey}
              ownerName={group.author}
              detail={t('lists.sharedCount', { count: group.plans.length }) as string}
            >
              {group.plans.map((m) => (
                <li key={`${m.code}:${m.list.id}`}>
                  <ListSourceRow
                    list={m.list}
                    progress={progress[m.list.id]}
                    onSelect={() => onSelect({ kind: 'list', listId: m.list.id, code: m.code })}
                  />
                </li>
              ))}
            </AuthorGroup>
          ))}
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
 * One plan, own or shared. `SourceRow` rather than a shape of its own, because
 * the two kinds sit in one list and two row shapes there read as two features.
 *
 * The progress is always the *reader's*: a `readingProgress` row is keyed by
 * list id and lives in this user's account, so ticking off somebody else's plan
 * records your own reading of it.
 */
function ListSourceRow({
  list,
  progress,
  onSelect,
}: {
  list: ReadingList;
  progress: ReadingProgress | undefined;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const stats = progressStats(list, progress);
  return (
    <SourceRow
      label={list.name || (t('lists.untitled') as string)}
      emoji={list.emoji}
      detail={t('lists.progress', { done: stats.done, total: stats.total }) as string}
      onSelect={onSelect}
    />
  );
}

/**
 * The mirrored plans of one author, collapsed behind their name.
 *
 * Presentation, so it stays out of the store — but *how* to group is a
 * correctness question, hence the signing key. Order is first-appearance, the
 * same rule `groupSubscriptionsByAuthor` uses, so the list does not reshuffle
 * as rooms refresh.
 */
function groupMirroredByAuthor(
  mirrors: MirroredList[],
): { authorKey: string; author: string; plans: MirroredList[] }[] {
  const groups = new Map<string, { authorKey: string; author: string; plans: MirroredList[] }>();
  for (const m of mirrors) {
    const group = groups.get(m.authorKey);
    if (group) group.plans.push(m);
    else groups.set(m.authorKey, { authorKey: m.authorKey, author: m.author, plans: [m] });
  }
  return [...groups.values()];
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
