import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '@/lib/appRoutes';
import { openSelectionInReader } from '@/lib/spacePlayback';
import { todayPosts, unseenPosts } from '@/services/community/spaceReading';
import { useCommunityStore } from '@/store/communityStore';

/**
 * The two cross-space readings: everything you have not seen, and today's
 * pieces from everyone you follow.
 *
 * Both are *selections* — a fixed set of pieces, snapshotted when tapped — not
 * saved views. Tapping again later gives you a fresh one, which is what makes
 * "everything new" empty out as you work through it.
 *
 * "Today" is not filtered by seen: asking for today's pieces is a request for
 * today's, not for what is left of them.
 */
export function NewPiecesBar({
  compact = false,
  onOpened,
}: {
  compact?: boolean;
  /** Called once a reading has actually opened — the picker uses it to close. */
  onOpened?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Subscribed to rather than read once: publishing, a feed refresh, or reading
  // a piece all change what these buttons offer.
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);
  const seen = useCommunityStore((s) => s.seen);

  const { unseen, today } = useMemo(
    () => ({ unseen: unseenPosts(), today: todayPosts() }),
    // The selectors read the store directly; these are what change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscriptions, feed, seen],
  );

  if (subscriptions.length === 0) return null;

  const open = async (label: string, ids: string[]) => {
    const ok = await openSelectionInReader(label, ids, false);
    if (!ok) return;
    onOpened?.();
    navigate(ROUTES.read);
  };

  return (
    <div className={compact ? 'flex gap-2 flex-wrap' : 'flex gap-2 flex-wrap pt-1'}>
      <Pill
        disabled={unseen.length === 0}
        label={
          unseen.length === 0
            ? (t('community.nothingNew') as string)
            : (t('community.allNewCount', { count: unseen.length }) as string)
        }
        onClick={() => void open(t('community.allNew'), unseen.map((p) => p.post.id))}
      />
      {today.length > 0 && (
        <Pill
          label={t('community.todayAllCount', { count: today.length }) as string}
          onClick={() => void open(t('community.todayAll'), today.map((p) => p.post.id))}
        />
      )}
    </div>
  );
}

function Pill({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-full text-xs bg-brand/15 text-ink ring-1 ring-brand/30 disabled:bg-surface-raised disabled:text-ink-muted disabled:ring-0 transition-colors"
    >
      {label}
    </button>
  );
}
