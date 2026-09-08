/** Shared press/drag gesture thresholds. Centralized so an accessibility
 * tweak (e.g. a longer long-press, or a larger move tolerance for motor
 * impairment) is a one-line change instead of a six-file hunt.
 *
 * Note: the card-PILE swipe gesture (CardPile.tsx) intentionally keeps its
 * own axis-lock / swipe-ratio constants — those are semantically distinct
 * from the press-and-drag thresholds here. */

/** Hold duration (ms) before a press becomes a long-press / drag. */
export const LONG_PRESS_MS = 500;

/** Movement (px) tolerated during a hold before it's treated as a drag. */
export const MOVE_TOLERANCE_PX = 6;

/** Movement (px) past which a pointer interaction counts as a drag, not a tap. */
export const DRAG_MOVE_THRESHOLD_PX = 8;
