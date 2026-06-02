/** A labelled range slider for a millisecond duration, showing the value in
 * seconds (e.g. "1.5s"). Steps in 100ms. Shared by the playback settings form
 * and the onboarding wizard's pause steps. */
export function MsSlider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-cream-dim mb-1">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{(value / 1000).toFixed(1)}s</span>
      </label>
      <input
        type="range"
        min={0}
        max={max}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold"
      />
    </div>
  );
}
