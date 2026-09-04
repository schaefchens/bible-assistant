/**
 * **Every icon the app draws more than once, in one place.**
 *
 * There were about forty of these, defined inline in the twenty-two
 * components that happened to need them — and duplicated across them: three
 * copies of the play triangle at three sizes, three copies of the same
 * chevron, and the gear's 700-character path written out twice. The
 * differences between copies (a stroke width of 1.8 here and 2 there) were
 * accidents rather than decisions, and a component wanting an icon had no
 * place to look for one.
 *
 * Two deliberate exceptions stay where they are, because they are *families*
 * rather than stray glyphs: the nav's five (`AppShell`, stroke 1.6, sized by
 * their slot) and eyes-free mode's chunky rounded transport (`EyesFreeMode`,
 * stroke 2.5). Both are drawn to match each other, not the rest of the app.
 */
import type { ReactNode } from 'react';

/** What every icon here accepts. `size` is both width and height in px. */
export type IconProps = { size?: number; className?: string };

/**
 * The frame every icon draws inside: a 24×24 box, stroked in `currentColor`
 * with round caps and joins, and hidden from assistive tech — an icon button
 * carries its own `aria-label`, and an icon beside a label is decoration.
 *
 * `filled` swaps stroke for fill, for the solid glyphs (play, pause, dots).
 *
 * Exported so a genuinely one-off glyph — a mark that means something in one
 * screen only — can use the frame without earning a name in this file. Reach
 * for it instead of writing the eleven-line `<svg …>` opening tag again.
 */
export function Glyph({
  size,
  stroke = 2,
  filled,
  className,
  children,
}: IconProps & { stroke?: number; filled?: boolean; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeWidth={filled ? undefined : stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ─── Transport ────────────────────────────────────────────────────────────

export const PlayIcon = ({ size = 18, className }: IconProps) => (
  <Glyph size={size} filled className={className}>
    <path d="M7 4l14 8-14 8V4z" />
  </Glyph>
);

export const PauseIcon = ({ size = 16, className }: IconProps) => (
  <Glyph size={size} filled className={className}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Glyph>
);

/** Barred triangle: a whole verse back or forward. */
export const PrevIcon = ({ size = 18, className }: IconProps) => (
  <Glyph size={size} filled className={className}>
    <path d="M6 5h2v14H6V5zm14 0v14L9 12l11-7z" />
  </Glyph>
);

export const NextIcon = ({ size = 18, className }: IconProps) => (
  <Glyph size={size} filled className={className}>
    <path d="M16 5h2v14h-2V5zM4 5l11 7L4 19V5z" />
  </Glyph>
);

/** Bare double triangle — deliberately *not* Prev/Next's barred glyph, which
 * means "whole verse", where this means "a few words". */
export const SeekIcon = ({ forward, size = 17, className }: IconProps & { forward: boolean }) => (
  <Glyph size={size} filled className={className}>
    <g transform={forward ? undefined : 'translate(24,0) scale(-1,1)'}>
      <path d="M3 5l8 7-8 7V5zm10 0l8 7-8 7V5z" />
    </g>
  </Glyph>
);

export const SpinnerIcon = ({ size = 18, className = 'animate-spin' }: IconProps) => (
  <Glyph size={size} stroke={2.5} className={className}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Glyph>
);

export const InfinityIcon = ({ size = 17, className }: IconProps) => (
  <Glyph size={size} className={className}>
    <path d="M5.5 12c0-2.2 1.8-4 4-4s3 1.2 4.5 4 3 4 4.5 4 2-1.8 2-4-1.8-4-4-4-3 1.2-4.5 4-3 4-4.5 4-2-1.8-2-4z" />
  </Glyph>
);

/** "Follow the reading": a chevron settling onto a line. */
export const FollowIcon = ({ size = 15, className }: IconProps) => (
  <Glyph size={size} className={className}>
    <polyline points="6 9 12 15 18 9" />
    <line x1="4" y1="19" x2="20" y2="19" />
  </Glyph>
);

// ─── Chrome ───────────────────────────────────────────────────────────────

/**
 * One chevron, pointed by `dir`. It replaced four near-copies: the picker's
 * disclosure caret and its row affordance, the settings group's caret, and the
 * transport sheet's collapse marker — all the same polyline, rotated.
 *
 * Rotation rather than four polylines so a caller can animate between two
 * directions with a CSS transition, which is what the disclosure carets do.
 */
export const ChevronIcon = ({
  dir = 'right',
  size = 14,
  stroke = 2,
  className,
}: IconProps & { dir?: 'up' | 'right' | 'down' | 'left'; stroke?: number }) => (
  <Glyph
    size={size}
    stroke={stroke}
    className={className}
    // The polyline points right; the rest is a quarter turn each.
  >
    <g
      transform={
        { right: undefined, down: 'rotate(90 12 12)', left: 'rotate(180 12 12)', up: 'rotate(270 12 12)' }[
          dir
        ]
      }
    >
      <polyline points="9 18 15 12 9 6" />
    </g>
  </Glyph>
);

export const CheckIcon = ({ size = 17, stroke = 2, className }: IconProps & { stroke?: number }) => (
  <Glyph size={size} stroke={stroke} className={className}>
    <polyline points="20 6 9 17 4 12" />
  </Glyph>
);

export const GearIcon = ({ size = 17, stroke = 1.8, className }: IconProps & { stroke?: number }) => (
  <Glyph size={size} stroke={stroke} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.8a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06A1.94 1.94 0 1 1 4.75 17.1l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.5a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.77l-.06-.06A1.94 1.94 0 1 1 7.4 4.81l.06.06a1.6 1.6 0 0 0 1.77.32H9.3a1.6 1.6 0 0 0 .97-1.47V3.5a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.77v.07a1.6 1.6 0 0 0 1.47.97H21a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.47.97z" />
  </Glyph>
);

export const PencilIcon = ({ size = 16, className }: IconProps) => (
  <Glyph size={size} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Glyph>
);

/** The "more" affordance: three dots, horizontal. */
export const DotsIcon = ({ size = 16, className }: IconProps) => (
  <Glyph size={size} filled className={className}>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </Glyph>
);

// ─── Reading sources ──────────────────────────────────────────────────────

/** A closed book — deliberately distinct from `AppShell`'s open one, which
 * means "the reader screen" where this means "the Bible". */
export const BookIcon = ({ size = 18, className }: IconProps) => (
  <Glyph size={size} className={className}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Glyph>
);

export const ListIcon = ({ size = 18, className }: IconProps) => (
  <Glyph size={size} className={className}>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" />
  </Glyph>
);

/** A quill, for a space — a list icon already means a reading list. */
export const QuillIcon = ({ size = 16, className }: IconProps) => (
  <Glyph size={size} stroke={1.8} className={className}>
    <path d="M4 20s2-8 8-12 8-4 8-4-1 5-4 9-7 5-9 5" />
    <path d="M4 20l4-4" />
  </Glyph>
);

/** A ribbon-style bookmark, for "report this piece". */
export const FlagIcon = ({ size = 14, className }: IconProps) => (
  <Glyph size={size} stroke={1.8} className={className}>
    <path d="M5 21V4.5c3.5-1.6 6.5.9 10-.5v9c-3.5 1.4-6.5-1.1-10 .5" />
  </Glyph>
);

// ─── Offline narration ────────────────────────────────────────────────────

export const DownloadIcon = ({ size = 17, className }: IconProps) => (
  <Glyph size={size} stroke={1.8} className={className}>
    <path d="M12 3v11" />
    <polyline points="8 11 12 15 16 11" />
    <path d="M5 19h14" />
  </Glyph>
);

/**
 * A download that failed and can be tried again — the arrow curled back on
 * itself rather than a warning triangle, because the state is "this didn't
 * land, tap to try again" and not "something is wrong with your library".
 */
export const RetryIcon = ({ size = 17, className }: IconProps) => (
  <Glyph size={size} stroke={1.8} className={className}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <polyline points="20 4 20 9 15 9" />
  </Glyph>
);

export const TrashIcon = ({ size = 17, className }: IconProps) => (
  <Glyph size={size} stroke={1.8} className={className}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </Glyph>
);

/**
 * A ring that fills as a download lands; doubles as the cancel target.
 *
 * `className` carries the size because the two callers draw it differently —
 * a narration row at `h-5`, a Bible-pack row at `h-6` — and that difference is
 * the only thing that had them keeping two copies of it.
 */
export function ProgressRing({ pct, className = 'h-5 w-5' }: { pct: number; className?: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className={`${className} -rotate-90`} aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-surface-raised" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-brand"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}
