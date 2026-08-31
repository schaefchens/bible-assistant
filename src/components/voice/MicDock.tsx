import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiLayoutStore } from '@/store/uiLayoutStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { voiceControl, PTT_HOTKEY } from '@/hooks/useGlobalVoice';
import { useMicDrag } from '@/hooks/useMicDrag';
import { useHasAnyReading } from '@/hooks/usePlaybackTransport';
import { TransportArm, HANDLE_W } from '@/components/playback/TransportArm';
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
 * The single floating control: a mic button with the playback transport
 * extending out of it. One element, one corner, one drag gesture — it replaces
 * the separate mic and playback bar, which lived in opposing corners and had to
 * keep their two positions, two drags and two dismissals in sync.
 *
 * The mic is the anchor and stays put; the capsule grows and shrinks *inward*
 * from it, which works because the container is anchored by the corner's own
 * edge (`right` or `left`), never by width.
 *
 * The arm opens by itself while there is something to control and closes when
 * playback goes idle; the grip is a manual override of that, not a setting (see
 * `override` below).
 */
export function MicDock() {
  const { t } = useTranslation();
  const corner = useSettingsStore((s) => s.micCorner) ?? 'br';
  const bottomBarHeight = useUiLayoutStore((s) => s.bottomBarHeight);

  // Pure consumer of the single voice pipeline (mounted by <VoiceController/>).
  const listening = useGlobalVoiceStore((s) => s.listening);
  const pttRecording = useGlobalVoiceStore((s) => s.pttRecording);
  const micAvailable = useGlobalVoiceStore((s) => s.available);
  const error = useGlobalVoiceStore((s) => s.error);

  const hasReadings = useHasAnyReading();
  const status = usePlaybackStore((s) => s.status);

  const { state: dragState, bindings } = useMicDrag();

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

  const dragging = dragState.dragging && !!dragState.ghost;
  // Dragging shows the mic alone: the ghost has to sit under the finger, and
  // with the arm attached that means measuring a box whose width is animating.
  const showArm = hasReadings && !dragging;

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

  const anchorStyle = getMicAnchor({ corner, bottomBarHeight });
  const dockStyle: React.CSSProperties = dragging
    ? {
        position: 'fixed',
        left: dragState.ghost!.x - MIC_SIZE / 2,
        top: dragState.ghost!.y - MIC_SIZE / 2,
        transition: 'none',
      }
    : {
        ...anchorStyle,
        transition:
          'top 150ms ease, bottom 150ms ease, left 150ms ease, right 150ms ease',
      };

  const onRightSide = corner === 'tr' || corner === 'br';
  // With no mic there is nothing to tuck under, so the capsule stands alone.
  const tucked = micAvailable;
  const nearPad = tucked ? OVERLAP + NEAR_GAP : FAR_PAD;
  const capsuleW =
    (expanded ? Math.max(rowW, HANDLE_W) : HANDLE_W) + nearPad + FAR_PAD + BORDER;

  const isActive = listening || pttRecording;
  const micLabel = listening
    ? (t('chat.listening') as string)
    : pttRecording
      ? (t('chat.pushToTalk') as string)
      : (t('chat.holdToSpeak') as string);

  return (
    <>
      <MicSnapTargets
        visible={dragState.dragging}
        activeCorner={dragState.activeCorner}
      />

      <div
        style={{
          ...dockStyle,
          zIndex: 50,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        onPointerDown={bindings.onPointerDown}
        onContextMenu={bindings.onContextMenu}
        // One place swallows the tap that ends a drag, so no button inside the
        // dock needs to know the gesture exists. Capture, so it never reaches
        // the button's own onClick.
        onClickCapture={(e) => {
          if (bindings.consumeClickIfDragged()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={clsx('flex items-center', onRightSide && 'flex-row-reverse')}
      >
        {micAvailable && (
          <button
            type="button"
            aria-label={micLabel}
            title={
              error ??
              (t('voice.mic.dragHint') as string) +
                ' · ' +
                (t('chat.pushToTalkHint', { key: PTT_HOTKEY }) as string)
            }
            style={{ height: MIC_SIZE, width: MIC_SIZE }}
            onClick={async () => {
              if (listening) {
                await voiceControl.stop();
              } else {
                await voiceControl.start();
              }
            }}
            className={clsx(
              // Above the capsule, whose near end runs underneath it.
              'relative z-10 shrink-0 rounded-full flex items-center justify-center',
              'shadow-xl transition-colors',
              isActive
                ? 'bg-brand text-on-brand animate-pulse-soft'
                : 'bg-surface-sunken text-brand border border-brand/40',
              error && !isActive && 'ring-2 ring-red-500/60',
            )}
          >
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}

        {showArm && (
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
              // capsule clips the far end and the arm reads as retracting into
              // the mic rather than being cut off next to it.
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
    </>
  );
}
