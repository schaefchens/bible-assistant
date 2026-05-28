import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';

// Auto-captured "where I was last reading" position. Updated whenever the
// active playback advances to a new verse, so a fresh app load (or a
// cleared chat) can still resume from the last verse the user heard. This
// is distinct from named ribbons, which are explicit user-set bookmarks.
export type LastReadingSlot = {
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
  savedAt: number;
};

type LastReadingState = {
  slot: LastReadingSlot | null;
  setSlot: (slot: LastReadingSlot) => void;
  clear: () => void;
};

export const useLastReadingStore = create<LastReadingState>()(
  persist(
    (set) => ({
      slot: null,
      setSlot: (slot) => set({ slot }),
      clear: () => set({ slot: null }),
    }),
    {
      name: 'ba.last-reading',
      version: 1,
    },
  ),
);
