import { RangeSlider } from '@/components/common/RangeSlider';

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
    <RangeSlider
      label={label}
      value={value}
      min={0}
      max={max}
      step={100}
      onChange={onChange}
      format={(v) => `${(v / 1000).toFixed(1)}s`}
    />
  );
}
