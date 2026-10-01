import { useTranslation } from 'react-i18next';
import { SYSTEM_DEVICE_ID, findVoice } from '@/services/voices/voiceProfiles';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';

/** What a chosen voice looks like on screen. */
export type VoiceFace = {
  name: string;
  avatar?: string;
  system?: 'echo' | 'device';
  /** The provider's name for the voice it wraps ("George"). */
  sourceName?: string;
  /** Who lent it, when it is a voice somebody shared on a shelf. */
  lentBy?: string;
};

/**
 * The face of a selection id: a system voice, one of the user's own, or one
 * lent to a shelf they read — and, for an id that names nothing any more, the
 * voice that stands in for it (Echo), which is what the resolver does too.
 */
export function useVoiceFace(id: string): VoiceFace {
  const { t } = useTranslation();
  const voices = useLibraryStore((s) => s.voices);
  const lent = useCommunityStore((s) => s.mirroredVoices.find((m) => m.itemId === id));
  if (id === SYSTEM_DEVICE_ID) return { name: t('narrationVoices.system.device'), system: 'device' };
  const own = findVoice(id, voices);
  if (own) return { name: own.name, avatar: own.avatar, sourceName: own.sourceName };
  if (lent) return { name: lent.name, avatar: lent.avatar, sourceName: lent.sourceName, lentBy: lent.author };
  return { name: t('narrationVoices.system.echo'), system: 'echo' };
}
