import clsx from 'clsx';
import type { MicCorner } from '@/store/settingsStore';

const TARGETS: { corner: MicCorner; style: React.CSSProperties }[] = [
  { corner: 'tl', style: { top: 16, left: 16 } },
  { corner: 'tr', style: { top: 16, right: 16 } },
  { corner: 'bl', style: { bottom: 80, left: 16 } },
  { corner: 'br', style: { bottom: 80, right: 16 } },
];

type Props = {
  visible: boolean;
  activeCorner: MicCorner | null;
};

export function MicSnapTargets({ visible, activeCorner }: Props) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {TARGETS.map((tgt) => (
        <div
          key={tgt.corner}
          style={tgt.style}
          className={clsx(
            'absolute h-24 w-24 rounded-2xl border-2 border-dashed transition-all',
            activeCorner === tgt.corner
              ? 'border-gold bg-gold/15 scale-105'
              : 'border-gold/40 bg-navy-deep/40',
          )}
        />
      ))}
    </div>
  );
}
