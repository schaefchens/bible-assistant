import { audioPlayback } from '@/lib/audioPlaybackManager';
import { clamp01 } from '@/lib/math';
import { getAmbientTracks } from '@/services/api/ambient';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ToolArgs } from '../tools';
import type { ToolDispatchResult } from '../toolResult';

/**
 * The `set_*` tools: everything the assistant can change about how the app
 * behaves, as opposed to what it reads.
 */

/**
 * Apply whichever fields of a patch-shaped tool call the model actually sent.
 *
 * Three tools take a bag of optional settings, and each had its own copy of
 * the same three-part shape: an `if (args.x !== undefined)` per field, a
 * `result` object built alongside so the model is told what took effect, and a
 * "no X fields provided" error at the end. Only the fields differed, so only
 * the fields are written out now — and the three tools can no longer disagree
 * about how a partial call is reported.
 *
 * An applier may return the value that was actually **stored** — several
 * settings clamp — and `undefined` means "what came in is what took effect".
 */
type FieldAppliers<A> = {
  [K in keyof A]?: (value: NonNullable<A[K]>) => unknown;
};

function applyFields<A extends object>(
  args: A,
  appliers: FieldAppliers<A>,
  what: string,
): ToolDispatchResult {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(appliers) as (keyof A & string)[]) {
    const value = args[key];
    if (value === undefined) continue;
    const applier = appliers[key];
    if (!applier) continue;
    const stored = applier(value as NonNullable<A[typeof key]>);
    data[key] = stored === undefined ? value : stored;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, error: `no ${what} fields provided` };
  }
  return { ok: true, data };
}

// ─── Simple single-field setters (micro-handlers) ─────────────────────────

export function handleSetLanguage(args: ToolArgs['set_language']): ToolDispatchResult {
  useSettingsStore.getState().setLocale(args.language);
  return { ok: true };
}

export function handleSetTranslation(args: ToolArgs['set_translation']): ToolDispatchResult {
  useSettingsStore.getState().setTranslation(args.translation, true);
  return { ok: true };
}

export function handleSetVoice(args: ToolArgs['set_voice']): ToolDispatchResult {
  useSettingsStore.getState().setVoice(args.voice);
  return { ok: true };
}

export function handleSetMicPosition(args: ToolArgs['set_mic_position']): ToolDispatchResult {
  useSettingsStore.getState().setMicCorner(args.position);
  return { ok: true, data: { position: args.position } };
}

export function handleSetEyesFree(value: boolean): ToolDispatchResult {
  useGlobalVoiceStore.getState().setEyesFreeMode(value);
  return { ok: true };
}

export function handleSetPlaybackRate(
  args: ToolArgs['set_playback_rate'],
): ToolDispatchResult {
  if (typeof args.rate !== 'number' || !Number.isFinite(args.rate)) {
    return { ok: false, error: 'rate must be a number' };
  }
  const rate = Math.max(0.25, Math.min(3, args.rate));
  audioPlayback.setPlaybackRate(rate);
  return { ok: true, data: { rate } };
}

/**
 * Find the ambient track the model named: by id, by exact title, then by
 * substring. The error lists what there is, since the model's next turn is
 * only as good as what the failure told it.
 */
async function resolveAmbientTrack(
  named: string,
): Promise<{ id: string; title: string } | { error: string }> {
  const needle = named.trim().toLowerCase();
  if (!needle) return { error: 'track must be non-empty' };
  let tracks;
  try {
    tracks = await getAmbientTracks();
  } catch {
    return { error: 'could not load track list' };
  }
  const match =
    tracks.find((t) => t.id === named) ??
    tracks.find((t) => t.title.toLowerCase() === needle) ??
    tracks.find((t) => t.title.toLowerCase().includes(needle));
  if (!match) {
    const available = tracks.map((t) => t.title).join(', ') || '(none)';
    return { error: `no track matched "${named}". Available: ${available}` };
  }
  return { id: match.id, title: match.title };
}

export async function handleSetMusic(
  args: ToolArgs['set_music'],
): Promise<ToolDispatchResult> {
  const settings = useSettingsStore.getState();

  // Resolved up front because it is the one field that can *fail*, and the
  // only reason this handler is async. Failing before anything is applied also
  // means a bad track name doesn't half-apply the rest of the call.
  let track: { id: string; title: string } | null = null;
  if (args.track !== undefined) {
    const resolved = await resolveAmbientTrack(args.track);
    if ('error' in resolved) return { ok: false, error: resolved.error };
    track = resolved;
  }

  const applied = applyFields(
    args,
    {
      enabled: (v) => void settings.setAmbient({ enabled: v }),
      track: () => {
        settings.setAmbient({ trackId: track!.id });
        return track!.id;
      },
      musicVolume: (v) => {
        const volume = clamp01(v);
        settings.setAmbient({ volume });
        audioPlayback.ambient.setVolume(volume);
        return volume;
      },
      speechVolume: (v) => {
        const volume = clamp01(v);
        settings.setSpeechVolume(volume);
        audioPlayback.speech.setVolume(volume);
        return volume;
      },
    },
    'music',
  );
  // Historically reported as trackId + trackTitle, which is more use to the
  // model than the name it already sent.
  if (applied.ok && track) {
    const { track: _named, ...rest } = applied.data as Record<string, unknown>;
    applied.data = { ...rest, trackId: track.id, trackTitle: track.title };
  }
  return applied;
}

export function handleSetReaderPreferences(
  args: ToolArgs['set_reader_preferences'],
): ToolDispatchResult {
  const settings = useSettingsStore.getState();
  return applyFields(
    args,
    {
      autoPlay: (v) => void settings.setAutoPlayReading(v),
      autoScroll: (v) => void settings.setAutoScrollReader(v),
      repeat: (v) => void audioPlayback.setLoopCurrent(v),
    },
    'reader-preference',
  );
}

export function handleSetAnnouncements(
  args: ToolArgs['set_announcements'],
): ToolDispatchResult {
  // Checked before anything is applied — the args are typed but arrive as JSON
  // from a model, so the union is a claim rather than a guarantee.
  if (
    args.verseNumberStyle !== undefined &&
    args.verseNumberStyle !== 'spoken' &&
    args.verseNumberStyle !== 'plain'
  ) {
    return { ok: false, error: 'verseNumberStyle must be "spoken" or "plain"' };
  }
  const settings = useSettingsStore.getState();
  return applyFields(
    args,
    {
      readChapterHeadings: (v) => void settings.setReadChapterHeadings(v),
      readVerseNumbers: (v) => void settings.setReadVerseNumbers(v),
      verseNumberStyle: (v) => void settings.setVerseNumberStyle(v),
      // Both clamp, so report what was stored rather than what was asked for.
      pauseBetweenVersesMs: (v) => {
        settings.setPauseBetweenVersesMs(v);
        return useSettingsStore.getState().pauseBetweenVersesMs;
      },
      pauseBetweenChaptersMs: (v) => {
        settings.setPauseBetweenChaptersMs(v);
        return useSettingsStore.getState().pauseBetweenChaptersMs;
      },
    },
    'announcement',
  );
}
