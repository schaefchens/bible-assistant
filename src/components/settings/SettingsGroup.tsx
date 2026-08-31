import clsx from 'clsx';

/**
 * One collapsible category of settings.
 *
 * The settings screen had grown to nineteen flat sections in a single scroll,
 * every one of them visually identical, which made finding anything a matter of
 * reading the whole page. Grouping was the first half of the fix; showing only
 * the group you are actually in is the other half — collapsed, the whole screen
 * is six taps' worth of choice instead of a wall.
 *
 * The header is the toggle, so the title is a normal-weight tappable row rather
 * than the small uppercase caption it used to be: a label you can press should
 * look like one. Contents are unmounted while closed rather than hidden, which
 * is safe here because the sheets the rows open are mounted by the page, not by
 * the group.
 */
export function SettingsGroup({
  title,
  open,
  onToggle,
  children,
  className,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        'rounded-xl bg-surface-raised/30 border border-brand/15 overflow-hidden',
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-3 text-left transition-colors',
          open ? 'text-brand' : 'text-ink hover:bg-brand/5 active:bg-brand/10',
        )}
      >
        <span className="flex-1 text-sm font-medium">{title}</span>
        <Caret open={open} />
      </button>
      {open && (
        <div className="border-t border-brand/10 divide-y divide-brand/10">{children}</div>
      )}
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

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx(
        'shrink-0 text-brand-muted transition-transform duration-200',
        open && 'rotate-90',
      )}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
