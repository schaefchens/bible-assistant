import { getChapter, verseSpeakable } from '@/services/bible/bibleApi';
import { getBookById, formatReference } from '@/services/bible/bookCatalog';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLastReadingStore } from '@/store/lastReadingStore';
import { nowId } from '@/store/libraryStore';
import { startReadingPlaylist } from './startPlayback';
import type { ChatMessage, VerseSummary } from '@/types/domain';

// Resume playback from the auto-captured last reading slot. Returns true if
// playback was kicked off, false if nothing was stored or the verses
// couldn't be fetched. Creates a synthetic assistant message in chat so the
// reading is visible (and so existing playback machinery can attach to it).
export async function playLastReading(): Promise<boolean> {
  const slot = useLastReadingStore.getState().slot;
  if (!slot) return false;
  const book = getBookById(slot.bookId);
  if (!book) return false;

  const chapter = await getChapter(slot.translation, slot.bookId, slot.chapter);
  if (chapter.length === 0) return false;

  const fromIdx = chapter.findIndex((v) => v.verse >= slot.verse);
  const slice = fromIdx === -1 ? [] : chapter.slice(fromIdx);
  if (slice.length === 0) return false;

  const locale = useSettingsStore.getState().locale;
  const summaries: VerseSummary[] = slice.map((v) => ({
    translation: slot.translation,
    bookId: slot.bookId,
    chapter: slot.chapter,
    verse: v.verse,
    text: verseSpeakable(v),
    display: formatReference(
      slot.bookId,
      slot.chapter,
      v.verse,
      v.verse,
      locale,
    ),
  }));

  const messageId = nowId();
  const message: ChatMessage = {
    id: messageId,
    role: 'assistant',
    text: '',
    verses: summaries,
    headingWholeChapter: false,
  };
  useChatStore.getState().appendMessage(message);
  await startReadingPlaylist(messageId, summaries, 0);
  return true;
}
