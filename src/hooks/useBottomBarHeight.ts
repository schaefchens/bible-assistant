import { useEffect, type RefObject } from 'react';
import { useUiLayoutStore } from '@/store/uiLayoutStore';

/** Publish an element's height into `uiLayoutStore`, and 0 once it unmounts. */
function usePublishedHeight(
  ref: RefObject<HTMLElement | null>,
  publish: (n: number) => void,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => publish(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      publish(0);
    };
  }, [ref, publish]);
}

/**
 * Publish a page's bottom-bar height so the floating mic dock can sit above it.
 * Resets to 0 on unmount, so hiding the bar drops the floaters back down.
 * Shared by the chat composer and the reader's pager — they need the exact same
 * ResizeObserver bookkeeping.
 */
export function useBottomBarHeight(ref: RefObject<HTMLElement | null>): void {
  const set = useUiLayoutStore((s) => s.setBottomBarHeight);
  usePublishedHeight(ref, set);
}

/**
 * Publish the mic dock's height when it is docked as a bar. Same bookkeeping,
 * a different number, because the two stack: the page's bar sits above the
 * dock's, and the voice overlay has to clear both.
 */
export function useDockBarHeight(ref: RefObject<HTMLElement | null>): void {
  const set = useUiLayoutStore((s) => s.setDockBarHeight);
  usePublishedHeight(ref, set);
}
