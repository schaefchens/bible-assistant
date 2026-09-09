import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardCardsView } from '@/components/cards/BoardCardsView';
import { CardBack } from '@/components/cards/CardBack';
import { CardFace } from '@/components/cards/CardFace';
import { FlipCard } from '@/components/cards/FlipCard';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { ReportDialog } from './ReportDialog';
import { useCommunityStore } from '@/store/communityStore';
import type { Card, MirroredBoard } from '@/types/domain';

/**
 * Somebody else's board, read-only — the body under `/cards`' tab strip when a
 * shared tab is showing.
 *
 * **It used to be its own screen off the room**, because a foreign board could
 * not be a tab: `activeBoardId` is nulled against the user's own boards in
 * `libraryStore.init` and again in `librarySync.pullFromServer`, so a foreign
 * id put there would deselect itself on every boot and every sync. What changed
 * is that the id never goes there — `CardsPage` holds a shared selection in the
 * *route* instead, so both null-outs stay true and `libraryStore` still needs no
 * sight of the community store. The screen off the room went with it: two
 * renderers for one board is the duplication this codebase keeps paying for, so
 * the room's board row now links here.
 *
 * `BoardCardsView` is reused whole — the four view modes are the board's entire
 * value, and reimplementing them is four copies of a rule. Read-only is the
 * *absence* of the three mutating props, not no-op versions of them, so the
 * sortable is never armed and the corkboard has nothing to commit. The board is
 * shown in the **author's** view mode, with no toggle: switching it writes
 * `board.viewMode`, and there is nothing here to write to.
 *
 * Tapping a card opens it as the card it already is, in a sheet. Not
 * `CardEditor`: that is nine controlled inputs, a save that reconciles every
 * board's `cardIds`, and a delete — its read-only version is a form with
 * everything disabled, which is a shape nobody has seen in this app.
 *
 * The byline row is the whole of this screen's chrome, and it earns being one
 * row: whose board this is, and the only two things a reader can do about it.
 * They are not in the strip's `⋮` because that menu is about *your* boards.
 */
export function SharedBoardView({
  mirror,
  onCopied,
}: {
  mirror: MirroredBoard;
  /** Where a fork lands is the page's business, not this component's — it is
   * an own board from the moment it exists, and belongs in its own tab. */
  onCopied: (boardId: string) => void;
}) {
  const { t } = useTranslation();
  const copySharedBoard = useCommunityStore((s) => s.copySharedBoard);
  const [open, setOpen] = useState<Card | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [reporting, setReporting] = useState(false);

  const copy = async () => {
    const id = await copySharedBoard(mirror.board.id);
    if (id) onCopied(id);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3">
        <p className="flex-1 min-w-0 truncate text-[12px] text-ink-muted">
          {t('boards.readOnly', { author: mirror.author })}
        </p>
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="h-8 shrink-0 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:text-ink"
        >
          {t('community.report')}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="h-8 shrink-0 rounded-lg border border-brand/40 px-3 text-sm text-brand transition-colors hover:bg-brand/10"
        >
          {t('boards.makeCopy')}
        </button>
      </div>

      <BoardCardsView
        board={mirror.board}
        // The board's own cards, shipped with it. The count is *exact* here,
        // unlike `/cards`: a shared board carries its cards, so the "stored
        // ids overcount" rule that `boardCounts` works around cannot apply.
        cards={mirror.cards}
        editMode={false}
        onOpen={(card) => {
          setFlipped(false);
          setOpen(card);
        }}
      />

      <BottomSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.title || (t('cards.untitled') as string)}
      >
        <BottomSheetBody>
          {open && (
            <button
              type="button"
              onClick={() => setFlipped((v) => !v)}
              aria-label={t('cards.flip') as string}
              className="block w-full aspect-[3/4] max-h-[60vh] mx-auto"
            >
              <FlipCard
                flipped={flipped}
                front={<CardFace card={open} size="full" isActive />}
                back={<CardBack card={open} isActive />}
              />
            </button>
          )}
        </BottomSheetBody>
      </BottomSheet>

      {reporting && (
        <ReportDialog
          code={mirror.code}
          postId={mirror.itemId}
          title={mirror.board.name || (t('boards.title') as string)}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
