import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/** How far past the bottom edge to start loading the next chapter. */
const FORWARD_MARGIN = '400px';

type Result = {
  /** Attach to a 1px element rendered after the last chapter. */
  sentinelRef: RefObject<HTMLDivElement | null>;
  /** Load the previous chapter, keeping the reading position steady. */
  loadPrevious: () => void;
};

/**
 * Endless scrolling for the reader, plus the scroll bookkeeping it needs.
 *
 * Three jobs:
 *
 * 1. **Forward append** via an IntersectionObserver on a sentinel below the last
 *    chapter. Appending *below* the viewport never moves what the user is
 *    reading, so this is safe to fire even while follow-the-verse auto-scroll is
 *    driving the view. It doubles as a text prefetch: by the time the voice
 *    reaches the chapter end the verses are already in the store, so
 *    auto-continuation only pays for TTS.
 *
 * 2. **Scroll anchoring.** Inserting a chapter above the viewport (or trimming
 *    one off the top to stay within MAX_VISIBLE) shifts everything down. WebKit
 *    has no dependable `overflow-anchor`, so we re-pin manually: sample the
 *    topmost on-screen chapter's offset on scroll, then restore that offset in a
 *    layout effect, before paint. Pinning to an *element* rather than doing
 *    scrollHeight arithmetic is what makes this survive iOS momentum scrolling.
 *
 * 3. **Position tracking.** Whichever chapter crosses the middle of the viewport
 *    becomes the persisted reading position.
 */
export function useEndlessChapters(
  scrollRef: RefObject<HTMLDivElement | null>,
): Result {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const endless = useSettingsStore((s) => s.readerEndlessScroll);
  const visible = useReaderStore((s) => s.visible);
  const error = useReaderStore((s) => s.error);

  /** { chapter id, its offset from the container's top edge }. */
  const anchor = useRef<{ id: string; delta: number } | null>(null);

  const sampleAnchor = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const blocks = container.querySelectorAll<HTMLElement>('[data-chapter-id]');
    for (const el of blocks) {
      // The first chapter whose bottom is still below the top edge is the one
      // the user is looking at (or about to scroll into).
      if (el.offsetTop + el.offsetHeight > container.scrollTop) {
        const id = el.dataset.chapterId;
        if (id) anchor.current = { id, delta: el.offsetTop - container.scrollTop };
        return;
      }
    }
  }, [scrollRef]);

  // Sample on scroll, throttled to one rAF so a fast flick doesn't do this work
  // per event.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sampleAnchor();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    sampleAnchor();
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollRef, sampleAnchor, visible.length]);

  // Re-pin before paint whenever the set of mounted chapters changes. When the
  // anchor chapter is gone (a `goTo` replaced the window) there is nothing to
  // restore and the page owns the scroll position instead — see ReadPage.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const a = anchor.current;
    if (!container || !a) return;
    const el = container.querySelector<HTMLElement>(
      `[data-chapter-id="${CSS.escape(a.id)}"]`,
    );
    if (!el) return;
    const target = el.offsetTop - a.delta;
    if (Math.abs(container.scrollTop - target) > 1) container.scrollTop = target;
  }, [visible, scrollRef]);

  // Forward append.
  useEffect(() => {
    if (!endless || error) return;
    const container = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        const store = useReaderStore.getState();
        if (store.status === 'loading' || store.error) return;
        void store.extend(1);
      },
      { root: container, rootMargin: `0px 0px ${FORWARD_MARGIN} 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [endless, error, scrollRef, visible]);

  // Position tracking: the chapter crossing the viewport's middle band wins.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || visible.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.chapterId;
          if (!id) continue;
          const chapter = useReaderStore.getState().chapters[id];
          if (!chapter) continue;
          useReaderStore.getState().setPosition({
            translation: chapter.translation,
            bookId: chapter.bookId,
            chapter: chapter.chapter,
          });
        }
      },
      { root: container, rootMargin: '-45% 0px -55% 0px' },
    );
    for (const el of container.querySelectorAll('[data-chapter-id]')) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [scrollRef, visible]);

  const loadPrevious = useCallback(() => {
    // Sample right now: this runs from a tap, so no momentum is in flight and
    // the offset we capture is exactly what we should restore to.
    sampleAnchor();
    void useReaderStore.getState().extend(-1);
  }, [sampleAnchor]);

  return { sentinelRef, loadPrevious };
}
