import type { Board, FreeformCardLayout } from '@/types/domain';

/** Design dimensions of the A4 corkboard, in px (210×297mm @ 96dpi). All
 * layout fractions are relative to these, so the board can be rendered at any
 * on-screen scale (pan/zoom) without touching stored data. */
export const BOARD_W = 794;
export const BOARD_H = 1123;

/** Smallest a card may be resized to, in design px. Comfortably larger than a
 * finger-sized handle so handles never overlap into uselessness. */
export const MIN_W_PX = 64;
export const MIN_H_PX = 64;

/** Default card footprint for an un-placed card, as board fractions. */
const DEFAULT_W = 0.24;
const DEFAULT_H = 0.17;
/** Keep auto-placed cards off the very edge. */
const MARGIN = 0.04;

export type Vec = { x: number; y: number };

/** The eight resize handles + the rotate handle. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

// ── helpers ────────────────────────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const deg2rad = (d: number) => (d * Math.PI) / 180;

/** Rotate a vector by θ radians. */
function rot(v: Vec, theta: number): Vec {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** FNV-1a 32-bit hash — tiny, dependency-free, deterministic across devices.
 * Same cardId → same scatter/tilt everywhere. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── auto-placement ───────────────────────────────────────────────────────────

/** Stable default placement for a card with no persisted layout. Scatters
 * cards across the board with a small per-card tilt (deterministic in cardId),
 * so an AI- or user-added card appears at a sensible, stable spot. `index`
 * (its position in board.cardIds) seeds the z-order so later-added cards sit
 * on top. NOT persisted until the card is actually moved/resized/rotated. */
export function autoPlaceCard(cardId: string, index: number): FreeformCardLayout {
  const h = hashId(cardId);
  const fx = (h & 0xffff) / 0xffff;
  const fy = ((h >>> 16) & 0xffff) / 0xffff;
  const usableX = 1 - DEFAULT_W - 2 * MARGIN;
  const usableY = 1 - DEFAULT_H - 2 * MARGIN;
  return {
    x: MARGIN + fx * usableX,
    y: MARGIN + fy * usableY,
    w: DEFAULT_W,
    h: DEFAULT_H,
    rotation: (h % 11) - 5, // -5..+5 degrees
    z: index,
  };
}

/** Effective layout for a card: its persisted entry if present, else the
 * deterministic auto-placement. Pure — never persists. */
export function effectiveLayout(
  board: Pick<Board, 'freeform'>,
  cardId: string,
  index: number,
): FreeformCardLayout {
  return board.freeform?.[cardId] ?? autoPlaceCard(cardId, index);
}

// ── geometry ─────────────────────────────────────────────────────────────────

/** Move a card by a pointer delta expressed as board fractions, clamping the
 * top-left corner so the card stays fully on the board. */
export function moveCard(
  start: FreeformCardLayout,
  dxFrac: number,
  dyFrac: number,
): { x: number; y: number } {
  return {
    x: clamp(start.x + dxFrac, 0, 1 - start.w),
    y: clamp(start.y + dyFrac, 0, 1 - start.h),
  };
}

/** Free-resize a (possibly rotated) card by dragging `handle` toward the board
 * point `pointerFrac` (0..1 fractions). The corner/edge opposite the handle
 * stays fixed on screen. Returns the new layout in fractions.
 *
 * Math is done in design px. The card rotates about its CENTER (CSS
 * transformOrigin:center), so we hold the opposite (anchor) corner/edge fixed
 * and back-solve the new center, then emit the unrotated top-left
 * (left = cx - w/2, top = cy - h/2) WITHOUT re-applying the rotation — the
 * browser applies it for us. */
export function resizeRotatedBox(
  start: FreeformCardLayout,
  handle: Exclude<HandleId, 'rotate'>,
  pointerFrac: Vec,
): { x: number; y: number; w: number; h: number } {
  const theta = deg2rad(start.rotation);
  const W0 = start.w * BOARD_W;
  const H0 = start.h * BOARD_H;
  const x0 = start.x * BOARD_W;
  const y0 = start.y * BOARD_H;
  const C0: Vec = { x: x0 + W0 / 2, y: y0 + H0 / 2 };
  const Pm: Vec = { x: pointerFrac.x * BOARD_W, y: pointerFrac.y * BOARD_H };

  // Which local axes this handle drives, and the anchor (opposite) signs.
  let signX = 0;
  let signY = 0;
  if (handle === 'e' || handle === 'ne' || handle === 'se') signX = +1;
  if (handle === 'w' || handle === 'nw' || handle === 'sw') signX = -1;
  if (handle === 's' || handle === 'se' || handle === 'sw') signY = +1;
  if (handle === 'n' || handle === 'ne' || handle === 'nw') signY = -1;
  const anchorSignX = -signX;
  const anchorSignY = -signY;

  // Anchor point on screen (board px), fixed throughout the gesture.
  const A: Vec = {
    x: C0.x + rot({ x: anchorSignX * (W0 / 2), y: anchorSignY * (H0 / 2) }, theta).x,
    y: C0.y + rot({ x: anchorSignX * (W0 / 2), y: anchorSignY * (H0 / 2) }, theta).y,
  };

  // Pointer in the card's local (unrotated) frame, relative to the anchor.
  const local = rot({ x: Pm.x - A.x, y: Pm.y - A.y }, -theta);

  // New dimensions: distance from anchor to pointer along each driven axis.
  // Axes the handle doesn't drive keep their starting size.
  const newW = signX !== 0 ? clamp(signX * local.x, MIN_W_PX, BOARD_W) : W0;
  const newH = signY !== 0 ? clamp(signY * local.y, MIN_H_PX, BOARD_H) : H0;

  // New center, keeping the anchor fixed: step half the new box away from it
  // along the (rotated) driven axes.
  const offset = rot(
    { x: -anchorSignX * (newW / 2), y: -anchorSignY * (newH / 2) },
    theta,
  );
  const C: Vec = { x: A.x + offset.x, y: A.y + offset.y };

  return {
    x: (C.x - newW / 2) / BOARD_W,
    y: (C.y - newH / 2) / BOARD_H,
    w: newW / BOARD_W,
    h: newH / BOARD_H,
  };
}

/** Screen-space angle (radians) from a card's center to a board point. The
 * caller captures this once at grab time, then again on each move; the
 * rotation delta is (now - grab). Scale-invariant (atan2 of differences). */
export function angleToCenter(layout: FreeformCardLayout, pointerFrac: Vec): number {
  const cx = (layout.x + layout.w / 2) * BOARD_W;
  const cy = (layout.y + layout.h / 2) * BOARD_H;
  return Math.atan2(pointerFrac.y * BOARD_H - cy, pointerFrac.x * BOARD_W - cx);
}

/** New rotation (degrees) given the start rotation, the angle grabbed at the
 * rotate handle, and the current pointer angle. Snaps to 15° increments when
 * within `snapTolDeg`, and to upright when within `snapTolDeg` of 0/360. */
export function rotateCard(
  startRotation: number,
  grabAngle: number,
  currentAngle: number,
  snap = false,
  snapTolDeg = 4,
): number {
  let next = startRotation + ((currentAngle - grabAngle) * 180) / Math.PI;
  const nearestQuarter = Math.round(next / 90) * 90;
  if (snap) {
    next = Math.round(next / 15) * 15;
  } else {
    // Always gently snap to the nearest right angle / upright when very close,
    // so cards settle straight without a modifier key.
    if (Math.abs(next - nearestQuarter) <= snapTolDeg) next = nearestQuarter;
  }
  return next;
}

/** Bring a card to the front: returns a z one above the current max. */
export function nextZ(layouts: Iterable<FreeformCardLayout>): number {
  let max = 0;
  for (const l of layouts) max = Math.max(max, l.z);
  return max + 1;
}
