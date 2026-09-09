import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { boardTabClasses } from './cardColors';
import { GuestIcon } from '@/components/common/icons';
import { BOARD_TAB_ATTR } from '@/lib/boardTabDrop';
import type { CardDragState } from '@/hooks/useCardTabDrop';
import type { Board, MirroredBoard } from '@/types/domain';

/**
 * The tabs themselves, and the menu row shape — the pieces `LibraryTabs`
 * arranges.
 *
 * All four exports are driven entirely by their props. `SortableTab` calls
 * `useSortable`, which reads dnd-kit's context: that crosses a module boundary
 * for free, so it still needs the `DndContext` and `SortableContext` the screen
 * puts around it, and nothing else.
 *
 * `TAB_CLASSES` travels with them because it is the geometry the pinned tab and
 * the sortable ones must not drift apart on — and both live here now. What the
 * screen keeps is `railBorderClass`: that colours the rail, which is the strip
 * rather than a tab on it.
 */
/** Shared tab geometry: a file folder whose bottom border merges into the
 * rail. Kept in one string so the pinned tab and the sortable ones can't
 * drift apart. */
const TAB_CLASSES = [
  'shrink-0 max-w-[12rem] px-3 py-2 text-sm font-serif select-none',
  'rounded-t-xl border border-b-0 -mb-[2px] transition-colors relative',
  'flex items-center gap-1.5 focus:outline-none',
].join(' ');

export function AllCardsTab({
  label,
  count,
  countLabel,
  isActive,
  onSelect,
}: {
  label: string;
  count: number;
  countLabel: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const tabCls = boardTabClasses('none');
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${label} · ${countLabel}`}
      className={`${TAB_CLASSES} cursor-pointer ${isActive ? tabCls.active : tabCls.inactive}`}
    >
      <span className="truncate">{label}</span>
      <TabCount n={count} />
    </button>
  );
}

/** The card count, muted and small. It earns its place twice: a board's size
 * is otherwise invisible from here, and it is the confirmation that a card
 * dropped onto a tab landed.
 *
 * While a card is over the tab it says what the drop will do instead — `+` for
 * an add, `✓` for a card the board already holds — so a no-op drop doesn't
 * read as the gesture having failed. */
function TabCount({ n, badge }: { n: number; badge?: '+' | '✓' | null }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'shrink-0 text-[11px] tabular-nums',
        badge ? 'font-bold opacity-100' : 'opacity-60',
      ].join(' ')}
    >
      {badge ?? n}
    </span>
  );
}

export function SortableTab({
  board,
  count,
  countLabel,
  isActive,
  onSelect,
  cardDrag,
  flashing,
}: {
  board: Board;
  count: number;
  countLabel: string;
  isActive: boolean;
  onSelect: () => void;
  cardDrag: CardDragState | null;
  flashing: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id });
  const tabCls = boardTabClasses(board.color);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2000 : undefined,
    opacity: isDragging ? 0.9 : 1,
    boxShadow: isDragging ? '0 12px 28px rgba(0,0,0,0.55)' : undefined,
  };
  // Every board tab is armed while a card is in the air — that faint ring is
  // most of what makes the gesture discoverable the first time — and the one
  // under the finger is called out properly.
  const targeted = cardDrag?.overBoardId === board.id;
  const dropCls = targeted
    ? cardDrag?.already
      ? 'ring-2 ring-ink-muted/70'
      : 'ring-2 ring-brand scale-[1.03]'
    : flashing
      ? 'ring-2 ring-brand'
      : cardDrag
        ? 'ring-1 ring-brand/30'
        : '';
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      {...{ [BOARD_TAB_ATTR]: board.id }}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      aria-label={`${board.name} · ${countLabel}`}
      onClick={onSelect}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        TAB_CLASSES,
        // `touch-manipulation`, never `touch-none`: the tabs cover their own
        // scroller, so a tab that swallows the pan makes the strip unscrollable.
        // The long-press delay is what keeps a pan and a reorder apart.
        'cursor-pointer touch-manipulation',
        isActive ? tabCls.active : tabCls.inactive,
        dropCls,
      ].join(' ')}
    >
      {board.emoji && (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {board.emoji}
        </span>
      )}
      <span className="truncate">{board.name}</span>
      <TabCount n={count} badge={targeted ? (cardDrag?.already ? '✓' : '+') : null} />
    </div>
  );
}

/**
 * Somebody else's board, as a tab.
 *
 * Three things separate it from `SortableTab`, and each is a rule rather than
 * a style choice:
 *
 * - **It carries the guest mark**, and the mark is in the accessible name as
 *   well as on screen. Two people may both have a board called "Merkverse", so
 *   the name alone cannot say whose this is — and a strip that reads
 *   identically to a screen reader whichever tab you are on is a strip that
 *   says nothing.
 * - **No `BOARD_TAB_ATTR`.** That attribute *is* the drop target
 *   (`boardTabDrop` hit-tests the element under the finger), so leaving it off
 *   is the whole of "you cannot drag your card onto somebody else's board" —
 *   no guard to write and none to forget.
 * - **Not sortable.** It lives outside the `SortableContext`, so `boardOrder`
 *   stays a list of the user's own board ids, which is what syncs.
 *
 * The count is `mirror.cards.length` and is **exact**: a shared board ships
 * its cards, so the "stored ids overcount" rule `boardCounts` works around
 * cannot apply here.
 */
export function SharedTab({
  mirror,
  ownerLabel,
  countLabel,
  isActive,
  onSelect,
}: {
  mirror: MirroredBoard;
  /** "Christoph's board" — the whose, spelled out for the accessible name. */
  ownerLabel: string;
  countLabel: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const tabCls = boardTabClasses(mirror.board.color);
  const name = mirror.board.name;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${name} · ${ownerLabel} · ${countLabel}`}
      className={[
        TAB_CLASSES,
        'cursor-pointer',
        isActive ? tabCls.active : tabCls.inactive,
      ].join(' ')}
    >
      <GuestIcon className="shrink-0 opacity-70" />
      {mirror.board.emoji && (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {mirror.board.emoji}
        </span>
      )}
      <span className="truncate">{name}</span>
      <TabCount n={mirror.cards.length} />
    </button>
  );
}

export function MenuItem({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2 text-sm',
        disabled
          ? 'text-ink-muted/40 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-surface'
            : 'text-ink hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
