import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, type MicCorner } from '@/store/settingsStore';
import { cornerForPoint } from '@/components/voice/MicAnchor';
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX } from '@/lib/gestureConstants';
import { hapticTap, ImpactStyle } from '@/lib/nativeBridge';

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
 * Long-press-to-drag-the-dock-into-a-corner. This used to be a generic hook
 * with a caller-supplied drop handler, because the mic and the playback bar
 * both dragged and had to land in opposing corners; there is one dock now, so
 * the drop just writes `micCorner`.
 */
export function useMicDrag(): {
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
      // getState() rather than a selector: nothing here needs to re-render
      // when the corner changes, and a subscription would re-run the
      // pointer-listener effect mid-gesture.
      useSettingsStore.getState().setMicCorner(corner);
      hapticTap();
      draggedThisCycleRef.current = true;
      cleanup();
    };
    const onCancel = () => cleanup();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);

    // Lock iOS's native long-press behaviours page-wide for the duration of
    // the drag: the gesture that starts the drag is the same one Safari uses
    // to select text / raise the callout, and the finger sweeps across chat
    // text on its way to a corner. Clear any selection the press may have
    // already begun, then disable selection + callout until drop.
    const body = document.body;
    body.style.setProperty('user-select', 'none');
    body.style.setProperty('-webkit-user-select', 'none');
    body.style.setProperty('-webkit-touch-callout', 'none');
    window.getSelection?.()?.removeAllRanges();

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      body.style.removeProperty('user-select');
      body.style.removeProperty('-webkit-user-select');
      body.style.removeProperty('-webkit-touch-callout');
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
      // Drag engaged — a touch firmer than the drop tap.
      hapticTap(ImpactStyle.Medium);
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
