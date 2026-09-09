import { useState } from 'react';
import clsx from 'clsx';
import { CheckIcon, ChevronIcon, PencilIcon, PlayIcon } from '@/components/common/icons';

/**
 * The picker's shared furniture: the row shapes and the named glyphs its three
 * source views are built from.
 *
 * Presentational only — nothing here reads a store or knows what a reading
 * source is. The three view modules (`ScriptureViews`, `ListViews`,
 * `SpaceViews`) supply the meaning.
 */

// Named wrappers over the shared glyphs, so a call site says what the mark
// *means* here rather than restating its size and stroke every time.

/** A group's disclosure marker: right when closed, down when open. */
const Caret = ({ open }: { open: boolean }) => (
  <ChevronIcon
    size={14}
    stroke={2.4}
    className={clsx('text-brand-muted shrink-0 transition-transform', open && 'rotate-90')}
  />
);

/** A row that leads somewhere. */
export const ChevronRight = () => <ChevronIcon size={18} className="text-ink-muted shrink-0" />;

/** Small enough to sit inside a row's label. */
export const PlayGlyph = () => <PlayIcon size={11} />;

export const CheckMark = ({ className }: { className?: string }) => (
  <CheckIcon size={12} stroke={3.5} className={className} />
);

/** The band a selector row sits in, at the head of the sheet. */
export function PickerBand({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pb-3 border-b border-surface-raised/40">{children}</div>;
}

/** The scrolling body of a view. */
export function PickerBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe">{children}</div>;
}

/**
 * The row that says which list or space the app is reading through, and lets
 * you change it.
 *
 * One component for both because they were two near-identical copies — same
 * container, same three controls, differing only in glyph, label and where the
 * pencil goes. Both write `readerStore.source`, so they are mutually exclusive
 * for free: locking one unlocks the other.
 *
 * `onClear` is what makes the lock escapable. With a source selected the sheet
 * shows that source's passages *instead of* the book columns, so there is no
 * longer a chapter tap to imply "I've left the list" — clearing it has to be
 * its own control.
 */
export function LockedSourceRow({
  icon,
  label,
  locked,
  onOpen,
  onManage,
  manageIcon,
  manageLabel,
  onClear,
  clearLabel,
}: {
  icon: React.ReactNode;
  label: string;
  /** Something is selected: the row names it rather than inviting a choice. */
  locked: boolean;
  onOpen: () => void;
  onManage: () => void;
  /**
   * Defaults to a pencil, which is right whenever the manage target can be
   * edited. Somebody else's shared plan cannot, and a pencil on it is a promise
   * the screen does not keep — that row passes a chevron instead.
   */
  manageIcon?: React.ReactNode;
  manageLabel: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1 rounded-xl pl-3 pr-1.5 py-1',
        'bg-surface/60 border transition-colors',
        locked ? 'border-brand/60' : 'border-brand/30 hover:border-brand/60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 flex items-center gap-3 py-1.5 text-left"
      >
        {icon}
        <span className="flex-1 min-w-0 font-serif text-brand text-sm truncate">{label}</span>
        {!locked && <ChevronRight />}
      </button>

      <button
        type="button"
        onClick={onManage}
        aria-label={manageLabel}
        title={manageLabel}
        className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors"
      >
        {manageIcon ?? <PencilIcon />}
      </button>

      {locked && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors text-xl leading-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * One selectable source in a list of them.
 *
 * The background and hover live on the *wrapper*, not the button, so a row can
 * carry a control of its own (`trailing`) beside the tap target rather than
 * inside it — a button in a button is invalid, and here it would mean
 * downloading a selection was one mis-tap away from opening it.
 */
export function SourceRow({
  label,
  emoji,
  detail,
  onSelect,
  trailing,
  disabled = false,
}: {
  label: string;
  emoji?: string;
  detail: string;
  onSelect: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1 rounded-xl bg-surface/60 transition-colors',
        !disabled && 'hover:bg-brand/10',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex-1 min-w-0 text-left px-3 py-2 disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          {emoji && <span aria-hidden>{emoji}</span>}
          <span className="font-serif text-brand text-sm truncate">{label}</span>
        </span>
        <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
      </button>
      {trailing && <span className="shrink-0 pr-1.5">{trailing}</span>}
    </div>
  );
}

/**
 * Several of one author's spaces behind a single row.
 *
 * **Closed by default**, because the whole point is a shorter list: someone who
 * follows five people with three spaces each was looking at fifteen rows where
 * five will do. The count is on the closed row so a collapsed group still says
 * how much is inside it.
 *
 * A component rather than a branch in the loop, so each group owns its own open
 * state — a hook cannot live inside a `map`.
 */
export function AuthorGroup({
  ownerName,
  detail,
  children,
}: {
  ownerName: string;
  detail: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 rounded-xl bg-surface/60 hover:bg-brand/10 transition-colors flex items-center gap-2"
      >
        <Caret open={open} />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-brand text-sm truncate">{ownerName}</span>
          <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
        </span>
      </button>
      {/* Indented under a rule, so a space inside a group is unmistakably one of
          that author's rather than the next row down. */}
      {open && (
        <ul className="mt-1 mb-1 ml-3 pl-2 space-y-1 border-l border-brand/20">{children}</ul>
      )}
    </li>
  );
}

/**
 * Step one day (or one page). Shows where it goes when there's a name for it —
 * "‹ Day 1" beats a bare chevron for knowing whether stepping back is worth it.
 */
export function PagerButton({
  onClick,
  disabled,
  label,
  side,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  side: 'start' | 'end';
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        'flex items-center gap-1 min-w-0 max-w-[38%] shrink h-7 px-1.5 rounded-lg',
        'text-[11px] uppercase tracking-wider text-ink-muted',
        'hover:bg-brand/10 hover:text-brand disabled:opacity-25 disabled:pointer-events-none transition-colors',
        side === 'end' && 'flex-row-reverse',
      )}
    >
      <span className="text-base leading-none">{side === 'start' ? '‹' : '›'}</span>
      {children && <span className="flex items-center gap-1 min-w-0">{children}</span>}
    </button>
  );
}

/** Nothing to show, said in the sheet's own voice. */
export function PickerEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-ink-muted text-sm leading-relaxed">{children}</p>
  );
}
