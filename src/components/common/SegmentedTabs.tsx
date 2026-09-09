import clsx from 'clsx';

/**
 * One row, several views, one of them showing.
 *
 * `aria-pressed` buttons rather than ARIA tabs, matching what this app already
 * does elsewhere — the `/cards` strip is buttons too — which also keeps every
 * spec on `getByRole('button')`.
 *
 * The count lives on the label because with the other views hidden it is the
 * only thing that says whether there is anything behind them, and the dot
 * carries an accessible name rather than being decoration: it is the whole
 * signal that a hidden view has something new in it, and a screen reader would
 * otherwise hear two tabs identical but for a number.
 */
export type Segment<K extends string> = {
  key: K;
  label: string;
  count?: number;
  /** Present ⇒ show a dot, and say this. */
  dot?: string;
};

export function SegmentedTabs<K extends string>({
  segments,
  active,
  onSelect,
  className,
}: {
  segments: Segment<K>[];
  active: K;
  onSelect: (key: K) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex gap-1 rounded-xl bg-surface-raised p-1', className)}>
      {segments.map((seg) => {
        const on = seg.key === active;
        return (
          <button
            key={seg.key}
            type="button"
            onClick={() => onSelect(seg.key)}
            aria-pressed={on}
            className={clsx(
              'flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5',
              'text-xs transition-colors',
              on ? 'bg-brand text-on-brand' : 'text-ink-muted hover:text-ink',
            )}
          >
            <span className="truncate">{seg.label}</span>
            {seg.count !== undefined && (
              <span className="shrink-0 opacity-60">{seg.count}</span>
            )}
            {seg.dot && (
              <span
                aria-label={seg.dot}
                className={clsx(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  on ? 'bg-on-brand' : 'bg-brand',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
