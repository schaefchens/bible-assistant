import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BoardCardsView } from '@/components/cards/BoardCardsView';
import { CardBack } from '@/components/cards/CardBack';
import { CardFace } from '@/components/cards/CardFace';
import { FlipCard } from '@/components/cards/FlipCard';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { ChevronIcon } from '@/components/common/icons';
import { ReportDialog } from './ReportDialog';
import { ROUTES } from '@/lib/appRoutes';
import { cssUrl } from '@/utils/cssUrl';
import { useCommunityStore } from '@/store/communityStore';
import type { Card, MirroredBoard } from '@/types/domain';

/**
 * Somebody else's board, read-only.
 *
 * Its own screen rather than a tab in `/cards`, and that is decided by the
 * code rather than by taste: `activeBoardId` is nulled against the user's own
 * boards in `libraryStore.init` **and** in `librarySync.pullFromServer`, so a
 * foreign tab would deselect itself on every boot and every sync. Teaching
 * those to consult the community store would put a dependency into a store
 * that has none, in the direction `onCommunityPulled()` exists to prevent.
 * Living under the room also means a withdrawn board 404s by construction.
 *
 * `BoardCardsView` is reused whole — the four view modes are the board's entire
 * value, and reimplementing them is four copies of a rule. Read-only is the
 * *absence* of the three mutating props, not no-op versions of them, so the
 * sortable is never armed and the corkboard has nothing to commit.
 *
 * Tapping a card opens it as the card it already is, in a sheet. Not
 * `CardEditor`: that is nine controlled inputs, a save that reconciles every
 * board's `cardIds`, and a delete — its read-only version is a form with
 * everything disabled, which is a shape nobody has seen in this app.
 */
export function SharedBoardView({
  mirror,
  onBack,
}: {
  mirror: MirroredBoard;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const copySharedBoard = useCommunityStore((s) => s.copySharedBoard);
  const [open, setOpen] = useState<Card | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [reporting, setReporting] = useState(false);

  const copy = async () => {
    const id = await copySharedBoard(mirror.board.id);
    // Straight to the copy, which is the thing the user wanted.
    if (id) navigate(ROUTES.cards);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common.back') as string}
          className="text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <ChevronIcon dir="left" size={20} />
        </button>
        <h1 className="flex-1 min-w-0 font-serif text-brand text-lg truncate">
          {mirror.board.emoji ? `${mirror.board.emoji} ` : ''}
          {mirror.board.name || t('boards.title')}
        </h1>
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="h-8 px-2 shrink-0 rounded-lg text-xs text-ink-muted hover:text-ink transition-colors"
        >
          {t('community.report')}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="h-8 px-3 shrink-0 rounded-lg border border-brand/40 text-brand text-sm hover:bg-brand/10 transition-colors"
        >
          {t('boards.makeCopy')}
        </button>
      </header>

      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={
          mirror.board.background
            ? { backgroundImage: cssUrl(mirror.board.background), backgroundSize: 'cover' }
            : undefined
        }
      >
        <p className="px-4 pt-3 text-[12px] text-ink-muted">
          {t('boards.readOnly', { author: mirror.author })}
        </p>
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
      </div>

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
    </div>
  );
}
