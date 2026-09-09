import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { spaceDisplayName } from '@/services/community/spaceName';
import { useCommunityStore } from '@/store/communityStore';
import type { SharedItemKind } from '@/types/domain';

/**
 * Publish a plan or a board into one of the user's own rooms — the single copy
 * of that flow, opened from `/lists/:id` and from a board's `⋮`.
 *
 * Each room is one of three states, the same three `SpaceDetail` gives a piece:
 * **not shared here** offers Share; **shared but changed** offers Update;
 * **shared and current** says so and offers Withdraw.
 *
 * "Changed" is a **number comparison**, not a rebuilt hash: `itemSources`
 * records the source's `updatedAt` at snapshot time, so answering this for a
 * year-long plan costs nothing per render. The real hash is computed once, when
 * the user actually presses Update.
 *
 * Sharing asks the moderator first, exactly as `publishPost` does and for the
 * same reason — publishing rides the sync queue, where a refusal would
 * otherwise surface as an item that silently never shares. The server judges it
 * again in the write path, which is the check that counts.
 */
export function ShareToRoomSheet({
  kind,
  sourceId,
  sourceUpdatedAt,
  open,
  onClose,
}: {
  kind: SharedItemKind;
  /** The list's or board's id — never the shared item's, which is minted here. */
  sourceId: string;
  /** The live source's `updatedAt`, for the out-of-date comparison. */
  sourceUpdatedAt: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const profile = useCommunityStore((s) => s.profile);
  const spaces = useCommunityStore((s) => s.spaces);
  const items = useCommunityStore((s) => s.items);
  const sharedClaims = useCommunityStore((s) => s.sharedClaims);
  const itemSources = useCommunityStore((s) => s.itemSources);
  const shareList = useCommunityStore((s) => s.shareList);
  const shareBoard = useCommunityStore((s) => s.shareBoard);
  const republishItem = useCommunityStore((s) => s.republishItem);
  const withdrawItem = useCommunityStore((s) => s.withdrawItem);

  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  /** Where this source already is, by room. */
  const placed = useMemo(() => {
    const by = new Map<string, { itemId: string; stale: boolean }>();
    for (const item of items) {
      if (item.kind !== kind) continue;
      const src = itemSources[item.id];
      if (!src || src.sourceId !== sourceId) continue;
      if (sharedClaims[item.id] !== true) continue;
      by.set(item.spaceId, {
        itemId: item.id,
        stale: src.sourceUpdatedAt !== sourceUpdatedAt,
      });
    }
    return by;
  }, [items, itemSources, sharedClaims, kind, sourceId, sourceUpdatedAt]);

  const run = async (spaceId: string, fn: () => Promise<void>) => {
    setBusy(spaceId);
    setRefused(null);
    try {
      await fn();
    } catch (e) {
      // The only failure worth showing: the moderator said no, and the author
      // needs to know why at the tap rather than wondering why nothing shared.
      setRefused(
        e instanceof Error && e.message === 'content_refused'
          ? ((e as Error & { reason?: string }).reason?.trim() ||
            (t('community.moderation.refusedGeneric') as string))
          : (t('community.shareFailed') as string),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('community.shareToRoom') as string}>
      <BottomSheetBody>
        {!profile || spaces.length === 0 ? (
          <p className="px-1 py-4 text-sm text-ink-muted">{t('community.noRooms')}</p>
        ) : (
          <ul className="space-y-2 py-2">
            {spaces.map((space) => {
              const here = placed.get(space.id);
              const working = busy === space.id;
              return (
                <li
                  key={space.id}
                  className="flex items-center gap-2 rounded-xl bg-surface/60 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-sm text-brand">
                      {space.emoji ? `${space.emoji} ` : ''}
                      {spaceDisplayName(space)}
                    </span>
                    {here && (
                      <span className="block text-[11px] text-ink-muted">
                        {here.stale ? t('community.outOfDate') : t('community.sharedHere')}
                      </span>
                    )}
                  </span>

                  {here?.stale && (
                    <SheetButton
                      disabled={working}
                      onClick={() => void run(space.id, () => republishItem(here.itemId))}
                    >
                      {t('community.updateShared')}
                    </SheetButton>
                  )}
                  {here ? (
                    <SheetButton
                      subdued
                      disabled={working}
                      onClick={() => void run(space.id, () => withdrawItem(here.itemId))}
                    >
                      {t('community.withdraw')}
                    </SheetButton>
                  ) : (
                    <SheetButton
                      disabled={working}
                      onClick={() =>
                        void run(space.id, () =>
                          kind === 'plan'
                            ? shareList(sourceId, space.id)
                            : shareBoard(sourceId, space.id),
                        )
                      }
                    >
                      {t('community.shareHere')}
                    </SheetButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {refused && (
          <p className="mt-1 rounded-xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
            {refused}
          </p>
        )}
        <p className="px-1 pb-3 pt-2 text-[11px] text-ink-muted">
          {t('community.shareToRoomHint')}
        </p>
      </BottomSheetBody>
    </BottomSheet>
  );
}

function SheetButton({
  children,
  onClick,
  disabled,
  subdued = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subdued?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'h-8 shrink-0 rounded-lg px-3 text-xs transition-colors disabled:opacity-40',
        subdued
          ? 'text-ink-muted hover:text-ink'
          : 'border border-brand/40 text-brand hover:bg-brand/10',
      )}
    >
      {children}
    </button>
  );
}
