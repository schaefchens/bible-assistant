import { create } from 'zustand';

type UiLayoutState = {
  composerHeight: number;
  playbackBarHeight: number;
  setComposerHeight: (n: number) => void;
  setPlaybackBarHeight: (n: number) => void;
};

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  composerHeight: 0,
  playbackBarHeight: 0,
  setComposerHeight: (composerHeight) => set({ composerHeight }),
  setPlaybackBarHeight: (playbackBarHeight) => set({ playbackBarHeight }),
}));
