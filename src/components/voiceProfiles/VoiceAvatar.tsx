import clsx from 'clsx';
import { DeviceIcon, SpeakerIcon } from '@/components/common/icons';

/**
 * A voice's face: the picture the user gave it, or — for the two system voices
 * — their glyph, or the first letter of its name.
 *
 * Brand-tinted rather than colour-coded per voice: a palette of voice colours
 * would be colour living in TypeScript, which theming.md rules out, and the
 * picture is what tells voices apart.
 */
export function VoiceAvatar({
  name,
  avatar,
  system,
  size = 44,
  className,
}: {
  name: string;
  /** A data URL (see voiceProfiles.ts) — rendered straight into `<img>`. */
  avatar?: string;
  system?: 'echo' | 'device';
  size?: number;
  className?: string;
}) {
  const glyph = Math.round(size * 0.46);
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-brand/15 text-brand ring-1 ring-brand/25',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {avatar ? (
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      ) : system === 'device' ? (
        <DeviceIcon size={glyph} />
      ) : system === 'echo' ? (
        <SpeakerIcon size={glyph} />
      ) : (
        <span className="font-serif leading-none" style={{ fontSize: Math.round(size * 0.42) }}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  );
}
