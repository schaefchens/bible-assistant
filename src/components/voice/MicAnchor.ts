import type { MicCorner } from '@/store/settingsStore';

const PAD = 12;
const BOTTOM_NAV_H = 64; // nav grid height (icon + label)

export type AnchorStyle = {
  position: 'fixed';
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
};

export function safeAreaInset(side: 'top' | 'right' | 'bottom' | 'left'): number {
  if (typeof window === 'undefined') return 0;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(`--safe-area-${side}`);
  const n = parseFloat(val);
  if (!isNaN(n)) return n;
  // Fallback: read env() via a hidden probe — modern browsers expose
  // env(safe-area-inset-*) only inside CSS, so we approximate using 0.
  return 0;
}

export function getMicAnchor(opts: {
  corner: MicCorner | undefined;
  route: string;
  composerHeight: number;
}): AnchorStyle {
  const corner: MicCorner = opts.corner ?? 'br';
  const top = PAD + safeAreaInset('top');
  // Distance from bottom of viewport to the mic's bottom edge.
  let bottom = PAD + safeAreaInset('bottom') + BOTTOM_NAV_H;
  const left = PAD + safeAreaInset('left');
  const right = PAD + safeAreaInset('right');

  // On the chat route, the composer also lives above the nav. Lift bottom corners
  // above it so the floating mic doesn't cover the send button.
  if (opts.route === '/' && (corner === 'br' || corner === 'bl')) {
    bottom += opts.composerHeight + 4;
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
