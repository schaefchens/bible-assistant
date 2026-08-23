import type { CardColor } from '@/types/domain';

export type CardColorClasses = {
  bg: string;
  fg: string;
  fgDim: string;
  swatch: string;
};

export function colorClasses(color?: CardColor): CardColorClasses {
  switch (color ?? 'none') {
    case 'yellow':
      return {
        bg: 'bg-card-yellow-bg',
        fg: 'text-card-yellow-fg',
        fgDim: 'text-card-yellow-fg/70',
        swatch: 'bg-card-yellow-bg',
      };
    case 'amber':
      return {
        bg: 'bg-card-amber-bg',
        fg: 'text-card-amber-fg',
        fgDim: 'text-card-amber-fg/70',
        swatch: 'bg-card-amber-bg',
      };
    case 'coral':
      return {
        bg: 'bg-card-coral-bg',
        fg: 'text-card-coral-fg',
        fgDim: 'text-card-coral-fg/70',
        swatch: 'bg-card-coral-bg',
      };
    case 'rose':
      return {
        bg: 'bg-card-rose-bg',
        fg: 'text-card-rose-fg',
        fgDim: 'text-card-rose-fg/70',
        swatch: 'bg-card-rose-bg',
      };
    case 'lavender':
      return {
        bg: 'bg-card-lavender-bg',
        fg: 'text-card-lavender-fg',
        fgDim: 'text-card-lavender-fg/70',
        swatch: 'bg-card-lavender-bg',
      };
    case 'sage':
      return {
        bg: 'bg-card-sage-bg',
        fg: 'text-card-sage-fg',
        fgDim: 'text-card-sage-fg/70',
        swatch: 'bg-card-sage-bg',
      };
    case 'sky':
      return {
        bg: 'bg-card-sky-bg',
        fg: 'text-card-sky-fg',
        fgDim: 'text-card-sky-fg/70',
        swatch: 'bg-card-sky-bg',
      };
    case 'none':
    default:
      return {
        bg: 'bg-card-none-bg',
        fg: 'text-card-none-fg',
        fgDim: 'text-card-none-fg/70',
        swatch: 'bg-card-none-bg',
      };
  }
}

export type BoardTabClasses = {
  /** Classes for the active tab (background + text + border). */
  active: string;
  /** Classes for an inactive tab (background + text + border + hover). */
  inactive: string;
};

// Hard-coded class strings so Tailwind's content scanner picks them up.
// Active tabs use the color's full bg/fg; inactive tabs use a faint tint of
// the color so each board's tab is still identifiable even when not selected.
export function boardTabClasses(color?: CardColor): BoardTabClasses {
  switch (color ?? 'none') {
    case 'yellow':
      return {
        active:
          'bg-card-yellow-bg text-card-yellow-fg border-card-yellow-bg shadow-[0_-2px_8px_-2px_rgba(212,186,107,0.4)]',
        inactive:
          'bg-card-yellow-bg/25 text-ink-muted border-card-yellow-bg/40 hover:bg-card-yellow-bg/50 hover:text-card-yellow-fg',
      };
    case 'amber':
      return {
        active:
          'bg-card-amber-bg text-card-amber-fg border-card-amber-bg shadow-[0_-2px_8px_-2px_rgba(207,152,102,0.4)]',
        inactive:
          'bg-card-amber-bg/25 text-ink-muted border-card-amber-bg/40 hover:bg-card-amber-bg/50 hover:text-card-amber-fg',
      };
    case 'coral':
      return {
        active:
          'bg-card-coral-bg text-card-coral-fg border-card-coral-bg shadow-[0_-2px_8px_-2px_rgba(210,138,138,0.4)]',
        inactive:
          'bg-card-coral-bg/25 text-ink-muted border-card-coral-bg/40 hover:bg-card-coral-bg/50 hover:text-card-coral-fg',
      };
    case 'rose':
      return {
        active:
          'bg-card-rose-bg text-card-rose-fg border-card-rose-bg shadow-[0_-2px_8px_-2px_rgba(201,138,175,0.4)]',
        inactive:
          'bg-card-rose-bg/25 text-ink-muted border-card-rose-bg/40 hover:bg-card-rose-bg/50 hover:text-card-rose-fg',
      };
    case 'lavender':
      return {
        active:
          'bg-card-lavender-bg text-card-lavender-fg border-card-lavender-bg shadow-[0_-2px_8px_-2px_rgba(168,157,207,0.4)]',
        inactive:
          'bg-card-lavender-bg/25 text-ink-muted border-card-lavender-bg/40 hover:bg-card-lavender-bg/50 hover:text-card-lavender-fg',
      };
    case 'sage':
      return {
        active:
          'bg-card-sage-bg text-card-sage-fg border-card-sage-bg shadow-[0_-2px_8px_-2px_rgba(143,178,159,0.4)]',
        inactive:
          'bg-card-sage-bg/25 text-ink-muted border-card-sage-bg/40 hover:bg-card-sage-bg/50 hover:text-card-sage-fg',
      };
    case 'sky':
      return {
        active:
          'bg-card-sky-bg text-card-sky-fg border-card-sky-bg shadow-[0_-2px_8px_-2px_rgba(136,179,216,0.4)]',
        inactive:
          'bg-card-sky-bg/25 text-ink-muted border-card-sky-bg/40 hover:bg-card-sky-bg/50 hover:text-card-sky-fg',
      };
    case 'none':
    default:
      return {
        active:
          'bg-surface-raised text-brand border-brand/60 shadow-[0_-2px_8px_-2px_rgb(var(--brand)/0.25)]',
        inactive:
          'bg-surface-sunken/70 text-ink-muted border-surface-raised/70 hover:bg-surface-raised/70 hover:text-ink',
      };
  }
}
