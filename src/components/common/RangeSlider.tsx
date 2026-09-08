/**
 * The app's labelled range input: a label row with the value right-aligned, over
 * a native slider tinted `accent-brand`.
 *
 * Native rather than a custom-styled track, deliberately — a `appearance: none`
 * track means re-implementing the thumb, the focus ring and the touch target for
 * three engines. `track` paints a gradient strip directly above the input
 * instead, which is what the hue sliders need without any of that.
 *
 * `MsSlider` and the playback form's volume sliders are thin wrappers over this;
 * they were the same twenty lines twice before it existed.
 */
export function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  track,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Right-aligned readout. Omit for a slider whose position speaks for itself. */
  format?: (v: number) => React.ReactNode;
  /** CSS `background` for a preview strip above the input (e.g. a hue ramp). */
  track?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-ink-muted mb-1 gap-2">
        <span>{label}</span>
        {format && <span className="font-mono tabular-nums shrink-0">{format(value)}</span>}
      </label>
      {track && (
        <div
          aria-hidden
          className="h-1.5 rounded-full mb-1 border border-ink/10"
          style={{ background: track }}
        />
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
      {hint && <p className="text-xs text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}
