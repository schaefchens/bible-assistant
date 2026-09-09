import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

/**
 * The rows the community screens are built from.
 *
 * Their own module, named after `picker/pickerRows.tsx` and for the same
 * reason: the room index and a room's own screen draw the same thing, and one
 * of them holding the definition means the other gets a near-copy that drifts.
 * Components only — the file is a `.tsx`, and `react-refresh/only-export-components`
 * is an error here.
 */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] uppercase tracking-wider text-ink-muted">{children}</h2>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted py-2">{children}</p>;
}

export function Row({
  emoji,
  title,
  detail,
  badge,
  warn,
  onOpen,
  onRead,
  trailing,
}: {
  emoji?: string;
  title: string;
  detail: string;
  badge?: string;
  warn?: boolean;
  onOpen: () => void;
  onRead?: () => void;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-xl px-3 py-2 bg-surface-raised',
        warn && 'ring-1 ring-red-500/40',
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          {emoji && <span aria-hidden>{emoji}</span>}
          <span className="text-ink truncate">{title}</span>
          {badge && (
            <span className="text-[10px] rounded-full bg-brand text-on-brand px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
      </button>
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className="text-[11px] text-brand hover:underline px-1 shrink-0"
        >
          {t('community.read')}
        </button>
      )}
      {trailing}
    </div>
  );
}

