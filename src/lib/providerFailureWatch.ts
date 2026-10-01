import { onProviderFailure, onSharedVoiceRefusal } from '@/services/api/client';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';

/** How long after a stale shared voice prompted a feed refresh another one
 * may — a refused chapter refuses every verse it builds at once. */
const MISMATCH_REFRESH_MS = 30_000;
let lastMismatchRefresh = 0;

/**
 * Turn an ElevenLabs refusal — or a shared voice's — into session state,
 * once, for everybody.
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

  // A voice somebody shared, refused on its owner's account. The lasting
  // refusals are recorded for that one voice, so it falls back everywhere at
  // once; the listener's own keys are not touched. A stale copy — the owner
  // updated the voice — is fixed by fetching the shelf again, after which the
  // next reading asks with the new one.
  onSharedVoiceRefusal((refusal) => {
    if (refusal.kind === 'unavailable' || refusal.kind === 'budget') {
      useSettingsStore.getState().setSharedVoiceFailure(refusal.itemId, refusal.kind);
    } else if (refusal.kind === 'mismatch' && Date.now() - lastMismatchRefresh > MISMATCH_REFRESH_MS) {
      lastMismatchRefresh = Date.now();
      void useCommunityStore.getState().refreshSubscriptions();
    }
  });
}
