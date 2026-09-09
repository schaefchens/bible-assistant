import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { SharedItemKind } from '@/types/domain';

/**
 * Put one of your own plans or boards on this shelf.
 *
 * The inverse of `ShareToRoomSheet`, which starts from the plan and picks a
 * shelf. Both exist because both journeys are real — "share this plan" from
 * the plan's own screen, and "fill this shelf" from the shelf's — and neither
 * reads as the other backwards.
 *
 * It lists only what is **not already here**: a row offering to share something
 * that is already on the shelf would need a second state and a second verb,
 * and the shelf's own tab already carries Update, Withdraw and Delete for the
 * things it holds. The two empty cases are told apart, because "you have none"
 * and "they are all here already" want different next moves.
 */
export function AddToShelfSheet({
  kind,
  spaceId,
  open,
  onClose,
}: {
  kind: SharedItemKind;
  spaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const readingLists = useLibraryStore((s) => s.readingLists);
  const boards = useLibraryStore((s) => s.boards);
  const items = useCommunityStore((s) => s.items);
  const sharedClaims = useCommunityStore((s) => s.sharedClaims);
  const itemSources = useCommunityStore((s) => s.itemSources);
  const shareList = useCommunityStore((s) => s.shareList);
  const shareBoard = useCommunityStore((s) => s.shareBoard);

  const sources = kind === 'plan' ? readingLists : boards;

  /** Source ids already on this shelf, so they are not offered twice. */
  const here = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.spaceId !== spaceId || item.kind !== kind) continue;
      if (sharedClaims[item.id] !== true) continue;
      const src = itemSources[item.id];
      if (src) ids.add(src.sourceId);
    }
    return ids;
  }, [items, itemSources, sharedClaims, spaceId, kind]);

  const offer = sources.filter((s) => !here.has(s.id));

  const share = async (id: string) => {
    await (kind === 'plan' ? shareList(id, spaceId) : shareBoard(id, spaceId));
    onClose();
  };

  const title = t(kind === 'plan' ? 'community.addPlan' : 'community.addBoard') as string;

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <BottomSheetBody>
        {sources.length === 0 ? (
          <p className="px-1 py-4 text-sm text-ink-muted">
            {t(kind === 'plan' ? 'community.noPlansToShare' : 'community.noBoardsToShare')}
          </p>
        ) : offer.length === 0 ? (
          <p className="px-1 py-4 text-sm text-ink-muted">{t('community.allShared')}</p>
        ) : (
          <ul className="space-y-2 py-2">
            {offer.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => void share(source.id)}
                  className="w-full rounded-xl bg-surface/60 px-3 py-2 text-left transition-colors hover:bg-brand/10"
                >
                  <span className="flex items-center gap-2">
                    {source.emoji && <span aria-hidden>{source.emoji}</span>}
                    <span className="truncate font-serif text-sm text-brand">
                      {source.name || t('lists.untitled')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-1 pb-3 pt-2 text-[11px] text-ink-muted">
          {t('community.shareToRoomHint')}
        </p>
      </BottomSheetBody>
    </BottomSheet>
  );
}
