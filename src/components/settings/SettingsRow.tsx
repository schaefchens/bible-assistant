import clsx from 'clsx';

/**
 * A tappable row that opens a sheet, with its current value on the right.
 *
 * The value is the point: a settings list whose rows say only "Reading text ›"
 * answers nothing until you open all of them. Only the three groups that
 * already *had* a bottom sheet are rows — everything else stays inline, because
 * a sheet holding one checkbox is a worse place for it than the page.
 */
export function SettingsRow({
  label,
  value,
  onClick,
  ariaLabel,
}: {
  label: string;
  /** Current setting, shown right-aligned. A node so a row can carry a badge. */
  value?: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-3 text-left',
        'hover:bg-brand/5 active:bg-brand/10 transition-colors',
      )}
    >
      <span className="text-sm text-ink shrink-0">{label}</span>
      <span className="flex-1 min-w-0 text-right text-sm text-ink-muted truncate">
        {value}
      </span>
      <Chevron />
    </button>
  );
}

function Chevron() {
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
      className="shrink-0 text-brand-muted"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
