import { db, stripLocal, type LocalVoice } from '@/db/dexie';
import { ECHO_VOICE, sameTtsVoice, type OpenAiVoiceId, type TtsVoice } from '@/services/voices/ttsVoice';
import {
  SYSTEM_DEVICE_ID,
  SYSTEM_ECHO_ID,
  defaultVoiceName,
  findVoice,
  migrateLegacyVoices,
  normalizeVoiceProfile,
  normalizeVoiceSelection,
  sortVoices,
  type VoiceProfile,
  type VoiceRole,
  type VoiceSelection,
} from '@/services/voices/voiceProfiles';
import { useSettingsStore } from './settingsStore';
import { enqueueOp, enqueueVoiceSelectionSync } from './syncQueueManager';
import type { LibraryState } from './libraryStore';

/**
 * The user's narration voices and which of them is in use — the library's
 * writes for both, spread into `libraryStore` the way `librarySync` is.
 *
 * Voices are synced exactly like reading lists: a Dexie row with the local
 * `dirty`/`deleted` flags, one `voice.upsert` or `voice.delete` op per change,
 * adopted on pull by `updatedAt`. The selection is one record — "this voice
 * reads, that one replies" — synced like the card order: a `preferences` row,
 * one collapsing op, last write wins. So a voice made on the phone, and the
 * choice to read with it, both follow the user to the tablet.
 *
 * Imports only `type LibraryState` from the store (a value import would be a
 * runtime cycle — see docs/architecture/stores.md), and every action parameter
 * is annotated because a factory gives them no contextual type.
 */

/** The `preferences` row holding the selection. */
export const VOICE_SELECTION_KEY = 'voiceSelection';

/** What the editor hands over: everything but the bookkeeping. */
export type VoiceDraft = { name: string; avatar?: string; sourceName?: string; config: TtsVoice };

type SetState = (
  partial: Partial<LibraryState> | ((s: LibraryState) => Partial<LibraryState>),
) => void;
type GetState = () => LibraryState;

/** Stored rows → the store's array: tombstones out, every row through the
 * whitelisting coercer. Shared by `init` (rows off disk) and the pull (rows
 * that were just adopted), which must agree. */
export function liveVoices(rows: LocalVoice[]): VoiceProfile[] {
  return sortVoices(
    rows
      .filter((r) => r.deleted !== 1)
      .map((r) => normalizeVoiceProfile(stripLocal(r)))
      .filter((v): v is VoiceProfile => v !== null),
  );
}

/**
 * Persist a selection and queue it. Returns whether the queue actually grew:
 * a pending selection op is *replaced*, not added to, so counting every call
 * as +1 would walk `pendingOps` past the real queue — the accounting
 * `commitOrder` does for orders.
 */
async function commitSelection(next: VoiceSelection): Promise<boolean> {
  await db.preferences.put({ key: VOICE_SELECTION_KEY, value: next });
  const hadPending = (await db.syncQueue.where('op').equals('voiceSelection.set').count()) > 0;
  const queued = await enqueueVoiceSelectionSync(next);
  return queued && !hadPending;
}

/**
 * The selection after a pull: the server's if it is newer *and* nothing local
 * is still pending, else the local one. Skipping the adoption while an op is
 * pending is what stops an in-flight choice being clobbered by the very value
 * it is about to replace (same rule as `adoptedOrder`).
 */
export async function adoptedVoiceSelection(
  remote: unknown,
  local: VoiceSelection,
): Promise<VoiceSelection> {
  if (!remote) return local;
  const theirs = normalizeVoiceSelection(remote);
  const pending = (await db.syncQueue.where('op').equals('voiceSelection.set').count()) > 0;
  if (pending || theirs.updatedAt <= local.updatedAt) return local;
  await db.preferences.put({ key: VOICE_SELECTION_KEY, value: theirs });
  return theirs;
}

/**
 * Bring an install's pre-voices settings into the library, once.
 *
 * The settings migration can't write Dexie (persist hydrates synchronously),
 * so it parks the old values in `legacyVoices` and this — called from `init`,
 * after the rows are loaded — turns them into rows. Safe to re-run if the app
 * dies halfway: `migrateLegacyVoices` derives each id from the voice itself, so
 * a second pass finds the row already there. The migrated selection only lands
 * if nothing has ever been chosen here, and with `updatedAt: 1`, so a real
 * choice synced from another device still wins.
 */
export async function consumeLegacyVoices(set: SetState, get: GetState): Promise<void> {
  const legacy = useSettingsStore.getState().legacyVoices;
  if (!legacy) return;
  const { voices, selection } = migrateLegacyVoices(legacy, Date.now());
  let added = 0;
  for (const profile of voices) {
    if (await db.voices.get(profile.id)) continue;
    await db.voices.put({ ...profile, dirty: 1 });
    if (await enqueueOp('voice.upsert', profile)) added++;
  }
  if (get().voiceSelection.updatedAt === 0) {
    set({ voiceSelection: selection });
    if (await commitSelection(selection)) added++;
  }
  const rows = await db.voices.toArray();
  set((s) => ({ voices: liveVoices(rows), pendingOps: s.pendingOps + added }));
  useSettingsStore.getState().clearLegacyVoices();
}

function replaceOrAdd(voices: VoiceProfile[], next: VoiceProfile): VoiceProfile[] {
  const idx = voices.findIndex((v) => v.id === next.id);
  if (idx === -1) return [...voices, next];
  const copy = voices.slice();
  copy[idx] = next;
  return copy;
}

export function createLibraryVoices(set: SetState, get: GetState) {
  /** Dexie → store → queue, for a profile that is already canonical. */
  const save = async (profile: VoiceProfile): Promise<void> => {
    await db.voices.put({ ...profile, dirty: 1 });
    const queued = await enqueueOp('voice.upsert', profile);
    set((s) => ({
      voices: sortVoices(replaceOrAdd(s.voices, profile)),
      pendingOps: s.pendingOps + (queued ? 1 : 0),
    }));
    if (get().online) void get().flushQueue();
  };

  /** Change part of the selection. The store first — it is what the next
   * reader of `voiceSelection` sees — then disk and the queue. */
  const select = async (patch: Partial<Pick<VoiceSelection, VoiceRole>>): Promise<void> => {
    const next: VoiceSelection = { ...get().voiceSelection, ...patch, updatedAt: Date.now() };
    set({ voiceSelection: next });
    if (await commitSelection(next)) set((s) => ({ pendingOps: s.pendingOps + 1 }));
    if (get().online) void get().flushQueue();
  };

  return {
    /** Mints the id and the timestamps here, never in a render. */
    createVoice: async (draft: VoiceDraft): Promise<string> => {
      const now = Date.now();
      const profile = normalizeVoiceProfile({
        v: 1,
        id: crypto.randomUUID(),
        ...draft,
        createdAt: now,
        updatedAt: now,
      });
      if (!profile) throw new Error('not a valid voice');
      await save(profile);
      return profile.id;
    },

    /** `avatar: undefined` in the patch removes the picture. */
    updateVoice: async (id: string, patch: Partial<VoiceDraft>): Promise<void> => {
      const current = findVoice(id, get().voices);
      if (!current) return;
      const next = normalizeVoiceProfile({ ...current, ...patch, updatedAt: Date.now() });
      if (next) await save(next);
    },

    /**
     * A tombstone plus `voice.delete`, so the voice goes from every device and
     * a pull can't bring it back. A selection pointing at it falls back to the
     * role's system voice — and that change syncs too, or the other devices
     * would go on resolving a voice that no longer exists.
     */
    deleteVoice: async (id: string): Promise<void> => {
      if (!findVoice(id, get().voices)) return;
      await db.voices.update(id, { deleted: 1, dirty: 1 });
      const queued = await enqueueOp('voice.delete', { id });
      set((s) => ({
        voices: s.voices.filter((v) => v.id !== id),
        pendingOps: s.pendingOps + (queued ? 1 : 0),
      }));
      const { narration, assistant } = get().voiceSelection;
      const reset: Partial<Pick<VoiceSelection, VoiceRole>> = {};
      if (narration === id) reset.narration = SYSTEM_ECHO_ID;
      if (assistant === id) reset.assistant = SYSTEM_DEVICE_ID;
      if (reset.narration || reset.assistant) await select(reset);
      else if (get().online) void get().flushQueue();
    },

    selectVoice: async (role: VoiceRole, id: string): Promise<void> => {
      if (get().voiceSelection[role] === id) return;
      await select({ [role]: id });
    },

    /**
     * The profile for a plain OpenAI voice, made if it doesn't exist yet —
     * what "use Nova" means to the assistant and to onboarding. Deduplicated by
     * identity, and plain Echo is the system voice rather than a copy of it.
     */
    ensureOpenAiVoice: async (voice: OpenAiVoiceId, style = ''): Promise<string> => {
      const config: TtsVoice = { provider: 'openai', voice, style };
      if (sameTtsVoice(config, ECHO_VOICE)) return SYSTEM_ECHO_ID;
      const existing = get().voices.find((v) => sameTtsVoice(v.config, config));
      if (existing) return existing.id;
      return get().createVoice({ name: defaultVoiceName(config), config });
    },
  };
}
