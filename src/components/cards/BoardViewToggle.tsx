import { useTranslation } from 'react-i18next';
import type { BoardViewMode } from '@/types/domain';

type Props = {
  mode: BoardViewMode;
  onChange: (mode: BoardViewMode) => void;
};

const MODES: { mode: BoardViewMode; glyph: string }[] = [
  { mode: 'grid', glyph: '▦' },
  { mode: 'stack', glyph: '▤' },
  { mode: 'pile', glyph: '▢' },
];

export function BoardViewToggle({ mode, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-md shadow-lg border border-navy-soft/70 px-1.5 py-1.5"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)' }}
      role="group"
      aria-label={t('boards.view.switchTo') as string}
    >
      {MODES.map(({ mode: m, glyph }) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={active}
            aria-label={t(`boards.view.${m}`) as string}
            className={[
              'w-10 h-10 inline-flex items-center justify-center rounded-full text-lg leading-none transition-colors',
              active
                ? 'bg-gold/90 text-navy-deep'
                : 'text-cream-dim hover:text-cream hover:bg-white/10',
            ].join(' ')}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
