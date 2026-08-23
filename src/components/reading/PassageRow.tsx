import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

type Props = {
  /** The formatted reference — "Genesis 1-3", "Psalms 23:1-6". */
  text: string;
  /** The entry's note and/or pinned translation, shown beneath. */
  detail?: string;
  done: boolean;
  /** The passage the reader is on. */
  current: boolean;
  /** Tick it off. Omit to render the box as a plain indicator. */
  onToggle?: () => void;
  /** The row's main action — open or read this passage. */
  onOpen: () => void;
  /** Row-end controls (play, reorder, remove). */
  trailing?: React.ReactNode;
};

/**
 * One passage of a reading list.
 *
 * Shared by the list screen and the book picker so the two can't drift into
 * looking like different features — the picker had its own cramped variant, and
 * the difference was the first thing anyone noticed about it.
 */
export function PassageRow({
  text,
  detail,
  done,
  current,
  onToggle,
  onOpen,
  trailing,
}: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-xl px-2 py-1.5',
        current ? 'bg-brand/10 ring-1 ring-brand/30' : 'hover:bg-surface-raised/40',
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={done}
          aria-label={(done ? t('lists.markNotDone') : t('lists.markDone')) as string}
          className={clsx(
            'h-6 w-6 shrink-0 rounded-md border flex items-center justify-center transition-colors',
            done ? 'bg-brand border-brand text-on-brand' : 'border-ink-muted/40 text-transparent',
          )}
        >
          <CheckIcon />
        </button>
      ) : (
        <span
          aria-hidden
          className={clsx(
            'h-6 w-6 shrink-0 rounded-md border flex items-center justify-center',
            done ? 'bg-brand border-brand text-on-brand' : 'border-ink-muted/40 text-transparent',
          )}
        >
          <CheckIcon />
        </span>
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-label={t('lists.openPassage') as string}
        className="flex-1 min-w-0 text-left"
      >
        <span
          className={clsx(
            'font-serif text-[15px] truncate block',
            done ? 'text-ink-muted line-through' : 'text-ink',
          )}
        >
          {text}
        </span>
        {detail && (
          <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
        )}
      </button>

      {trailing}
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
