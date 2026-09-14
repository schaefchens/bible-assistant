import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { BoardEditor, type BoardValues } from './BoardEditor';
import { AllCardsTab, MenuItem, SharedTab, SortableTab } from './libraryTabParts';
import { LIBRARY_TABS_ATTR } from '@/lib/boardTabDrop';
import type { CardDragState } from '@/hooks/useCardTabDrop';
import {
  DRAG_MOVE_THRESHOLD_PX,
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
} from '@/lib/gestureConstants';
import type { Board, BoardOrientation, CardColor, MirroredBoard } from '@/types/domain';

type MenuMode = null | 'root' | 'new' | 'rename';

/**
 * Which of the three kinds of tab is showing.
 *
 * A union rather than "a board id, or `null` for All cards", because the strip
 * now holds a third kind and the difference is not cosmetic: the board actions
 * apply to an **own** board and to nothing else. Written as one nullable id,
 * every one of those actions would be gated on "is this id in `boards`?" — true
 * for the wrong reason on a shared tab, which is exactly the accidental
 * correctness this shape exists to avoid.
 */
export type TabSelection =
  | { kind: 'all' }
  | { kind: 'own'; id: string }
  | { kind: 'shared'; itemId: string };

/**
 * The file-folder tab strip across the top of the library screen: "All cards"
 * on the left, then one tab per board, then the contextual controls and the ⋮
 * menu (new / rename / add-cards / delete, plus the inline BoardEditor). Every
 * mutation is delegated to props.
 *
 * Three kinds of tab, and {@link TabSelection} says which is showing: All
 * cards, one of the user's own boards, and — trailing, after a rule — a board
 * somebody else shares with them. `{ kind: 'all' }` mirrors
 * `activeBoardId === null` in the store; a shared tab is **not** in that store
 * field at all, which is what lets it exist (see `CardsPage`).
 *
 * All cards is a **sibling** of the scrolling strip rather than an item in it,
 * which is what keeps it on screen however many boards there are, out of
 * `boardOrder`'s sortable, and clear of the long-press-to-rename gesture —
 * three guards that would otherwise have to be written and then kept right.
 *
 * It is `sticky` because switching board after scrolling shouldn't mean
 * scrolling back up first — and because a card can be carried onto a tab to
 * join that board (`useCardTabDrop`), and a drop target you have to scroll to
 * reach is no target. Its `z` sits between CardStack's raised card (999) and a
 * dragging one (2000), so a raised card passes under the tabs and a carried
 * one over them.
 *
 * **The board strip scrolls horizontally, and that is the browser's job, not
 * this component's.** What it has to do is stay out of the way: the tabs cover
 * their own scroller, so their `touch-action` decides whether a swipe pans at
 * all — which is why the sensors are `CardStack`'s pair and not a
 * `PointerSensor` — and the native scrollbar is left visible, so a wheel mouse
 * has something to drag.
 */
export function LibraryTabs({
  boards,
  sharedBoards,
  active,
  cardCount,
  boardCounts,
  onSelect,
  onNewCard,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
  onRequestAddCards,
  onSelectShared,
  onShareBoard,
  showEditToggle = false,
  editMode = false,
  onToggleEditMode,
  orientation,
  onToggleOrientation,
  cardDrag = null,
  flashBoardId = null,
}: {
  boards: Board[];
  /** Boards other people share with the user, in their own trailing region. */
  sharedBoards: MirroredBoard[];
  /** Which tab is showing — see {@link TabSelection}. */
  active: TabSelection;
  /** Live cards in total — the All-cards tab's count. */
  cardCount: number;
  /** Live cards per board id. Not `board.cardIds.length`: deleting a card
   * doesn't rewrite the boards holding it, so that would overcount. */
  boardCounts: Map<string, number>;
  /** Awaited on the long-press path, so the rename editor that opens right
   * after sees the long-pressed board as the active one. */
  onSelect: (id: string | null) => Promise<void>;
  /** Show somebody else's board. Separate from `onSelect` because it is a
   * different kind of state: an own selection is persisted in the library, a
   * shared one lives in the route. */
  onSelectShared: (itemId: string) => void;
  onNewCard: () => void;
  onCreate: (values: BoardValues) => Promise<void>;
  onEdit: (values: BoardValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onReorder: (fromId: string, toId: string) => Promise<void>;
  onRequestAddCards: () => void;
  /**
   * Share the active board into one of the user's rooms. Absent when there is
   * no community profile, which is what hides the menu row entirely rather
   * than offering something that cannot work.
   */
  onShareBoard?: () => void;
  /** Show the corkboard arrange/view toggle (only meaningful in freeform view). */
  showEditToggle?: boolean;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  /** Active board's corkboard orientation; the flip button shows only while
   * arranging (editMode). */
  orientation?: BoardOrientation;
  onToggleOrientation?: () => void;
  /** A card being carried over the strip (`useCardTabDrop`): non-null arms
   * every board tab, and `overBoardId` is the one under the finger. */
  cardDrag?: CardDragState | null;
  /** A board a card just landed on, ringed briefly — the list doesn't change
   * on a drop, so this and the count are the only evidence it worked. */
  flashBoardId?: string | null;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuMode>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // MouseSensor + TouchSensor (not PointerSensor), matching `CardStack`: a
  // PointerSensor needs `touch-action: none` on every draggable to keep the
  // gesture once it activates, and that is precisely what stopped the strip
  // panning — with the tabs filling it, there was nowhere left to swipe. These
  // two hold the long-press delay while leaving the pan to the browser until
  // the drag actually starts.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: MOVE_TOLERANCE_PX,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: MOVE_TOLERANCE_PX,
      },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const moved = Math.hypot(delta.x, delta.y) > DRAG_MOVE_THRESHOLD_PX;
    const id = String(active.id);
    if (!moved) {
      // Long-press release without movement → activate then open rename so
      // the editor sees the long-pressed board as active.
      await onSelect(id);
      setMenu('rename');
      return;
    }
    if (over && active.id !== over.id) {
      void onReorder(id, String(over.id));
    }
  };

  useEffect(() => {
    if (!menu) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    // Escape is live immediately; only the *pointer* listener is deferred.
    //
    // The deferral exists because the pointerdown that opened the menu is
    // still in flight and would close it again on the document handler — a
    // reason that has nothing to do with keys. Sweeping the key listener into
    // the same timeout left a window in which the menu was already painted and
    // Escape silently did nothing: measured at one animation frame, and
    // reliably reproducible by pressing ⋮ and hitting Escape straight after.
    // It is also what made `a-room-is-a-shelf` leak an open menu into the next
    // test, where it covered the button that test was trying to press.
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointer);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // The user's *own* active board, and nothing else — every board action below
  // is gated on this rather than on "a tab is selected", which is what keeps a
  // shared tab from being disabled merely by accident.
  const activeBoard = active.kind === 'own' ? boards.find((b) => b.id === active.id) : undefined;
  const hasActive = Boolean(activeBoard);
  const activeShared =
    active.kind === 'shared' ? sharedBoards.find((m) => m.itemId === active.itemId) : undefined;
  // Tint the baseline rail to the active board's color so the active tab
  // visually merges into it (file-folder seam disappears). All cards has no
  // color, so it lands on the brand rail the cards screen always had. A shared
  // board keeps its author's colour: it is that board's identity, and the guest
  // mark is what says whose it is.
  const railBorder = railBorderClass((activeBoard ?? activeShared?.board)?.color);

  return (
    // Opaque unconditionally: it has to hide the content sliding under it, and
    // that also confines a board's background image to the area below the tabs.
    <div
      className={`sticky top-0 z-[1000] bg-surface border-b-2 ${railBorder}`}
      ref={wrapperRef}
      {...{ [LIBRARY_TABS_ATTR]: '' }}
    >
      <div className="flex items-stretch">
        <div className="shrink-0 flex items-end pl-2 pt-2">
          <AllCardsTab
            label={t('cards.allCards')}
            count={cardCount}
            countLabel={t('boards.cardCount', { count: cardCount })}
            isActive={active.kind === 'all'}
            onSelect={() => void onSelect(null)}
          />
        </div>
        {/* Scrolling is entirely the browser's: `overflow-x-auto` with the
            native scrollbar left visible, so a wheel mouse has a bar to drag
            and the strip needs no wheel handling of its own. Keeping the bar is
            the reason not to re-add `no-scrollbar` here — hiding it is what
            left a plain wheel mouse with no way into the strip at all.

            `pb-[2px] -mb-[2px] overflow-y-hidden` is what keeps it scrolling in
            *one* axis. CSS computes the other axis from `visible` to `auto` as
            soon as one scrolls, and each tab's `-mb-[2px]` — the overlap that
            merges it into the rail — then reads as 2px of vertical overflow: the
            strip scrolled a couple of pixels up and down, and the overhang was
            absorbed rather than laid over the rail, so the folder seam showed.
            The padding absorbs the overhang instead and the negative margin puts
            the whole scroller back over the rail, which is the same geometry
            with nothing left to scroll; hiding the y axis then also swallows the
            sub-pixel from a targeted tab's `scale-[1.03]` mid card-drag. Doing
            it here rather than in `TAB_CLASSES` is deliberate — the pinned
            All-cards tab needs its overlap and has no scroller to overflow. */}
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap flex items-end gap-1 pl-1 pr-2 pt-2 pb-[2px] -mb-[2px]">
          <DndContext
            sensors={sensors}
            modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={boards.map((b) => b.id)}
              strategy={horizontalListSortingStrategy}
            >
              {boards.map((b) => (
                <SortableTab
                  key={b.id}
                  board={b}
                  count={boardCounts.get(b.id) ?? 0}
                  countLabel={t('boards.cardCount', { count: boardCounts.get(b.id) ?? 0 })}
                  isActive={active.kind === 'own' && b.id === active.id}
                  onSelect={() => void onSelect(b.id)}
                  cardDrag={cardDrag}
                  flashing={flashBoardId === b.id}
                />
              ))}
            </SortableContext>
          </DndContext>
          {/* A button among the tabs, drawn as one — not a blank tab.
              It used to carry the tabs' own `-mb-[2px] rounded-t-xl border-b-0`,
              which merges a tab into the rail; on a fill that is only 70%
              opaque the rail then showed straight through its bottom edge, so
              it read as cutting the line rather than sitting on it. Fully
              rounded, fully bordered, and `mb-0.5` clear of the rail — which is
              also what "add a board" *is*, an action rather than a selector,
              the same shape as "+ New card" in the cluster on the right. */}
          <button
            type="button"
            onClick={() => setMenu('new')}
            aria-label={t('boards.new') as string}
            title={t('boards.new') as string}
            className="shrink-0 mb-0.5 px-3 py-2 text-base leading-none rounded-xl border border-surface-raised/70 bg-surface-sunken/70 text-ink-muted hover:text-brand hover:bg-surface-raised/70 transition-colors"
          >
            +
          </button>
          {/* The third region: other people's boards, after a rule and outside
              the `SortableContext` — `boardOrder` is the user's own ids and is
              synced, so a foreign tab has no place in it. They come last so a
              long list of them can never push your own off the strip; "All
              cards" is pinned outside this scroller and cannot move at all. */}
          {sharedBoards.length > 0 && (
            <span
              aria-hidden="true"
              className="shrink-0 self-stretch w-px my-2 mx-1 bg-surface-raised/70"
            />
          )}
          {sharedBoards.map((m) => (
            <SharedTab
              key={m.itemId}
              mirror={m}
              ownerLabel={t('boards.sharedBy', { author: m.author })}
              countLabel={t('boards.cardCount', { count: m.cards.length })}
              isActive={active.kind === 'shared' && m.itemId === active.itemId}
              onSelect={() => onSelectShared(m.itemId)}
            />
          ))}
        </div>
        <div className="shrink-0 flex items-center px-2 gap-1">
          {/* Two `+` affordances share this strip: the one among the tabs adds
              a tab (a board), this one adds a card — so this one is labelled.
              On a board the ⋮ menu carries it instead, since a card created
              there would still be a card outside every board. */}
          {active.kind === 'all' && (
            <button
              type="button"
              onClick={onNewCard}
              aria-label={t('cards.new') as string}
              className="shrink-0 px-2.5 py-1 text-sm leading-none rounded-xl border border-surface-raised/70 bg-surface-sunken/70 text-ink-muted hover:text-brand hover:bg-surface-raised/70 transition-colors"
            >
              + {t('cards.newShort')}
            </button>
          )}
          {showEditToggle && editMode && onToggleOrientation && (
            <button
              type="button"
              onClick={onToggleOrientation}
              aria-label={t('boards.toggleOrientation') as string}
              title={t('boards.toggleOrientation') as string}
              className="btn-ghost text-ink-muted text-lg leading-none w-9 h-9 inline-flex items-center justify-center"
            >
              {orientation === 'landscape' ? '▭' : '▯'}
            </button>
          )}
          {showEditToggle && (
            <button
              type="button"
              onClick={onToggleEditMode}
              aria-pressed={editMode}
              aria-label={t(editMode ? 'boards.doneEditing' : 'boards.editLayout') as string}
              className={[
                'text-lg leading-none w-9 h-9 inline-flex items-center justify-center rounded-full transition-colors',
                editMode ? 'bg-brand/90 text-on-brand' : 'btn-ghost text-ink-muted',
              ].join(' ')}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenu((m) => (m ? null : 'root'))}
            className="btn-ghost text-lg leading-none w-9 h-9 inline-flex items-center justify-center"
            aria-label={t('boards.menu') as string}
            aria-expanded={menu !== null}
          >
            ⋮
          </button>
        </div>
      </div>

      {menu === 'root' && (
        <div
          className="absolute right-2 top-full mt-1 z-30 bg-surface-raised rounded-xl shadow-lg border border-surface-raised/70 py-1 w-52"
          role="menu"
        >
          <MenuItem
            onClick={() => {
              setMenu(null);
              onNewCard();
            }}
          >
            + {t('cards.new')}
          </MenuItem>
          <MenuItem onClick={() => setMenu('new')}>+ {t('boards.new')}</MenuItem>
          {/* Board actions are **hidden** on a shared tab and merely *disabled*
              on All cards, and the difference is meant: on All cards they would
              apply the moment you picked a board, so greying them says "pick
              one"; on somebody else's board they can never apply, and a greyed
              Delete beside their name suggests otherwise. */}
          {active.kind !== 'shared' && (
            <>
              <MenuItem disabled={!hasActive} onClick={() => setMenu('rename')}>
                ✎ {t('boards.rename') as string}
              </MenuItem>
              <MenuItem
                disabled={!hasActive}
                onClick={() => {
                  setMenu(null);
                  onRequestAddCards();
                }}
              >
                + {t('boards.addCards')}
              </MenuItem>
              {onShareBoard && (
                <MenuItem
                  disabled={!hasActive}
                  onClick={() => {
                    setMenu(null);
                    onShareBoard();
                  }}
                >
                  ↗ {t('boards.share')}
                </MenuItem>
              )}
              <MenuItem
                disabled={!hasActive}
                danger
                onClick={async () => {
                  setMenu(null);
                  await onDelete();
                }}
              >
                ✕ {t('boards.delete')}
              </MenuItem>
            </>
          )}
        </div>
      )}

      {menu === 'new' && (
        <BoardEditor
          title={t('boards.new') as string}
          onCancel={() => setMenu(null)}
          onSubmit={async (values) => {
            await onCreate(values);
            setMenu(null);
          }}
        />
      )}

      {menu === 'rename' && activeBoard && (
        <BoardEditor
          title={t('boards.rename') as string}
          initial={{
            name: activeBoard.name,
            emoji: activeBoard.emoji,
            color: activeBoard.color,
            background: activeBoard.background,
          }}
          onCancel={() => setMenu(null)}
          onSubmit={async (values) => {
            await onEdit(values);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}


function railBorderClass(color?: CardColor): string {
  switch (color ?? 'none') {
    case 'yellow':
      return 'border-card-yellow-bg';
    case 'amber':
      return 'border-card-amber-bg';
    case 'coral':
      return 'border-card-coral-bg';
    case 'rose':
      return 'border-card-rose-bg';
    case 'lavender':
      return 'border-card-lavender-bg';
    case 'sage':
      return 'border-card-sage-bg';
    case 'sky':
      return 'border-card-sky-bg';
    case 'none':
    default:
      return 'border-brand/60';
  }
}
