import clsx from 'clsx';
import type { MicPosition } from '@/store/settingsStore';
import { BAR_DROP_BAND } from './MicAnchor';

/**
 * The bar target sits inside `BAR_DROP_BAND` and the bottom corners are pushed
 * clear above it, so what the finger is over always matches where the dock will
 * land. Derived from the constant rather than written out twice — the two used
 * to drift, and a target you can hover but not drop onto is worse than none.
 */
const CORNER_BOTTOM = BAR_DROP_BAND + 12;
const CORNER = 96;

const TARGETS: { position: MicPosition; style: React.CSSProperties }[] = [
  { position: 'tl', style: { top: 16, left: 16, width: CORNER, height: CORNER } },
  { position: 'tr', style: { top: 16, right: 16, width: CORNER, height: CORNER } },
  { position: 'bl', style: { bottom: CORNER_BOTTOM, left: 16, width: CORNER, height: CORNER } },
  { position: 'br', style: { bottom: CORNER_BOTTOM, right: 16, width: CORNER, height: CORNER } },
  // Wide and shallow, drawn where the docked bar actually ends up: just above
  // the nav, full width.
  { position: 'bar', style: { bottom: 56, left: 16, right: 16, height: 56 } },
];

type Props = {
  visible: boolean;
  activePosition: MicPosition | null;
};

export function MicSnapTargets({ visible, activePosition }: Props) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {TARGETS.map((tgt) => (
        <div
          key={tgt.position}
          style={tgt.style}
          className={clsx(
            'absolute rounded-2xl border-2 border-dashed transition-all',
            activePosition === tgt.position
              ? 'border-brand bg-brand/15 scale-105'
              : 'border-brand/40 bg-surface-sunken/40',
          )}
        />
      ))}
    </div>
  );
}
