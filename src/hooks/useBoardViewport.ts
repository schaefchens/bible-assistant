import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp } from '@/lib/freeformLayout';

export type Viewport = { scale: number; tx: number; ty: number };

const MAX_SCALE = 4;
/** Lower bound as a multiple of the fit-to-width scale. */
const MIN_SCALE_FACTOR = 0.5;

/**
 * Pan/zoom state for the freeform board. The board layer is transformed
 * `translate(tx,ty) scale(s)` with transformOrigin '0 0'. Transient — reset to
 * fit-to-width whenever the board remounts (BoardsPage keys FreeformBoard by
 * board id).
 *
 * `applyLive` writes the transform imperatively (no React render — the 60fps
 * pan/pinch path); `commit` settles it into state on gesture end.
 */
export function useBoardViewport(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  boardLayerRef: React.RefObject<HTMLDivElement | null>,
  boardW: number,
  boardH: number,
) {
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const vpRef = useRef<Viewport>(viewport);
  const fitScaleRef = useRef(1);

  const clampVp = useCallback(
    (vp: Viewport): Viewport => {
      const el = viewportRef.current;
      const vw = el?.clientWidth ?? boardW;
      const vh = el?.clientHeight ?? boardH;
      const minScale = fitScaleRef.current * MIN_SCALE_FACTOR;
      const scale = clamp(vp.scale, minScale, MAX_SCALE);
      const sw = boardW * scale;
      const sh = boardH * scale;
      const tx = sw <= vw ? (vw - sw) / 2 : clamp(vp.tx, vw - sw, 0);
      const ty = sh <= vh ? (vh - sh) / 2 : clamp(vp.ty, vh - sh, 0);
      return { scale, tx, ty };
    },
    [viewportRef, boardW, boardH],
  );

  const writeStyle = useCallback(
    (vp: Viewport) => {
      const el = boardLayerRef.current;
      if (el) el.style.transform = `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`;
    },
    [boardLayerRef],
  );

  const applyLive = useCallback(
    (vp: Viewport) => {
      const c = clampVp(vp);
      vpRef.current = c;
      writeStyle(c);
    },
    [clampVp, writeStyle],
  );

  const commit = useCallback(
    (vp: Viewport) => {
      const c = clampVp(vp);
      vpRef.current = c;
      setViewport(c);
    },
    [clampVp],
  );

  const fitToWidth = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw === 0) return;
    const fit = vw / boardW;
    fitScaleRef.current = fit;
    const ty = boardH * fit <= vh ? (vh - boardH * fit) / 2 : 0;
    commit({ scale: fit, tx: 0, ty });
  }, [viewportRef, boardW, boardH, commit]);

  // Initial fit + refit on container resize (orientation change, etc.).
  useLayoutEffect(() => {
    fitToWidth();
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitToWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToWidth, viewportRef]);

  // Wheel zoom around the cursor (desktop). Manual listener so we can
  // preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cur = vpRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = clamp(cur.scale * factor, fitScaleRef.current * MIN_SCALE_FACTOR, MAX_SCALE);
      const k = next / cur.scale;
      commit({ scale: next, tx: px - k * (px - cur.tx), ty: py - k * (py - cur.ty) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewportRef, commit]);

  return { viewport, vpRef, clampVp, applyLive, commit, fitToWidth };
}
