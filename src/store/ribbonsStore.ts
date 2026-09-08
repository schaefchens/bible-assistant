import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translation } from '@/services/bible/bibleApi';

export type RibbonColor = 'gold' | 'blue' | 'red' | 'green' | 'purple';
export const RIBBON_COLORS: RibbonColor[] = ['gold', 'blue', 'red', 'green', 'purple'];

export type Ribbon = {
  color: RibbonColor;
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
  savedAt: number;
};

type RibbonsState = {
  slots: Record<RibbonColor, Ribbon | null>;
  setRibbon: (color: RibbonColor, payload: Omit<Ribbon, 'color' | 'savedAt'>) => void;
  clearRibbon: (color: RibbonColor) => void;
};

const EMPTY_SLOTS: Record<RibbonColor, Ribbon | null> = {
  gold: null,
  blue: null,
  red: null,
  green: null,
  purple: null,
};

export const useRibbonsStore = create<RibbonsState>()(
  persist(
    (set) => ({
      slots: { ...EMPTY_SLOTS },
      setRibbon: (color, payload) =>
        set((s) => ({
          slots: {
            ...s.slots,
            [color]: { color, ...payload, savedAt: Date.now() },
          },
        })),
      clearRibbon: (color) =>
        set((s) => ({ slots: { ...s.slots, [color]: null } })),
    }),
    {
      name: 'ba.ribbons',
      version: 1,
    },
  ),
);
