/**
 * Where a card carried out of the All-cards stack can be dropped: the library
 * tab strip, and the board tab under the finger.
 *
 * The strip marks itself with these attributes and this is their only reader,
 * which is the whole design — the alternative was a registry of tab rects kept
 * in a ref, and rects go stale the moment the strip scrolls sideways or a tab
 * is renamed mid-drag. Hit-testing the live DOM cannot drift.
 *
 * It reads the *finger*, not the dragged card, so the card can stay clamped to
 * its column (`restrictToVerticalAxis`) and still reach a tab at the far end of
 * the strip. It does require the dragged card to stop taking pointer events
 * while it is being carried, or it would be the topmost element at every point
 * under the finger — see CardStack.
 */

/** On the strip's root element. */
export const LIBRARY_TABS_ATTR = 'data-library-tabs';
/** On each board tab, carrying that board's id. The All-cards tab deliberately
 * has none: every card is already in it, so it is not a target. */
export const BOARD_TAB_ATTR = 'data-board-tab';

export type TabDropHit = {
  /** Over the strip at all — used to pause the drag's edge autoscroll, which
   * would otherwise fight the aim (the sticky strip sits inside the scroller's
   * top threshold band). */
  overStrip: boolean;
  /** The board whose tab is under the point, if any. */
  boardId: string | null;
};

const MISS: TabDropHit = { overStrip: false, boardId: null };

export function tabDropAtPoint(x: number, y: number): TabDropHit {
  if (typeof document === 'undefined') return MISS;
  const el = document.elementFromPoint(x, y);
  if (!el) return MISS;
  if (!el.closest(`[${LIBRARY_TABS_ATTR}]`)) return MISS;
  const tab = el.closest(`[${BOARD_TAB_ATTR}]`);
  return { overStrip: true, boardId: tab?.getAttribute(BOARD_TAB_ATTR) ?? null };
}
