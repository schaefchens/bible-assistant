import { usePlaybackStore } from '@/store/playbackStore';
import { useChatStore } from '@/store/chatStore';
import { getChapter } from './bibleApi';
import { getBookById } from './bookCatalog';
import type { Translation } from './bibleApi';

/** A concrete book/chapter/verse position in a given translation. */
export type ResolvedPosition = {
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
};

/** The verse the user most recently heard: the live playback position if any,
 * else the last verse of the most recent reading message in chat history
 * (covers the case where playback ended a few seconds ago). Returns null when
 * nothing has been read yet. */
export function resolveLastReadVerse(): ResolvedPosition | null {
  const cur = usePlaybackStore.getState().current;
  const messages = useChatStore.getState().messages;
  if (cur) {
    const msg = messages.find((m) => m.id === cur.messageId);
    const v = msg?.verses?.[cur.verseIndex];
    if (v) {
      return {
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
      };
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.verses && m.verses.length > 0) {
      const v = m.verses[m.verses.length - 1];
      return {
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
      };
    }
  }
  return null;
}

/** The next verse after `p`: the following verse in the chapter, or verse 1 of
 * the next chapter, or `p` unchanged at end-of-book. Used to compute where a
 * ribbon should resume (one past what was just heard). */
export async function advanceOneVerse(p: ResolvedPosition): Promise<ResolvedPosition> {
  // Advance within the current chapter if a next verse exists.
  try {
    const verses = await getChapter(p.translation, p.bookId, p.chapter);
    if (verses.length > 0) {
      const endVerse = verses[verses.length - 1].verse;
      if (p.verse < endVerse) {
        return { ...p, verse: p.verse + 1 };
      }
    }
  } catch {
    /* fall through to chapter roll-over */
  }
  // Else roll into the start of the next chapter.
  const book = getBookById(p.bookId);
  if (book && p.chapter < book.chapters) {
    return { ...p, chapter: p.chapter + 1, verse: 1 };
  }
  // End of book — keep the same verse so save still succeeds.
  return p;
}
