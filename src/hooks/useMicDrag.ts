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

export function useMicDrag(): { state: DragState; bindings: Bindings } {
  const setMicCorner = useSettingsStore((s) => s.setMicCorner);
  const [state, setState] = useState<DragState>({
    dragging: false,
    ghost: null,
    activeCorner: null,
  });
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const draggedThisCycleRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    draggingRef.current = false;
    setState({ dragging: false, ghost: null, activeCorner: null });
  }, []);

  // Global pointermove/up listeners only attach while a drag is active.
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
      setMicCorner(corner);
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
  }, [state.dragging, setMicCorner, cleanup]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggedThisCycleRef.current = false;
    // Pre-drag move-tolerance guard while we wait for the long-press timer.
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
