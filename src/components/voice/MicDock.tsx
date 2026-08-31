import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  useSettingsStore,
  DEFAULT_MIC_POSITION,
  type MicCorner,
} from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useMicDrag } from '@/hooks/useMicDrag';
import { useDockBarHeight } from '@/hooks/useBottomBarHeight';
import { useHasAnyReading } from '@/hooks/usePlaybackTransport';
import {
  TransportArm,
  TransportSpread,
  HANDLE_W,
} from '@/components/playback/TransportControls';
import { MicButton } from './MicButton';
import { getMicAnchor, MIC_SIZE } from './MicAnchor';
import { MicSnapTargets } from './MicSnapTargets';

/** Height of the transport capsule. Shorter than the mic, and short enough that
 * OVERLAP hides its rounded cap behind the mic's circle at every y. */
const CAPSULE_H = 44;
/** How far the capsule's near end slides under the mic, so the two read as one
 * element rather than a button beside a bar. */
const OVERLAP = 20;
/** Clearance between the mic's edge and the first control. */
const NEAR_GAP = 6;
const FAR_PAD = 8;
/** The capsule's 1px border, both sides — `width` is border-box. */
const BORDER = 2;

/**
 * The app's single playback + voice control, in one of five positions: floating
 * in any corner, or docked as a full-width bar above the bottom nav.
 *
 * The two are genuinely different layouts rather than one parameterised by
 * position, because a corner has no room and the bar has nothing but room:
 *
 * |            | floating corner                      | docked bar               |
 * | ---        | ---                                  | ---                      |
 * | placement  | `position: fixed`, over the content   | in flow, above the nav   |
 * | transport  | a capsule extending out of the mic    | spread across the width  |
 * | when idle  | collapses to the mic plus a grip      | stays out                |
 *
 * Docked, it takes its own space in `AppShell`'s column, so it covers nothing —
 * which is the point of choosing it over a floater. That does mean the fixed
 * things above it can't see it in the flex column, hence `useDockBarHeight`.
 *
 * Both positions drag: long-press anywhere on the dock and drop on one of the
 * five targets (`MicSnapTargets`). Dragging shows the mic alone, because the
 * ghost has to sit under the finger and with the transport attached that means
 * measuring a box whose width is mid-animation.
 */
export function MicDock() {
  const position = useSettingsStore((s) => s.micCorner) ?? DEFAULT_MIC_POSITION;
  const bottomBarHeight = useUiLayoutStore((s) => s.bottomBarHeight);

  const micAvailable = useGlobalVoiceStore((s) => s.available);
  const hasReadings = useHasAnyReading();
  const status = usePlaybackStore((s) => s.status);

  const { state: dragState, bindings } = useMicDrag();
  const dragging = dragState.dragging && !!dragState.ghost;
  const asBar = position === 'bar';

  // Publish the docked bar's height for the fixed floaters above it. The hook
  // resets it to 0 when the ref's element unmounts, which is exactly what
  // dragging out of the bar position should do.
  const barRef = useRef<HTMLDivElement | null>(null);
  useDockBarHeight(barRef);

  // Anything but idle is something worth having the controls out for — pausing
  // must not snatch away the button you'd resume with.
  const autoOpen = status !== 'idle';
  // The grip overrides *this* state of affairs, not the rule: the override is
  // spent the moment the automatic answer changes, so collapsing the arm during
  // one reading doesn't keep it shut for the next. Reset during render (the
  // same pattern AppShell uses) rather than from an effect — an effect would
  // render the stale answer first, which here means a visible flap.
  const [override, setOverride] = useState<boolean | null>(null);
  const [seenAuto, setSeenAuto] = useState(autoOpen);
  if (seenAuto !== autoOpen) {
    setSeenAuto(autoOpen);
    if (override !== null) setOverride(null);
  }
  const expanded = override ?? autoOpen;

  // The row is `max-content`; its natural width is what the capsule opens to.
  // Measured rather than assumed because the arm's contents change with the
  // route (the two reading toggles) and the viewport (they hide when narrow).
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowW, setRowW] = useState(0);
  const showArm = !asBar && hasReadings && !dragging;

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // observe() delivers an initial callback, so this covers the first measure
    // too — no synchronous setState in the effect body.
    const ro = new ResizeObserver(() => setRowW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showArm]);

  const toggle = useCallback(() => setOverride(!expanded), [expanded]);

  if (!micAvailable && !hasReadings) return null;

  // Long-press-to-drag, and one place to swallow the tap that ends the drag so
  // no button inside the dock needs to know the gesture exists (capture, so it
  // never reaches the button's own onClick).
  const dragBindings = {
    onPointerDown: bindings.onPointerDown,
    onContextMenu: bindings.onContextMenu,
    onClickCapture: (e: React.MouseEvent) => {
      if (bindings.consumeClickIfDragged()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
  const noSelect: React.CSSProperties = {
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  };

  const mic = micAvailable ? <MicButton /> : null;
  const onRightSide = position === 'tr' || position === 'br';
  // With no mic there is nothing to tuck under, so the capsule stands alone.
  const tucked = micAvailable;
  const nearPad = tucked ? OVERLAP + NEAR_GAP : FAR_PAD;
  const capsuleW =
    (expanded ? Math.max(rowW, HANDLE_W) : HANDLE_W) + nearPad + FAR_PAD + BORDER;

  return (
    <>
      <MicSnapTargets
        visible={dragState.dragging}
        activePosition={dragState.activePosition}
      />

      {asBar ? (
        <div
          ref={barRef}
          style={noSelect}
          {...dragBindings}
          className="flex items-center px-1.5 py-1 border-t border-surface-raised bg-surface"
        >
          {/* Hidden rather than unmounted while dragging: the bar has to keep
              its height or the whole page reflows under the finger, and the
              height comes from what's in it. */}
          <div className={clsx('flex flex-1 items-center min-w-0', dragging && 'invisible')}>
            {hasReadings ? (
              // The mic goes *inside* the transport's grid, which is the only
              // way Play lands on the bar's centre line rather than half a mic
              // to the left of it.
              <TransportSpread trailing={mic} />
            ) : (
              <div className="flex flex-1 justify-end">{mic}</div>
            )}
          </div>
        </div>
      ) : (
        !dragging && (
          <div
            style={{
              ...getMicAnchor({ corner: position as MicCorner, bottomBarHeight }),
              ...noSelect,
              zIndex: 50,
              transition:
                'top 150ms ease, bottom 150ms ease, left 150ms ease, right 150ms ease',
            }}
            {...dragBindings}
            className={clsx('flex items-center', onRightSide && 'flex-row-reverse')}
          >
            {mic}

            {hasReadings && (
              <div
                style={{
                  width: capsuleW,
                  height: CAPSULE_H,
                  transition: 'width 240ms cubic-bezier(.22,.61,.36,1)',
                  ...(onRightSide
                    ? { paddingRight: nearPad, paddingLeft: FAR_PAD, marginRight: tucked ? -OVERLAP : 0 }
                    : { paddingLeft: nearPad, paddingRight: FAR_PAD, marginLeft: tucked ? -OVERLAP : 0 }),
                }}
                className={clsx(
                  'flex items-center overflow-hidden rounded-full',
                  'bg-surface-sunken/95 backdrop-blur border border-brand/30 shadow-xl',
                  // Content is pinned to the mic-facing edge, so shrinking the
                  // capsule clips the far end and the arm reads as retracting
                  // into the mic rather than being cut off next to it.
                  onRightSide ? 'justify-end' : 'justify-start',
                )}
              >
                <TransportArm
                  rowRef={rowRef}
                  expanded={expanded}
                  onToggle={toggle}
                  onRightSide={onRightSide}
                />
              </div>
            )}
          </div>
        )
      )}

      {dragging && micAvailable && (
        <div
          style={{
            position: 'fixed',
            left: dragState.ghost!.x - MIC_SIZE / 2,
            top: dragState.ghost!.y - MIC_SIZE / 2,
            zIndex: 50,
            ...noSelect,
          }}
        >
          <MicButton ghost />
        </div>
      )}
    </>
  );
}
