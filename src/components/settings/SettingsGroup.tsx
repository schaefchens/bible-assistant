import clsx from 'clsx';

/**
 * A category of settings: a heading over one card.
 *
 * The settings screen had grown to nineteen flat sections in a single scroll,
 * every one of them visually identical, which made finding anything a matter of
 * reading the whole page. Grouping into a handful of titled cards is the entire
 * fix — the controls inside are unchanged.
 */
export function SettingsGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wide text-brand-muted mb-2 px-1">{title}</h3>
      <div
        className={clsx(
          'rounded-xl bg-surface-raised/30 border border-brand/15 overflow-hidden',
          // divide-y rather than gaps: adjacent rows read as one list, which is
          // what makes a tappable row look tappable.
          'divide-y divide-brand/10',
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A labelled control inside a group. For settings that stay on the page. */
export function SettingsField({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-3">
      {label && <p className="text-sm text-ink mb-2">{label}</p>}
      {hint && <p className="text-xs text-ink-muted mb-2 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}
