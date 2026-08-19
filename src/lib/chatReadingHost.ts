import { useChatStore } from '@/store/chatStore';
import { formatReference } from '@/services/bible/bookCatalog';
import type { Locale, VerseSummary } from '@/types/domain';
import type { ReadingGroup, ReadingGroupId, ReadingHost } from './readingHosts';

/**
 * Readings that live in the conversation: each is an assistant message with
 * `verses` attached. This module holds the *only* remaining
 * `messages.find(m => m.id === …)` in the playback path.
 */
export const chatReadingHost: ReadingHost = {
  ns: 'chat',

  getGroup(id: ReadingGroupId): ReadingGroup | null {
    const msg = useChatStore.getState().messages.find((m) => m.id === id);
    if (!msg?.verses?.length) return null;
    return {
      id,
      verses: msg.verses,
      wholeChapter: msg.headingWholeChapter ?? false,
    };
  },

  listGroups(): ReadingGroup[] {
    const out: ReadingGroup[] = [];
    for (const m of useChatStore.getState().messages) {
      if (!m.verses?.length) continue;
      out.push({
        id: m.id,
        verses: m.verses,
        wholeChapter: m.headingWholeChapter ?? false,
      });
    }
    return out;
  },

  defaultGroup(): ReadingGroupId | null {
    const list = chatReadingHost.listGroups();
    return list.length > 0 ? list[list.length - 1].id : null;
  },

  previousGroup(id: ReadingGroupId): Promise<ReadingGroupId | null> {
    const list = chatReadingHost.listGroups();
    const i = list.findIndex((g) => g.id === id);
    return Promise.resolve(i > 0 ? list[i - 1].id : null);
  },

  /** Auto-play never modifies the original reading — each continuation chunk
   * becomes its own assistant message, so it renders as its own ReaderPanel and
   * the audio bridges via soft-end. */
  appendReading(verses, opts): Promise<ReadingGroupId | null> {
    if (verses.length === 0) return Promise.resolve(null);
    const id = crypto.randomUUID();
    useChatStore.getState().appendMessage({
      id,
      role: 'assistant',
      text: '',
      verses,
      historyNote: opts.historyNote,
      headingWholeChapter: opts.wholeChapter,
      createdAt: Date.now(),
    });
    return Promise.resolve(id);
  },
};

/**
 * "(Played aloud: Galatians 5:22-26; Galatians 6:1-5.)" — the assistant turn's
 * content when chat history is rebuilt for the model, so it knows what was read
 * even though no visible text was emitted.
 *
 * Lives with the chat host rather than in autoPlay: it exists purely to keep the
 * model's conversation coherent, which is chat's concern. Hosts without a
 * conversation ignore `historyNote` entirely.
 */
export function rangeHistoryNote(
  summaries: VerseSummary[],
  locale: Locale,
): string {
  // Collapse contiguous (book, chapter, verse) runs in this single chunk.
  type Range = { bookId: number; chapter: number; start: number; end: number };
  const ranges: Range[] = [];
  for (const v of summaries) {
    const last = ranges[ranges.length - 1];
    if (
      last &&
      last.bookId === v.bookId &&
      last.chapter === v.chapter &&
      v.verse === last.end + 1
    ) {
      last.end = v.verse;
    } else {
      ranges.push({ bookId: v.bookId, chapter: v.chapter, start: v.verse, end: v.verse });
    }
  }
  const formatted = ranges
    .map((r) => formatReference(r.bookId, r.chapter, r.start, r.end, locale))
    .join('; ');
  return `(Played aloud: ${formatted}.)`;
}
