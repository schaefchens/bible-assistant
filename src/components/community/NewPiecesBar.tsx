import { useTranslation } from 'react-i18next';
import { NarrationGroupButton } from '@/components/reader/NarrationGroupButton';
import { useNewPieceSelections, type PieceSelection } from '@/hooks/useNewPieceSelections';

/**
 * The two cross-space readings as pills: everything you have not seen, and
 * today's pieces from everyone you follow.
 *
 * What they *are* lives in `useNewPieceSelections` — this is one of two
 * presentations. The other is a pair of rows at the head of the picker's spaces
 * list, where they are the first two things you can select.
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
  const { hasSubscriptions, allNew, today } = useNewPieceSelections(onOpened);

  if (!hasSubscriptions) return null;

  return (
    <div className={compact ? 'flex gap-2 flex-wrap' : 'flex gap-2 flex-wrap pt-1'}>
      <Selection
        selection={allNew}
        label={
          allNew.posts.length === 0
            ? (t('community.nothingNew') as string)
            : (t('community.allNewCount', { count: allNew.posts.length }) as string)
        }
      />
      {today.posts.length > 0 && (
        <Selection
          selection={today}
          label={t('community.todayAllCount', { count: today.posts.length }) as string}
        />
      )}
    </div>
  );
}

/**
 * One selection: the pill that opens it, and a download beside it.
 *
 * The download is `compact` because the pill has already named what it covers,
 * and it is a *sibling* rather than something inside the pill — a button in a
 * button is invalid, and a download is not what tapping "everything new"
 * should mean. It renders nothing on the device voice, or for a selection of
 * one piece (that piece's own row is where to get it).
 */
function Selection({ selection, label }: { selection: PieceSelection; label: string }) {
  const { t } = useTranslation();
  const empty = selection.posts.length === 0;
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={selection.open}
        disabled={empty}
        className="px-3 py-1.5 rounded-full text-xs bg-brand/15 text-ink ring-1 ring-brand/30 disabled:bg-surface-raised disabled:text-ink-muted disabled:ring-0 transition-colors"
      >
        {label}
      </button>
      {!empty && (
        <NarrationGroupButton
          compact
          subjects={selection.subjects}
          label={t('read.narration.downloadSelection', { name: label }) as string}
        />
      )}
    </span>
  );
}
