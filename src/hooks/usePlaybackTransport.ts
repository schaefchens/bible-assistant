import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useReaderStore } from '@/store/readerStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startPlaybackForVerses, startReadingPlaylist } from '@/lib/startPlayback';
import {
  readingHosts,
  type ReadingGroup,
  type ReadingHost,
} from '@/lib/readingHosts';
import {
  getLastPlayedGroupId,
  triggerContinuation,
} from '@/lib/autoPlay';
import type { VerseSummary } from '@/types/domain';

export const RATE_CYCLE = [0.85, 1.0, 1.15, 1.3] as const;

/** Whether *anything* anywhere is playable — gates the floating playback bar.
 * Reactive, so it has to be a hook: the host registry itself is not a store. */
export function useHasAnyReading(): boolean {
  const chatHasReadings = useChatStore((s) =>
    s.messages.some((m) => (m.verses?.length ?? 0) > 0),
  );
  const readerHasChapters = useReaderStore((s) => s.visible.length > 0);
  return chatHasReadings || readerHasChapters;
}

/**
 * Reactive counterpart to `readingHosts.getGroup()`, for components that must
 * re-render as the verses change. The registry itself is not a store, so this
 * subscribes to both hosts' stores and picks whichever owns the id — the
 * selectors return stable references for the host that doesn't.
 */
export function useReadingVerses(
  groupId: string | null,
): VerseSummary[] | undefined {
  const chatVerses = useChatStore((s) =>
    groupId ? s.messages.find((m) => m.id === groupId)?.verses : undefined,
  );
  const readerVerses = useReaderStore((s) =>
    groupId ? s.segments[groupId]?.verses : undefined,
  );
  return chatVerses ?? readerVerses;
}

/** Chat highlights the message a transport step lands on. Other hosts render
 * their own current-verse indicator, so this is chat-only on purpose. */
function revealInChat(host: ReadingHost, id: string): void {
  if (host.ns !== 'chat') return;
  const { messages, setSelected } = useChatStore.getState();
  const idx = messages.findIndex((m) => m.id === id);
  if (idx !== -1) setSelected(idx);
}

/**
 * The host a transport action applies to: whoever owns what is currently
 * playing, else whichever screen the user is looking at.
 */
function activeHost(): ReadingHost | null {
  const current = usePlaybackStore.getState().current;
  if (current) {
    const host = readingHosts.hostFor(current.groupId);
    if (host) return host;
  }
  return readingHosts.focused();
}

/** Fire the same flow as auto-play's soft-end continuation, but on demand.
 * Pokes the playback status to 'loading' so the floating bar's PlayButton
 * pulses while the cold fetch runs (when there's no prefetch hit). */
function fireContinuationFromTransport(groupId: string): void {
  const store = usePlaybackStore.getState();
  if (store.status === 'idle') store.setStatus('loading');
  void triggerContinuation(groupId);
}

function startGroup(host: ReadingHost, group: ReadingGroup, verseIndex: number): void {
  revealInChat(host, group.id);
  void startPlaybackForVerses(group.id, group.verses, verseIndex);
}

export function navigateVerse(dir: 1 | -1): void {
  void navigateVerseAsync(dir);
}

/** Async because stepping backwards off the front of a group may have to load
 * the previous one (the reader walks into the previous chapter). */
async function navigateVerseAsync(dir: 1 | -1): Promise<void> {
  const host = activeHost();
  if (!host) return;
  const groups = host.listGroups();
  if (groups.length === 0) return;
  const current = usePlaybackStore.getState().current;

  if (!current) {
    // No active playback — if we've played something in this session and the
    // user taps next, treat that as "continue past where I left off" rather
    // than restarting the last reading from verse 0 (the play button already
    // covers restart). Prev-direction keeps the start-from-top behavior.
    if (dir === 1) {
      const lastId = getLastPlayedGroupId();
      if (lastId && groups.some((g) => g.id === lastId)) {
        fireContinuationFromTransport(lastId);
        return;
      }
    }
    const target = dir === 1 ? groups[groups.length - 1] : groups[0];
    startGroup(host, target, 0);
    return;
  }

  const curIdx = groups.findIndex((g) => g.id === current.groupId);
  if (curIdx === -1) {
    startGroup(host, groups[groups.length - 1], 0);
    return;
  }

  const curGroup = groups[curIdx];
  const targetVerseIdx = current.verseIndex + dir;

  if (targetVerseIdx < 0) {
    // Before this group's first verse → the previous group's last verse.
    const prevId = await host.previousGroup(curGroup.id);
    const prev = prevId ? host.getGroup(prevId) : null;
    if (!prev) return; // already at the very beginning
    startGroup(host, prev, prev.verses.length - 1);
    return;
  }

  if (targetVerseIdx >= curGroup.verses.length) {
    // Past this group's last verse → the next loaded group, else fetch a
    // continuation. Works with auto-play off, which is what makes "next" feel
    // unbounded rather than dead-ending at the chapter break.
    const after = readingHosts.groupsAfter(curGroup.id);
    if (after.length === 0) {
      fireContinuationFromTransport(curGroup.id);
      return;
    }
    startGroup(host, after[0], 0);
    return;
  }

  // Same group: jump within the live queue if the verse is loaded. Otherwise
  // the queue was sliced (we started mid-group), so reload from the target —
  // this is what lets a backward step reach a verse that isn't in the current
  // (sliced) queue, including walking back one verse at a time.
  if (audioPlayback.goToVerseIndex(targetVerseIdx)) return;
  void startPlaybackForVerses(curGroup.id, curGroup.verses, targetVerseIdx);
}

/**
 * Play/pause the active track. If nothing is queued, kick off the focused
 * host's default reading (chat: the most recent one; reader: the chapter on
 * screen) as a full playlist. Returns true if it acted.
 */
export function togglePlayOrStart(): boolean {
  const status = usePlaybackStore.getState().status;
  const current = usePlaybackStore.getState().current;
  if (current && (status === 'playing' || status === 'paused')) {
    audioPlayback.toggle();
    return true;
  }
  const host = activeHost();
  const defaultId = host?.defaultGroup();
  const group = host && defaultId ? host.getGroup(defaultId) : null;
  if (!host || !group) return false;
  revealInChat(host, group.id);
  void startReadingPlaylist(group.id, group.verses, 0);
  return true;
}

export function seekByWords(delta: number): void {
  const status = usePlaybackStore.getState().status;
  const current = usePlaybackStore.getState().current;
  if (!current || (status !== 'playing' && status !== 'paused')) return;
  audioPlayback.seekByWord(delta);
}
