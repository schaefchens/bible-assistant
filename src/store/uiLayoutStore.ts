import { create } from 'zustand';

type UiLayoutState = {
  composerHeight: number;
  setComposerHeight: (n: number) => void;
};

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  composerHeight: 0,
  setComposerHeight: (composerHeight) => set({ composerHeight }),
}));
