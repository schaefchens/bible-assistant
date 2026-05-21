import { useEffect, useRef } from 'react';
import clsx from 'clsx';

export type MessageActionItem = {
  key: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
};

type Props = {
  anchor: { x: number; y: number };
  items: MessageActionItem[];
  onClose: () => void;
};

export function MessageActionsMenu({ anchor, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on-screen — flip up if too close to bottom, left if too close to right.
  const pad = 8;
  const estW = 200;
  const estH = items.length * 40 + 16;
  const x = Math.min(Math.max(pad, anchor.x), window.innerWidth - estW - pad);
  const y =
    anchor.y + estH + pad > window.innerHeight ? anchor.y - estH : anchor.y;

  return (
    <div
      ref={ref}
      style={{ left: x, top: Math.max(pad, y) }}
      className="fixed z-50 min-w-[180px] rounded-xl bg-navy-deep border border-navy-soft shadow-xl py-1.5 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={clsx(
            'w-full text-left px-4 py-2 transition-colors',
            item.destructive
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-cream hover:bg-navy-soft/60',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
