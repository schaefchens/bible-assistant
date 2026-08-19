import {
  findReaderChapter,
  readerGroupId,
  useReaderStore,
  type LoadedChapter,
} from '@/store/readerStore';
import { prevChapterRef } from '@/services/bible/chapterNavigation';
import type { ReadingGroup, ReadingGroupId, ReadingHost } from './readingHosts';

function toGroup(chapter: LoadedChapter): ReadingGroup {
  return {
    id: chapter.id,
    verses: chapter.verses,
    // A reader group is always a whole chapter, so headings read
    // "John, chapter 3" rather than "John 3:1-36".
    wholeChapter: true,
  };
}

/**
 * Readings that live on the reader screen: each is a loaded chapter.
 *
 * Group ids are **deterministic** (`reader:<translation>:<book>:<chapter>`,
 * derived from `verses[0]`), which is what makes the whole thing work — scroll
 * away and back, or replay, and the same chapter yields the same id, so queued
 * tracks still resolve and `WordHighlighter` re-binds without any plumbing.
 */
export const readerReadingHost: ReadingHost = {
  ns: 'reader',

  getGroup(id: ReadingGroupId): ReadingGroup | null {
    const chapter = findReaderChapter(id);
    return chapter ? toGroup(chapter) : null;
  },

  /** Only the mounted window, in canonical order — that is the playlist the
   * user can actually see. */
  listGroups(): ReadingGroup[] {
    const { visible, chapters } = useReaderStore.getState();
    const out: ReadingGroup[] = [];
    for (const id of visible) {
      const chapter = chapters[id];
      if (chapter) out.push(toGroup(chapter));
    }
    return out;
  },

  /** Play on the reader route starts the chapter the user is looking at. */
  defaultGroup(): ReadingGroupId | null {
    const { position, visible, chapters } = useReaderStore.getState();
    if (position) {
      const id = readerGroupId(position.translation, position.bookId, position.chapter);
      if (chapters[id]) return id;
    }
    return visible[0] ?? null;
  },

  /** Loads the previous chapter if it isn't mounted, so stepping back past
   * verse 1 walks into it rather than dead-ending. */
  async previousGroup(id: ReadingGroupId): Promise<ReadingGroupId | null> {
    const list = readerReadingHost.listGroups();
    const i = list.findIndex((g) => g.id === id);
    if (i > 0) return list[i - 1].id;

    const chapter = findReaderChapter(id);
    if (!chapter) return null;
    if (!prevChapterRef(chapter.bookId, chapter.chapter)) return null;
    return useReaderStore.getState().extend(-1);
  },

  /** Idempotent by construction: `adopt` returns the existing id when endless
   * scroll has already loaded the chapter auto-continuation is asking for. */
  appendReading(verses): Promise<ReadingGroupId | null> {
    return Promise.resolve(useReaderStore.getState().adopt(verses));
  },
};
