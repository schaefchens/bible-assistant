import type { HandleId } from '@/lib/freeformLayout';

type Props = {
  cardId: string;
  /** Board zoom — handles counter-scale by 1/scale to stay finger-sized. */
  scale: number;
  onHandlePointerDown: (e: React.PointerEvent, cardId: string, handle: HandleId) => void;
};

type ResizeSpec = { id: HandleId; left: string; top: string; cursor: string };

const RESIZE: ResizeSpec[] = [
  { id: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { id: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { id: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { id: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { id: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { id: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { id: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { id: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

export function FreeformHandles({ cardId, scale, onHandlePointerDown }: Props) {
  const k = 1 / scale; // counter-scale: keeps the 44px pad ~44px on screen

  return (
    <>
      {RESIZE.map((h) => (
        <div
          key={h.id}
          // 44px touch pad centered on the corner/edge, counter-scaled.
          className="absolute w-11 h-11 flex items-center justify-center z-10"
          style={{
            left: h.left,
            top: h.top,
            transform: `translate(-50%, -50%) scale(${k})`,
            cursor: h.cursor,
            touchAction: 'none',
          }}
          onPointerDown={(e) => onHandlePointerDown(e, cardId, h.id)}
        >
          <span className="w-3.5 h-3.5 rounded-sm bg-gold border border-navy-deep shadow" />
        </div>
      ))}

      {/* Rotate handle, floating above the top-center edge. */}
      <div
        className="absolute flex flex-col items-center z-10"
        style={{
          left: '50%',
          top: '0%',
          transform: `translate(-50%, -180%) scale(${k})`,
          cursor: 'grab',
          touchAction: 'none',
        }}
        onPointerDown={(e) => onHandlePointerDown(e, cardId, 'rotate')}
        aria-label="rotate"
      >
        <span className="w-11 h-11 rounded-full flex items-center justify-center">
          <span className="w-5 h-5 rounded-full bg-gold border border-navy-deep shadow flex items-center justify-center text-[11px] leading-none text-navy-deep">
            ↻
          </span>
        </span>
      </div>
    </>
  );
}
