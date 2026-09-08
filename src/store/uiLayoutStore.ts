import { create } from 'zustand';

type UiLayoutState = {
  /**
   * Height of whatever bar the current page renders between its content and the
   * bottom nav — the chat composer, the reader's chapter pager. Floating things
   * (mic, playback bar, voice overlay) read it to sit above that bar instead of
   * on top of it, which is why it's a single shared number rather than a
   * per-page one: only one page is mounted at a time, and 0 means "no bar".
   */
  bottomBarHeight: number;
  setBottomBarHeight: (n: number) => void;
  /**
   * Height of the mic dock when it is docked as a bar above the nav — 0 in
   * every floating position. The bar is laid out *in flow*, so the page needs
   * no padding for it; this exists for the fixed-position floaters (the voice
   * overlay) that have to sit above it and can't see the flex column.
   */
  dockBarHeight: number;
  setDockBarHeight: (n: number) => void;
};

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  bottomBarHeight: 0,
  setBottomBarHeight: (bottomBarHeight) => set({ bottomBarHeight }),
  dockBarHeight: 0,
  setDockBarHeight: (dockBarHeight) => set({ dockBarHeight }),
}));
