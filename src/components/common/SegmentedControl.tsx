type Props<T extends string> = {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  cols?: 2 | 3;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  cols = 2,
}: Props<T>) {
  const colsCls = cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid ${colsCls} bg-surface-raised rounded-xl p-1`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.title}
          className={
            'py-2 text-sm rounded-lg transition-colors ' +
            (value === opt.value ? 'bg-brand text-on-brand' : 'text-ink-muted hover:text-ink')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
