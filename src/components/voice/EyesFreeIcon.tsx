/**
 * Target / "tap me anywhere" glyph for the hands-free toggle: a ring with four
 * radial ticks and a filled centre dot while the mode is on.
 *
 * Shared, because the mode now has two entry points — the chat header and the
 * docked mic bar — and a mode with two glyphs reads as two features.
 */
export function EyesFreeIcon({
  active,
  size = 18,
}: {
  active: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" fill={active ? 'currentColor' : 'none'} />
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </svg>
  );
}
