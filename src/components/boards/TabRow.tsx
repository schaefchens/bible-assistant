import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { boardTabClasses, colorClasses } from '@/components/cards/cardColors';
import {
  DRAG_MOVE_THRESHOLD_PX,
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
} from '@/lib/gestureConstants';
import type { Board, CardColor } from '@/types/domain';
import { CARD_COLORS } from '@/types/domain';

export type BoardValues = { name: string; emoji?: string; color?: CardColor };

type MenuMode = null | 'root' | 'new' | 'rename';

/** The file-folder tab strip across the top of the Boards page: selectable,
 * drag-to-reorder tabs plus a ⋮ menu for new / rename / add-cards / delete and
 * the inline BoardEditor. All board mutations are delegated to props. */
export function TabRow({
  boards,
  activeBoardId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
  onRequestAddCards,
}: {
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (id: string) => Promise<void>;
  onCreate: (values: BoardValues) => Promise<void>;
  onEdit: (values: BoardValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onReorder: (fromId: string, toId: string) => Promise<void>;
  onRequestAddCards: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuMode>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
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
    // Defer attaching so the same pointerdown that opened the menu can't
    // close it on the document handler.
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDocPointer);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const hasActive = Boolean(activeBoard);
  // Tint the baseline rail to the active board's color so the active tab
  // visually merges into it (file-folder seam disappears).
  const railBorder = railBorderClass(activeBoard?.color);

  return (
    <div className={`relative border-b-2 ${railBorder}`} ref={wrapperRef}>
      <div className="flex items-stretch">
        <div className="no-scrollbar flex-1 overflow-x-auto whitespace-nowrap flex items-end gap-1 px-2 pt-2">
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
                  isActive={b.id === activeBoardId}
                  onSelect={() => onSelect(b.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {boards.length > 0 && (
            <button
              type="button"
              onClick={() => setMenu('new')}
              aria-label={t('boards.new') as string}
              className="shrink-0 -mb-[2px] px-3 py-2 text-base leading-none rounded-t-xl border border-b-0 border-navy-soft/70 bg-navy-deep/70 text-cream-dim hover:text-gold hover:bg-navy-soft/70 transition-colors"
            >
              +
            </button>
          )}
        </div>
        <div className="flex items-center px-2">
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
          className="absolute right-2 top-full mt-1 z-30 bg-navy-soft rounded-xl shadow-lg border border-navy-soft/70 py-1 w-52"
          role="menu"
        >
          <MenuItem onClick={() => setMenu('new')}>+ {t('boards.new')}</MenuItem>
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

function SortableTab({
  board,
  isActive,
  onSelect,
}: {
  board: Board;
  isActive: boolean;
  onSelect: () => void;
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
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        'shrink-0 max-w-[12rem] px-4 py-2 text-sm font-serif cursor-pointer touch-none select-none',
        'rounded-t-xl border border-b-0 -mb-[2px] transition-colors relative',
        'flex items-center gap-1.5 focus:outline-none',
        isActive ? tabCls.active : tabCls.inactive,
      ].join(' ')}
    >
      {board.emoji && (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {board.emoji}
        </span>
      )}
      <span className="truncate">{board.name}</span>
    </div>
  );
}

function MenuItem({
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
          ? 'text-cream-dim/40 cursor-not-allowed'
          : danger
            ? 'text-red-400 hover:bg-navy'
            : 'text-cream hover:bg-navy',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function BoardEditor({
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: BoardValues;
  onSubmit: (values: BoardValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const [color, setColor] = useState<CardColor>(initial?.color ?? 'none');
  const submit = () => void onSubmit({ name, emoji, color });
  return (
    <div className="absolute right-2 top-full mt-1 z-30 bg-navy-soft rounded-xl shadow-lg border border-navy-soft/70 p-3 w-80 max-w-[calc(100vw-1rem)] space-y-3">
      <div className="text-xs uppercase tracking-wider text-cream-dim">{title}</div>
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          maxLength={4}
          placeholder="✨"
          aria-label={t('boards.emoji') as string}
          className="w-14 bg-navy rounded-lg px-2 py-1.5 text-cream text-center text-xl outline-none focus:ring-2 focus:ring-gold/60"
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          placeholder={t('boards.boardName') as string}
          className="flex-1 bg-navy rounded-lg px-3 py-1.5 text-cream outline-none focus:ring-2 focus:ring-gold/60 text-sm"
        />
      </div>
      <div>
        <div className="text-xs text-cream-dim mb-1.5">{t('boards.color')}</div>
        <div className="flex flex-wrap gap-2">
          {CARD_COLORS.map((c) => {
            const cls = colorClasses(c);
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={t(`boards.colors.${c}`) as string}
                aria-pressed={selected}
                className={[
                  'w-7 h-7 rounded-full border transition-all',
                  cls.swatch,
                  selected
                    ? 'border-gold ring-2 ring-gold/60 scale-110'
                    : 'border-black/20 hover:scale-105',
                  c === 'none' ? 'border-cream-dim/40' : '',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn-primary text-sm" onClick={submit}>
          {t('boards.save')}
        </button>
      </div>
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
      return 'border-gold/60';
  }
}
