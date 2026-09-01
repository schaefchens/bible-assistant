import { audioPlayback } from './audioPlaybackManager';
import { startAmbientIfEnabled, startPlaybackForVerses } from './startPlayback';
import { resolveSpace } from '@/services/community/spaceReading';
import { postSegmentRef, segmentId } from '@/services/reading/readingSequence';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Start reading a space aloud, in the reader.
 *
 * The reader, not the chat, and not because of a limitation: a space is walked
 * through with a pager, its pieces are titled rather than referenced, and
 * auto-continuation carries on to the next piece. Chat has no representation
 * for any of that — `ChatMessage` carries a reading-list provenance but not a
 * space's, and `useContinueReading` deliberately offers nothing for a post.
 *
 * The counterpart of `readingListPlayback.playSegmentInReader`, down to the
 * un-awaited `startPlaybackForVerses`: "started" means the text is loaded and
 * the first track is on its way, not that every paragraph's TTS has been built.
 */
export async function playSpaceInReader(key: {
  spaceId?: string;
  code?: string;
}): Promise<boolean> {
  const source = { kind: 'space' as const, ...key };
  const space = resolveSpace(source);
  if (!space || space.posts.length === 0) return false;

  const translation = useSettingsStore.getState().translation;
  const ref = postSegmentRef(space.posts[0], space.spaceId, translation);

  await useReaderStore.getState().setSource(source);
  await useReaderStore.getState().goTo(ref);

  const segment = useReaderStore.getState().segments[segmentId(ref)];
  if (!segment) return false;
  audioPlayback.ensureContext();
  startAmbientIfEnabled();
  void startPlaybackForVerses(segment.id, segment.verses, 0);
  return true;
}

/**
 * Open a cross-space reading — "everything new", or "today from everyone".
 *
 * Takes the pieces already chosen rather than a filter, because the source is a
 * snapshot: see `ReaderSource`'s `'selection'` variant for why re-deriving it
 * would reshuffle the reading as pieces are marked seen.
 *
 * Returns false when the selection is empty, which the caller shows as "nothing
 * new" rather than opening an empty reader.
 */
export async function openSelectionInReader(
  label: string,
  postIds: string[],
  play: boolean,
): Promise<boolean> {
  if (postIds.length === 0) return false;
  const source = { kind: 'selection' as const, label, postIds };
  await useReaderStore.getState().setSource(source);

  if (!play) return true;

  const position = useReaderStore.getState().position;
  if (!position) return false;
  const segment = useReaderStore.getState().segments[segmentId(position)];
  if (!segment) return false;
  audioPlayback.ensureContext();
  startAmbientIfEnabled();
  void startPlaybackForVerses(segment.id, segment.verses, 0);
  return true;
}
