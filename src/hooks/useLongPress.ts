import { useCallback, useRef } from 'react';

export type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;

/**
 * Long-press detector matching the Cards page pattern (500ms, 6px tolerance).
 * `onFire` receives the original pointer coordinates so menus can anchor to them.
 */
export function useLongPress(onFire: (pos: { x: number; y: number }) => void): LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      firedRef.current = false;
      timerRef.current = window.setTimeout(() => {
        if (!startRef.current) return;
        firedRef.current = true;
        onFire(startRef.current);
      }, LONG_PRESS_MS);
    },
    [onFire],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
      clear();
    }
  }, [clear]);

  const onPointerUp = useCallback(() => clear(), [clear]);
  const onPointerCancel = useCallback(() => clear(), [clear]);
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Suppress Safari's default long-press context menu when we fire our own.
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu };
}
