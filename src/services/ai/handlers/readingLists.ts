import { playReadingListInChat } from '@/lib/readingListPlayback';
import {
  withDayAdded,
  withEntriesAdded,
  withEntryRemoved,
} from '@/lib/readingListOperations';
import { describeReadingList, resolveReadingList } from '@/services/library/cardResolver';
import { buildPlanDays } from '@/services/reading/readingPlan';
import {
  expandEntryToChapters,
  formatReadingEntry,
  listEntries,
  newReadingDay,
  newReadingList,
  parseReadingEntryLine,
} from '@/services/reading/readingEntries';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ReadingDay, ReadingEntry, ReadingList } from '@/types/domain';
import type { ToolArgs } from '../tools';
import type { ToolDispatchResult } from '../toolResult';

/**
 * The reading-list tools: building a plan, editing one, and playing it.
 *
 * `describeReadingList` returns counts plus a two-day sample rather than the
 * whole list, and both system prompts say to answer in one sentence — the
 * assistant used to narrate every day of a plan it had just made, which for a
 * year plan is minutes of speech.
 */

export function listReadingLists(): ToolDispatchResult {
  return {
    ok: true,
    data: useLibraryStore.getState().readingLists.map(describeReadingList),
  };
}

// ─── Reading lists ────────────────────────────────────────────────────────

/**
 * Parse the model's passage strings, reporting the ones that didn't resolve
 * rather than dropping them silently — a reading list with a hole in it is
 * worse than a tool call that says which line was wrong.
 */
function parsePassages(passages: string[]): { entries: ReadingEntry[]; rejected: string[] } {
  const entries: ReadingEntry[] = [];
  const rejected: string[] = [];
  for (const raw of passages) {
    const entry = parseReadingEntryLine(raw);
    // A book or a span becomes one entry per chapter, so "read Jonah" is four
    // things the user can tick off rather than one all-or-nothing item.
    if (entry) entries.push(...expandEntryToChapters(entry));
    else rejected.push(raw);
  }
  return { entries, rejected };
}

export async function handleCreateReadingList(
  args: ToolArgs['create_reading_list'],
): Promise<ToolDispatchResult> {
  const rejected: string[] = [];
  const days: ReadingDay[] = [];

  // A rule beats an enumeration for anything long — see services/reading/readingPlan.
  if (args.plan) {
    const built = buildPlanDays(args.plan.cover ?? [], args.plan.days ?? 1);
    rejected.push(...built.unresolved);
    days.push(...built.days);
  }

  for (const day of args.days ?? []) {
    const parsed = parsePassages(day.passages ?? []);
    rejected.push(...parsed.rejected);
    days.push({ ...newReadingDay(day.title), entries: parsed.entries });
  }
  if (args.passages?.length) {
    const parsed = parsePassages(args.passages);
    rejected.push(...parsed.rejected);
    // A plain list is one untitled day — see the ReadingList type.
    days.push({ ...newReadingDay(), entries: parsed.entries });
  }
  if (days.length === 0) days.push(newReadingDay());
  if (days.every((d) => d.entries.length === 0)) {
    return {
      ok: false,
      error: rejected.length
        ? `no passage could be parsed (${rejected.join(', ')})`
        : 'a reading list needs at least one passage',
    };
  }

  const list: ReadingList = {
    ...newReadingList(args.name),
    description: args.description,
    days,
  };
  await useLibraryStore.getState().upsertReadingList(list);
  return {
    ok: true,
    data: { ...describeReadingList(list), rejected: rejected.length ? rejected : undefined },
  };
}

export async function handleUpdateReadingList(
  args: ToolArgs['update_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  let list = lookup.list;
  const rejected: string[] = [];

  if (args.name !== undefined) list = { ...list, name: args.name };
  if (args.description !== undefined) {
    list = { ...list, description: args.description || undefined };
  }

  if (args.addPassages?.length) {
    const parsed = parsePassages(args.addPassages);
    rejected.push(...parsed.rejected);
    const lastDay = list.days[list.days.length - 1];
    list = withEntriesAdded(list, lastDay.id, parsed.entries);
  }
  if (args.addDay?.passages?.length) {
    const parsed = parsePassages(args.addDay.passages);
    rejected.push(...parsed.rejected);
    const withDay = withDayAdded(list, args.addDay.title);
    const added = withDay.days[withDay.days.length - 1];
    list = withEntriesAdded(withDay, added.id, parsed.entries);
  }
  if (args.removePassages?.length) {
    const locale = useSettingsStore.getState().locale;
    for (const wanted of args.removePassages) {
      const target = parseReadingEntryLine(wanted);
      if (!target) {
        rejected.push(wanted);
        continue;
      }
      // Match on the formatted passage, so "Psalm 23:1-6" finds the entry
      // regardless of the note or translation the user attached to it.
      const text = formatReadingEntry(target, locale);
      const hit = listEntries(list).find((e) => formatReadingEntry(e, locale) === text);
      if (hit) list = withEntryRemoved(list, hit.id);
      else rejected.push(wanted);
    }
  }

  await useLibraryStore.getState().upsertReadingList(list);
  return {
    ok: true,
    data: { ...describeReadingList(list), rejected: rejected.length ? rejected : undefined },
  };
}

export async function handleDeleteReadingList(
  args: ToolArgs['delete_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  await useLibraryStore.getState().deleteReadingList(lookup.list.id);
  return { ok: true, data: { deleted: lookup.list.name } };
}

/* ---- community spaces ---- */

export async function handlePlayReadingList(
  args: ToolArgs['play_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const list = lookup.list;
  if (listEntries(list).length === 0) {
    return { ok: false, error: `reading list "${list.name}" is empty` };
  }
  if (args.restart) {
    // Clearing the resume point is what "start over" means; the ticks stay, so
    // the user can still see what they have read.
    await useLibraryStore.getState().setCurrentEntry(list.id, undefined);
  }
  // Into the chat, not the reader: the reading appears where the user asked for
  // it, exactly like read_verses, and the list keeps playing as a list because
  // the appended message carries the entry's provenance. The list screen's own
  // Play button is the one that reads in the reader.
  const started = await playReadingListInChat(list.id);
  if (!started) {
    return {
      ok: false,
      error: `could not start "${list.name}" — its passages may not be available in the current translation`,
    };
  }
  return { ok: true, data: describeReadingList(list) };
}
