import clsx from 'clsx';
import {
  CheckIcon,
  LockIcon,
  PencilIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopIcon,
} from '@/components/common/icons';
import { VoiceAvatar } from './VoiceAvatar';

/**
 * One voice in the gallery: tap to choose it, hear it, edit it.
 *
 * The tile is a `radio` (the gallery is a radiogroup — one voice per role),
 * and hear/edit are *siblings* of it rather than buttons inside it, so each is
 * its own focusable control with its own name.
 *
 * A locked voice — one whose key this session lacks — stays choosable: the
 * choice is kept (and synced), and the hero card says what reads meanwhile.
 */
export function VoiceTile({
  name,
  subtitle,
  avatar,
  system,
  selected,
  locked,
  usage,
  onSelect,
  preview,
  onEdit,
  editLabel,
}: {
  name: string;
  subtitle: string;
  avatar?: string;
  system?: 'echo' | 'device';
  selected: boolean;
  locked?: boolean;
  /** "Reads" / "Replies" — what this voice is in use for, if anything. */
  usage?: string;
  onSelect: () => void;
  preview?: { state: 'idle' | 'loading' | 'playing'; label: string; onToggle: () => void };
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <li
      className={clsx(
        'flex items-center gap-1 rounded-2xl border pr-1.5 transition-colors',
        selected
          ? 'border-brand/60 bg-brand/10'
          : 'border-surface-raised/70 bg-surface-raised/30 hover:border-brand/30',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex-1 min-w-0 flex items-center gap-3 pl-3 py-2.5 text-left"
      >
        <VoiceAvatar name={name} avatar={avatar} system={system} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-serif text-[16px] text-ink truncate">{name}</span>
            {locked && <LockIcon className="shrink-0 text-ink-muted" />}
          </span>
          <span className="block text-xs text-ink-muted truncate">{subtitle}</span>
        </span>
        {usage && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-brand/15 text-brand">
            {usage}
          </span>
        )}
        {selected && <CheckIcon className="shrink-0 text-brand" />}
      </button>
      {preview && (
        <button
          type="button"
          onClick={preview.onToggle}
          aria-label={preview.label}
          title={preview.label}
          className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-brand hover:bg-brand/10"
        >
          {preview.state === 'loading' ? (
            <SpinnerIcon size={16} />
          ) : preview.state === 'playing' ? (
            <StopIcon />
          ) : (
            <SpeakerIcon />
          )}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
          className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-brand/10"
        >
          <PencilIcon />
        </button>
      )}
    </li>
  );
}
