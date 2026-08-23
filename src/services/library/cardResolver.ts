import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatCardReferenceInput } from '@/services/bible/cardReference';
import {
  formatReadingEntry,
  formatReadingEntryInput,
  listEntries,
} from '@/services/reading/readingEntries';
import { progressStats } from '@/services/reading/readingProgress';
import type { Board, Card, ReadingList } from '@/types/domain';

/** Resolve a board by id, or (case-insensitively) by name. */
export function resolveBoard(ref: string): Board | undefined {
  const boards = useLibraryStore.getState().boards;
  const byId = boards.find((b) => b.id === ref);
  if (byId) return byId;
  const lower = ref.trim().toLowerCase();
  return boards.find((b) => b.name.trim().toLowerCase() === lower);
}

export type CardLookup =
  | { ok: true; card: Card }
  | { ok: false; error: string };

/** Resolve a card by id, or by exact (case-insensitive) title. Ambiguous
 * titles return an error listing the candidate ids so the model can retry by
 * id. */
export function resolveCard(ref: string): CardLookup {
  const cards = useLibraryStore.getState().cards;
  const byId = cards.find((c) => c.id === ref);
  if (byId) return { ok: true, card: byId };
  const lower = ref.trim().toLowerCase();
  const byTitle = cards.filter((c) => c.title.trim().toLowerCase() === lower);
  if (byTitle.length === 1) return { ok: true, card: byTitle[0] };
  if (byTitle.length === 0) return { ok: false, error: `card "${ref}" not found` };
  return {
    ok: false,
    error: `multiple cards titled "${ref}" — use card id instead (${byTitle.map((c) => c.id).join(', ')})`,
  };
}

/** All cards in the user's chosen order (cardOrder first, then by recency),
 * with each card's references formatted as display strings for the locale.
 * This is what `list_cards` returns to the model. */
export function listCardsInUserOrder(): (Omit<Card, 'references'> & { references: string[] })[] {
  const { cards, cardOrder } = useLibraryStore.getState();
  const locale = useSettingsStore.getState().locale;
  const rank = new Map(cardOrder.map((id, i) => [id, i]));
  const fallback = cards.length + 1;
  return cards
    .slice()
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? fallback;
      const rb = rank.get(b.id) ?? fallback;
      if (ra !== rb) return ra - rb;
      return b.updatedAt - a.updatedAt;
    })
    .map((c) => ({
      ...c,
      references: c.references.map((r) => formatCardReferenceInput(r, locale)),
    }));
}

export type ReadingListLookup =
  | { ok: true; list: ReadingList }
  | { ok: false; error: string };

/** Resolve a reading list by id, or by exact (case-insensitive) name.
 * Ambiguous names return the candidate ids so the model can retry by id —
 * same contract as {@link resolveCard}. */
export function resolveReadingList(ref: string): ReadingListLookup {
  const lists = useLibraryStore.getState().readingLists;
  const byId = lists.find((l) => l.id === ref);
  if (byId) return { ok: true, list: byId };
  const lower = ref.trim().toLowerCase();
  const byName = lists.filter((l) => l.name.trim().toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, list: byName[0] };
  if (byName.length === 0) return { ok: false, error: `reading list "${ref}" not found` };
  return {
    ok: false,
    error: `multiple reading lists named "${ref}" — use the list id instead (${byName
      .map((l) => l.id)
      .join(', ')})`,
  };
}

/**
 * A reading list as the model should see it: passages as the same strings the
 * tools accept, plus what has been read. Days are flattened into labelled
 * groups so a plan reads as a plan.
 */
export function describeReadingList(list: ReadingList) {
  const locale = useSettingsStore.getState().locale;
  const progress = useLibraryStore.getState().readingProgress[list.id];
  const done = new Set(progress?.completed ?? []);
  const stats = progressStats(list, progress);
  return {
    id: list.id,
    name: list.name,
    description: list.description,
    passagesRead: stats.done,
    passagesTotal: stats.total,
    currentPassage: (() => {
      const current = listEntries(list).find((e) => e.id === progress?.currentEntryId);
      return current ? formatReadingEntry(current, locale) : undefined;
    })(),
    days: list.days.map((day, i) => ({
      title: day.title ?? `Day ${i + 1}`,
      passages: day.entries.map((e) => ({
        passage: formatReadingEntryInput(e, locale),
        read: done.has(e.id),
      })),
    })),
  };
}
