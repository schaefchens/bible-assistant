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
