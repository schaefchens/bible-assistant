import { deleteNarrationForVoice } from '@/services/narration/narrationDownload';
import { ECHO_VOICE, sameTtsVoice } from '@/services/voices/ttsVoice';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { MirroredVoice } from '@/types/domain';

/**
 * Give back the downloads of a voice that is no longer lent to the user.
 *
 * A voice somebody shared leaves the user's shelves when its owner takes it
 * off, blocks them, starts over with a new code, deletes the shelf or leaves
 * the community — or when the user unsubscribes. Its narration was pinned by
 * whatever they downloaded in it, and pinned bytes are exempt from the LRU
 * sweep, so without this they would outlive the voice for good — the way a
 * deleted voice of one's own would, which is why the voice editor does the
 * same on delete.
 *
 * Unless something still sounds the same — Echo, one of the user's own
 * voices, or the same voice lent to another shelf — whose audio is the very
 * same files.
 *
 * Revoking stops the *owner paying*, not the listening the reader already
 * has: whatever plays from the server's cache plays by URL. This only frees
 * the space on the device.
 *
 * Called once from main.tsx, beside the other boot-time listeners.
 */
export function initSharedVoiceDownloads(): void {
  let previous: readonly MirroredVoice[] = useCommunityStore.getState().mirroredVoices;
  useCommunityStore.subscribe((s) => {
    if (s.mirroredVoices === previous) return;
    const current = s.mirroredVoices;
    const gone = previous.filter((m) => !current.some((n) => n.itemId === m.itemId));
    previous = current;
    for (const mirror of gone) {
      const stillHeard =
        sameTtsVoice(mirror.config, ECHO_VOICE) ||
        useLibraryStore.getState().voices.some((v) => sameTtsVoice(v.config, mirror.config)) ||
        current.some((m) => sameTtsVoice(m.config, mirror.config));
      if (!stillHeard) void deleteNarrationForVoice(mirror.config);
    }
  });
}
