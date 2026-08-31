import type { MicCorner } from '@/store/settingsStore';

const PAD = 12;
const BOTTOM_NAV_H = 56; // measured nav grid height (icon + label), excl. safe area

/** Diameter of the dock's mic button. Exported because everything that has to
 * clear the mic — the voice overlay, the drag ghost's offset — has to agree
 * with it, and it changed once already. */
export const MIC_SIZE = 64;

export type AnchorStyle = {
  position: 'fixed';
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

const PADDING_PROP = {
  top: 'paddingTop',
  right: 'paddingRight',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
} as const;

/** Hidden element whose paddings resolve the safe-area variables for us. */
let probe: HTMLDivElement | null = null;

function ensureProbe(): HTMLDivElement {
  if (probe?.isConnected) return probe;
  probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:var(--safe-area-inset-top,0px);' +
    'padding-right:var(--safe-area-inset-right,0px);' +
    'padding-bottom:var(--safe-area-inset-bottom,0px);' +
    'padding-left:var(--safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  return probe;
}

/**
 * Safe-area inset in CSS pixels.
 *
 * This used to read the custom property directly and always returned 0 — the
 * variable it looked for (`--safe-area-*`) was never defined anywhere, and
 * even with the right name, getComputedStyle on a *custom property* is not
 * required to resolve the env() inside it. Reading back a real `padding`
 * always yields a used px value, so we measure instead of parse.
 *
 * Re-read on every call, so rotation and Capacitor's Android overrides are
 * picked up without any listener.
 */
export function safeAreaInset(side: 'top' | 'right' | 'bottom' | 'left'): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const n = parseFloat(getComputedStyle(ensureProbe())[PADDING_PROP[side]]);
  return Number.isFinite(n) ? n : 0;
}

export function getMicAnchor(opts: {
  corner: MicCorner | undefined;
  /** Height of the page's own bottom bar (chat composer, reader pager), from
   * uiLayoutStore. 0 when the page has none. */
  bottomBarHeight: number;
}): AnchorStyle {
  const corner: MicCorner = opts.corner ?? 'br';
  const top = PAD + safeAreaInset('top');
  // Distance from bottom of viewport to the mic's bottom edge.
  let bottom = PAD + safeAreaInset('bottom') + BOTTOM_NAV_H;
  const left = PAD + safeAreaInset('left');
  const right = PAD + safeAreaInset('right');

  // A page may render its own bar above the nav (the chat composer, the reader's
  // chapter pager). Lift bottom corners over it so floaters don't cover it. No
  // route check needed: only the mounted page reports a height, and 0 means
  // there's nothing to clear.
  if (opts.bottomBarHeight > 0 && (corner === 'br' || corner === 'bl')) {
    bottom += opts.bottomBarHeight - 4;
  }

  switch (corner) {
    case 'tl':
      return { position: 'fixed', top, left };
    case 'tr':
      return { position: 'fixed', top, right };
    case 'bl':
      return { position: 'fixed', bottom, left };
    case 'br':
    default:
      return { position: 'fixed', bottom, right };
  }
}

export function cornerForPoint(
  x: number,
  y: number,
  viewport: { width: number; height: number },
): MicCorner {
  const left = x < viewport.width / 2;
  const top = y < viewport.height / 2;
  if (top && left) return 'tl';
  if (top && !left) return 'tr';
  if (!top && left) return 'bl';
  return 'br';
}
