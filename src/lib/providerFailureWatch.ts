import { onProviderFailure } from '@/services/api/client';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Turn an ElevenLabs refusal into session state, once, for everybody.
 *
 * Every voice resolver reads `elevenLabsFailure`, so recording it here is what
 * makes the next verse — and the assistant's next reply, and the next tap on a
 * download button — fall back to the system voice instead of each of them
 * failing on its own first. It is the user's *choice* that stays untouched:
 * the failure is transient (settings' `partialize` drops it) and a reload asks
 * ElevenLabs again.
 *
 * A key the server says it does not have also means the status the app holds
 * is stale (cleared on another device, say), so that is corrected too.
 *
 * Called once from main.tsx, beside the other boot-time listeners — not from a
 * component: nothing here waits on a user decision, and AppShell renders the
 * onboarding wizard instead of its tree on a first run.
 */
export function initProviderFailureWatch(): void {
  onProviderFailure((failure, code) => {
    const settings = useSettingsStore.getState();
    if (code === 'elevenlabs_key_missing') settings.setUserElevenLabsKeyStatus(false, null);
    // A narrower failure never replaces a broader one: once the key is
    // refused, "this voice is unavailable" says less than what is known.
    const current = settings.elevenLabsFailure;
    if (current && current.kind !== 'voice' && failure.kind === 'voice') return;
    settings.setElevenLabsFailure(failure);
  });
}
