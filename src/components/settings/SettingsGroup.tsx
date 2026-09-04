import clsx from 'clsx';
import { ChevronIcon } from '@/components/common/icons';

/** The group's disclosure marker: right when closed, down when open. */
const Caret = ({ open }: { open: boolean }) => (
  <ChevronIcon
    size={16}
    className={clsx('shrink-0 text-brand-muted transition-transform duration-200', open && 'rotate-90')}
  />
);

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
      {/* A title bar, not another row. Colour alone did not separate the two:
          the header and the rows under it shared a size, a weight and a
          padding, so an open group read as a list of four equal things. Case,
          weight and a fill do the work that colour could not. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={clsx(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
          open
            ? 'bg-brand/10 text-brand'
            : 'text-ink-muted hover:bg-brand/5 hover:text-ink active:bg-brand/10',
        )}
      >
        <span className="flex-1 text-[13px] font-semibold uppercase tracking-wider">
          {title}
        </span>
        <Caret open={open} />
      </button>
      {open && (
        // Sunken, and indented a notch further than the bar above it, so the
        // contents sit visibly *inside* the category rather than beside it.
        <div className="bg-surface-sunken/25 border-t border-brand/15 divide-y divide-brand/10">
          {children}
        </div>
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
    <div className="px-4 py-3">
      {label && <p className="text-sm text-ink mb-2">{label}</p>}
      {hint && <p className="text-xs text-ink-muted mb-2 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

