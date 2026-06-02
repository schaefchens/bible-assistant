import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Board, Card, FreeformCardLayout } from '@/types/domain';
import {
  boardDims,
  effectiveLayout,
  moveCard,
  resizeRotatedBox,
  angleToCenter,
  rotateCard,
  nextZ,
  type HandleId,
} from '@/lib/freeformLayout';
import { DRAG_MOVE_THRESHOLD_PX } from '@/lib/gestureConstants';
import { useBoardViewport, type Viewport } from '@/hooks/useBoardViewport';
import { cssUrl } from '@/utils/cssUrl';
import { FreeformCardItem } from './FreeformCardItem';

type Props = {
  board: Board;
  cards: Card[];
  onOpen: (card: Card) => void;
  /** Persist one card's layout. Called ONCE per finished manipulation. */
  onLayoutCommit: (cardId: string, layout: FreeformCardLayout) => void;
  /** View mode (false): tap selects + raises transiently, drag pans, nothing
   * persisted. Edit mode (true): drag/resize/rotate, committed. Owned by the
   * parent so the toggle can live in the page header. */
  editMode: boolean;
};

/** Forced z so the selected card + its handles sit above everything without
 * persisting a z bump on a mere tap-select. */
const SELECTED_Z = 100000;

type Mode =
  | 'pendingCard'
  | 'pendingCardView'
  | 'pendingBg'
  | 'moveCard'
  | 'pan'
  | 'pinch'
  | 'resize'
  | 'rotate';

type Gesture = {
  mode: Mode;
  pointerId: number;
  startX: number;
  startY: number;
  cardId?: string;
  handle?: HandleId;
  startLayout?: FreeformCardLayout;
  grabAngle?: number;
  boardRect?: DOMRect | null;
  startVp?: Viewport;
  // pinch
  d0?: number;
  bx?: number;
  by?: number;
};

function frac(clientX: number, clientY: number, rect: DOMRect) {
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

export function FreeformBoard({ board, cards, onOpen, onLayoutCommit, editMode }: Props) {
  const { t } = useTranslation();
  const noNotesLabel = t('cards.noNotes');

  // Board design dimensions for the current orientation. Layout fractions are
  // relative to these, so flipping orientation reshapes the canvas and cards
  // keep their fractional position.
  const { w: bw, h: bh } = boardDims(board.orientation);

  // The A4 sheet surface: the board's background image (cover) when set,
  // otherwise the default cork texture.
  const boardBg = board.background?.trim();
  const sheetBg: React.CSSProperties = boardBg
    ? {
        backgroundColor: '#4f3b27',
        backgroundImage: cssUrl(boardBg),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {
        backgroundColor: '#4f3b27',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.4px)',
        backgroundSize: '8px 8px',
      };

  const viewportRef = useRef<HTMLDivElement>(null);
  const boardLayerRef = useRef<HTMLDivElement>(null);
  const { viewport, vpRef, clampVp, applyLive, commit } = useBoardViewport(
    viewportRef,
    boardLayerRef,
    bw,
    bh,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Distraction-free fullscreen (view mode only): the board covers the whole
  // screen, hiding tabs, the view switcher, the nav, and floating controls.
  // Toggled by tapping empty board area when nothing is selected.
  const [fullscreen, setFullscreen] = useState(false);

  const layouts = useMemo(
    () => cards.map((c, i) => effectiveLayout(board, c.id, i)),
    [cards, board],
  );

  // Synchronous lookups for gesture starts (avoid stale closures).
  const layoutsByIdRef = useRef<Map<string, FreeformCardLayout>>(new Map());
  const elsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elsRef.current.set(id, el);
    else elsRef.current.delete(id);
  }, []);

  // Latest callbacks/state for the window listeners (which are bound once) and
  // for the pointer-down routers. Updated after each render — event handlers
  // only fire after effects have run, so reads always see current values.
  const cbRef = useRef({ onOpen, onLayoutCommit, cards, selectedId, editMode, bw, bh });
  useEffect(() => {
    layoutsByIdRef.current = new Map(cards.map((c, i) => [c.id, layouts[i]]));
    cbRef.current = { onOpen, onLayoutCommit, cards, selectedId, editMode, bw, bh };
  });

  const gestureRef = useRef<Gesture | null>(null);
  const liveRef = useRef<FreeformCardLayout | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const writeCardStyle = useCallback((cardId: string, l: FreeformCardLayout) => {
    const el = elsRef.current.get(cardId);
    if (!el) return;
    const { bw: w, bh: h } = cbRef.current;
    el.style.left = `${l.x * w}px`;
    el.style.top = `${l.y * h}px`;
    el.style.width = `${l.w * w}px`;
    el.style.height = `${l.h * h}px`;
    el.style.transform = `rotate(${l.rotation}deg)`;
  }, []);

  // ── pointer-down routers (bound to elements) ──────────────────────────────

  const onCardPointerDown = useCallback(
    (e: React.PointerEvent, cardId: string) => {
      e.stopPropagation();
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gestureRef.current) return; // ignore a 2nd finger on a card
      const rect = boardLayerRef.current?.getBoundingClientRect() ?? null;
      const start = layoutsByIdRef.current.get(cardId);
      if (!rect || !start) return;
      const editing = cbRef.current.editMode;
      gestureRef.current = {
        // View mode: a card press taps-to-select or (on drag) pans the board.
        mode: editing ? 'pendingCard' : 'pendingCardView',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        cardId,
        startLayout: start,
        boardRect: rect,
        startVp: editing ? undefined : { ...vpRef.current },
      };
      liveRef.current = editing ? { ...start } : null;
    },
    [vpRef],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, cardId: string, handle: HandleId) => {
      e.stopPropagation();
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gestureRef.current) return;
      const rect = boardLayerRef.current?.getBoundingClientRect() ?? null;
      const start = layoutsByIdRef.current.get(cardId);
      if (!rect || !start) return;
      const grabAngle =
        handle === 'rotate'
          ? angleToCenter(start, frac(e.clientX, e.clientY, rect), cbRef.current.bw, cbRef.current.bh)
          : 0;
      gestureRef.current = {
        mode: handle === 'rotate' ? 'rotate' : 'resize',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        cardId,
        handle,
        startLayout: start,
        grabAngle,
        boardRect: rect,
      };
      liveRef.current = { ...start };
    },
    [],
  );

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (!g) {
        gestureRef.current = {
          mode: 'pendingBg',
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startVp: { ...vpRef.current },
        };
        return;
      }
      // Second finger on the background while panning/pending → pinch.
      if (pointersRef.current.size === 2 && (g.mode === 'pendingBg' || g.mode === 'pan')) {
        const pts = [...pointersRef.current.values()];
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mid0x = (pts[0].x + pts[1].x) / 2 - rect.left;
        const mid0y = (pts[0].y + pts[1].y) / 2 - rect.top;
        const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const startVp = { ...vpRef.current };
        gestureRef.current = {
          mode: 'pinch',
          pointerId: -1,
          startX: 0,
          startY: 0,
          startVp,
          d0,
          bx: (mid0x - startVp.tx) / startVp.scale,
          by: (mid0y - startVp.ty) / startVp.scale,
        };
      }
    },
    [vpRef],
  );

  // ── window move/up/cancel (bound once; deps are all stable) ────────────────

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Promote pending → active once past the drag threshold.
      if (g.mode === 'pendingCard' || g.mode === 'pendingBg' || g.mode === 'pendingCardView') {
        const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
        if (moved < DRAG_MOVE_THRESHOLD_PX) return;
        if (g.mode === 'pendingCard') {
          g.mode = 'moveCard';
          // Don't setSelectedId here — a re-render mid-drag would clobber the
          // imperative style writes for one frame. Bump z imperatively and
          // select on pointerup instead.
          const el = g.cardId ? elsRef.current.get(g.cardId) : undefined;
          if (el) {
            el.style.willChange = 'transform';
            el.style.zIndex = String(SELECTED_Z);
          }
        } else {
          // pendingBg or (view-mode) pendingCardView → pan the board.
          g.mode = 'pan';
          if (!g.startVp) g.startVp = { ...vpRef.current };
        }
      }

      switch (g.mode) {
        case 'moveCard': {
          if (e.cancelable) e.preventDefault();
          if (!g.boardRect || !g.startLayout || !g.cardId) break;
          const dfx = (e.clientX - g.startX) / g.boardRect.width;
          const dfy = (e.clientY - g.startY) / g.boardRect.height;
          const { x, y } = moveCard(g.startLayout, dfx, dfy);
          const live = { ...g.startLayout, x, y };
          liveRef.current = live;
          writeCardStyle(g.cardId, live);
          break;
        }
        case 'resize': {
          if (e.cancelable) e.preventDefault();
          if (!g.boardRect || !g.startLayout || !g.cardId || !g.handle) break;
          const pf = frac(e.clientX, e.clientY, g.boardRect);
          const r = resizeRotatedBox(
            g.startLayout,
            g.handle as Exclude<HandleId, 'rotate'>,
            pf,
            cbRef.current.bw,
            cbRef.current.bh,
          );
          const live = { ...g.startLayout, ...r };
          liveRef.current = live;
          writeCardStyle(g.cardId, live);
          break;
        }
        case 'rotate': {
          if (e.cancelable) e.preventDefault();
          if (!g.boardRect || !g.startLayout || !g.cardId) break;
          const pf = frac(e.clientX, e.clientY, g.boardRect);
          const ang = angleToCenter(g.startLayout, pf, cbRef.current.bw, cbRef.current.bh);
          const rotation = rotateCard(g.startLayout.rotation, g.grabAngle ?? 0, ang, e.shiftKey);
          const live = { ...g.startLayout, rotation };
          liveRef.current = live;
          writeCardStyle(g.cardId, live);
          break;
        }
        case 'pan': {
          if (e.cancelable) e.preventDefault();
          if (!g.startVp) break;
          applyLive({
            scale: g.startVp.scale,
            tx: g.startVp.tx + (e.clientX - g.startX),
            ty: g.startVp.ty + (e.clientY - g.startY),
          });
          break;
        }
        case 'pinch': {
          if (e.cancelable) e.preventDefault();
          const pts = [...pointersRef.current.values()];
          if (pts.length < 2 || !g.startVp || g.d0 === undefined) break;
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) break;
          const midx = (pts[0].x + pts[1].x) / 2 - rect.left;
          const midy = (pts[0].y + pts[1].y) / 2 - rect.top;
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
          const rawScale = g.startVp.scale * (d / g.d0);
          const next = clampVp({ scale: rawScale, tx: 0, ty: 0 }).scale;
          applyLive({ scale: next, tx: midx - (g.bx ?? 0) * next, ty: midy - (g.by ?? 0) * next });
          break;
        }
      }
    };

    const endCardGesture = (g: Gesture) => {
      const el = g.cardId ? elsRef.current.get(g.cardId) : undefined;
      if (el) el.style.willChange = '';
      const live = liveRef.current;
      if (live && g.cardId) {
        const z = nextZ(layoutsByIdRef.current.values());
        cbRef.current.onLayoutCommit(g.cardId, { ...live, z });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      pointersRef.current.delete(e.pointerId);
      if (!g) return;

      if (g.mode === 'pinch') {
        if (pointersRef.current.size === 1) {
          // One finger remains → continue as a pan from here.
          const [[pid, pt]] = [...pointersRef.current.entries()];
          gestureRef.current = {
            mode: 'pan',
            pointerId: pid,
            startX: pt.x,
            startY: pt.y,
            startVp: { ...vpRef.current },
          };
          return;
        }
        commit(vpRef.current);
        gestureRef.current = null;
        return;
      }

      // A non-primary finger lifting doesn't end a single-pointer gesture.
      if (e.pointerId !== g.pointerId) {
        if (pointersRef.current.size === 0) {
          gestureRef.current = null;
          liveRef.current = null;
        }
        return;
      }

      switch (g.mode) {
        case 'pendingCard':
        case 'pendingCardView': {
          // Tap a card: open it if already selected, else select + raise it.
          // In view mode the raise is transient (SELECTED_Z render override);
          // nothing is persisted, so leaving the board changes nothing.
          const card = cbRef.current.cards.find((c) => c.id === g.cardId);
          if (cbRef.current.selectedId === g.cardId) {
            if (card) cbRef.current.onOpen(card);
          } else {
            setSelectedId(g.cardId ?? null);
          }
          break;
        }
        case 'pendingBg':
          // Tap empty board area: first clears any selection; tapping again
          // with nothing selected toggles distraction-free fullscreen (view
          // mode only — edit mode just deselects).
          if (cbRef.current.selectedId) {
            setSelectedId(null);
          } else if (!cbRef.current.editMode) {
            setFullscreen((f) => !f);
          }
          break;
        case 'moveCard':
        case 'resize':
        case 'rotate':
          endCardGesture(g);
          // A drag/resize/rotate leaves the card selected (handles shown).
          if (g.cardId) setSelectedId(g.cardId);
          break;
        case 'pan':
          commit(vpRef.current);
          break;
      }
      gestureRef.current = null;
      liveRef.current = null;
    };

    const onCancel = (e: PointerEvent) => {
      const g = gestureRef.current;
      pointersRef.current.delete(e.pointerId);
      if (!g) return;
      // Keep the in-progress result rather than snapping back to origin — an
      // interrupted drag/resize/rotate commits where it currently is; pan/pinch
      // commits the viewport. Pending taps have no movement to keep.
      switch (g.mode) {
        case 'moveCard':
        case 'resize':
        case 'rotate':
          endCardGesture(g);
          if (g.cardId) setSelectedId(g.cardId);
          break;
        case 'pan':
        case 'pinch':
          commit(vpRef.current);
          break;
      }
      gestureRef.current = null;
      liveRef.current = null;
    };

    // iOS Safari ignores preventDefault on pointermove for scrolling; a
    // non-passive touchmove preventDefault is what actually stops it. While a
    // board gesture owns the touch (gestureRef set on pointerdown), suppress
    // the browser's scroll/overscroll so iOS can't steal the drag (which would
    // fire pointercancel and interrupt the gesture).
    const onTouchMove = (e: TouchEvent) => {
      if (gestureRef.current && e.cancelable) e.preventDefault();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [applyLive, commit, clampVp, vpRef, writeCardStyle]);

  // Escape always exits fullscreen (so it can't trap the user).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 overflow-hidden bg-navy-deep'
          : 'flex-1 min-h-0 relative overflow-hidden bg-navy-deep'
      }
    >
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden touch-none select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onBackgroundPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          ref={boardLayerRef}
          className="absolute left-0 top-0 shadow-2xl ring-1 ring-black/40"
          style={{
            width: bw,
            height: bh,
            transformOrigin: '0 0',
            transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
            willChange: 'transform',
            ...sheetBg,
          }}
        >
          {cards.map((card, i) => {
            const layout = layouts[i];
            const selected = card.id === selectedId;
            return (
              <FreeformCardItem
                key={card.id}
                card={card}
                layout={selected ? { ...layout, z: SELECTED_Z } : layout}
                selected={selected}
                editMode={editMode}
                boardW={bw}
                boardH={bh}
                scale={viewport.scale}
                noNotesLabel={noNotesLabel}
                registerEl={registerEl}
                onCardPointerDown={onCardPointerDown}
                onHandlePointerDown={onHandlePointerDown}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
