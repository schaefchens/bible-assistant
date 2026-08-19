import { useEffect, type RefObject } from 'react';
import { useUiLayoutStore } from '@/store/uiLayoutStore';

/**
 * Publish a page's bottom-bar height so the floating mic / playback bar can sit
 * above it. Resets to 0 on unmount, so hiding the bar drops the floaters back
 * down. Shared by the chat composer and the reader's pager — they need the exact
 * same ResizeObserver bookkeeping.
 */
export function useBottomBarHeight(ref: RefObject<HTMLElement | null>): void {
  const setBottomBarHeight = useUiLayoutStore((s) => s.setBottomBarHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBottomBarHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setBottomBarHeight(0);
    };
  }, [ref, setBottomBarHeight]);
}
