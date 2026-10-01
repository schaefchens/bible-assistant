import i18n from '@/i18n';
import {
  SYSTEM_DEVICE_ID,
  SYSTEM_ECHO_ID,
  findVoice,
  type VoiceProfile,
} from './voiceProfiles';

/** A voice lent to a shelf, as far as its name goes. */
type NamedSharedVoice = { itemId: string; name: string };

/**
 * What a voice is *called*, for anything that is not a component — the
 * assistant's replies and its prompt. (Components use `t()` directly.)
 *
 * Kept apart from voiceProfiles.ts on purpose: that module is imported while
 * the stores are still hydrating and must not reach for i18n, which imports
 * the settings store.
 */

/** The system voices' display names, in the UI language. */
export function systemVoiceName(id: typeof SYSTEM_ECHO_ID | typeof SYSTEM_DEVICE_ID): string {
  return id === SYSTEM_ECHO_ID
    ? i18n.t('narrationVoices.system.echo')
    : i18n.t('narrationVoices.system.device');
}

/** A selection id's name: a system voice's, a profile's, a voice lent to a
 * shelf (selected by its shared item's id), or — for an id that names nothing
 * any more — the name of the voice that stands in for it. */
export function voiceNameById(
  id: string,
  voices: readonly VoiceProfile[],
  shared: readonly NamedSharedVoice[] = [],
): string {
  if (id === SYSTEM_ECHO_ID || id === SYSTEM_DEVICE_ID) return systemVoiceName(id);
  return (
    findVoice(id, voices)?.name ??
    shared.find((m) => m.itemId === id)?.name ??
    systemVoiceName(SYSTEM_ECHO_ID)
  );
}

/**
 * Every name the device voice answers to, in both languages — so "use the
 * device voice" works whatever language the UI is in. Lower-case.
 */
export const DEVICE_VOICE_ALIASES = [
  'device voice',
  'device',
  'system voice',
  'browser voice',
  'browser',
  'gerätestimme',
  'gerät',
  'systemstimme',
];
