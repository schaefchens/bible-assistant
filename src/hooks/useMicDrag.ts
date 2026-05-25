import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, type MicCorner } from '@/store/settingsStore';
import { cornerForPoint } from '@/components/voice/MicAnchor';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 6;

type DragState = {
  dragging: boolean;
  ghost: { x: number; y: number } | null;
  activeCorner: MicCorner | null;
};

type Bindings = {
  onPointerDown: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** True for the click immediately following a drag — suppress the implicit tap. */
  consumeClickIfDragged: () => boolean;
};

/**
 * Generic long-press-to-drag-into-corner hook used by both the mic and the
 * playback bar. The caller provides what to do with the dropped corner (the
 * mic writes `setMicCorner` directly; the bar writes `oppositeCorner` of the
 * drop so the two stay in opposing slots).
 */
export function useCornerDrag(onDrop: (corner: MicCorner) => void): {
  state: DragState;
  bindings: Bindings;
} {
  const [state, setState] = useState<DragState>({
    dragging: false,
    ghost: null,
    activeCorner: null,
  });
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const draggedThisCycleRef = useRef(false);
  // Ref the callback so the pointer-listener effect never re-runs because of
  // its identity (prevents a render → effect → setState loop when a caller
  // passes an unstable callback).
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    draggingRef.current = false;
    setState({ dragging: false, ghost: null, activeCorner: null });
  }, []);

  useEffect(() => {
    if (!state.dragging) return;
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const corner = cornerForPoint(e.clientX, e.clientY, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setState({ dragging: true, ghost: { x: e.clientX, y: e.clientY }, activeCorner: corner });
    };
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const corner = cornerForPoint(e.clientX, e.clientY, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      onDropRef.current(corner);
      if (navigator.vibrate) navigator.vibrate(8);
      draggedThisCycleRef.current = true;
      cleanup();
    };
    const onCancel = () => cleanup();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [state.dragging, cleanup]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggedThisCycleRef.current = false;
    const onPreMove = (ev: PointerEvent) => {
      if (!startRef.current) return;
      const dx = ev.clientX - startRef.current.x;
      const dy = ev.clientY - startRef.current.y;
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        window.removeEventListener('pointermove', onPreMove);
        window.removeEventListener('pointerup', onPreUp);
      }
    };
    const onPreUp = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener('pointermove', onPreMove);
      window.removeEventListener('pointerup', onPreUp);
    };
    window.addEventListener('pointermove', onPreMove);
    window.addEventListener('pointerup', onPreUp);

    timerRef.current = window.setTimeout(() => {
      window.removeEventListener('pointermove', onPreMove);
      window.removeEventListener('pointerup', onPreUp);
      if (!startRef.current) return;
      draggingRef.current = true;
      if (navigator.vibrate) navigator.vibrate(10);
      setState({
        dragging: true,
        ghost: { x: startRef.current.x, y: startRef.current.y },
        activeCorner: cornerForPoint(startRef.current.x, startRef.current.y, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      });
    }, LONG_PRESS_MS);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const consumeClickIfDragged = useCallback(() => {
    if (draggedThisCycleRef.current) {
      draggedThisCycleRef.current = false;
      return true;
    }
    return false;
  }, []);

  return { state, bindings: { onPointerDown, onContextMenu, consumeClickIfDragged } };
}

/** Thin wrapper kept for the existing mic caller — writes directly to `setMicCorner`. */
export function useMicDrag() {
  const setMicCorner = useSettingsStore((s) => s.setMicCorner);
  return useCornerDrag(setMicCorner);
}
