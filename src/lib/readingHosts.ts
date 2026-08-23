import type { VerseSummary } from '@/types/domain';
import { chatReadingHost } from './chatReadingHost';
import { readerReadingHost } from './readerReadingHost';

/**
 * The key every queued audio track carries (`PlaybackTrack.groupId`,
 * `BrowserTtsItem.groupId`, `usePlaybackStore.current.groupId`). It binds audio
 * to the verses `WordHighlighter` highlights — it is NOT necessarily a chat
 * message id.
 *
 * Shape: `${ns}:${suffix}`, e.g. `reader:LUT:43:3`. **A bare id with no `:` is a
 * legacy chat message id** and resolves to the chat host, which is what lets
 * chat's `crypto.randomUUID()` ids keep working untouched.
 */
export type ReadingGroupId = string;

/**
 * Which reading-list entry a group came from.
 *
 * This is what makes a reading list behave like a playlist: continuation asks
 * the list what comes after `entryId` instead of asking the Bible what comes
 * after the last verse. Absent → the group is an ordinary passage and
 * continuation follows canonical order, which is every pre-existing reading.
 *
 * Both hosts carry it (chat on the message, the reader on the segment) so
 * `lib/readingContinuation.ts` needs no idea which host it is talking to.
 */
export type ListProvenance = { listId: string; entryId: string };

export type ReadingGroup = {
  id: ReadingGroupId;
  verses: VerseSummary[];
  /** Heading phrasing: "John, chapter 3" vs "John 3:16-18". */
  wholeChapter: boolean;
  provenance?: ListProvenance;
};

export type AppendReadingOptions = {
  wholeChapter: boolean;
  /** Chat-only: the "(Played aloud: …)" line the model reads back as history.
   * Hosts with no conversation ignore it. */
  historyNote?: string;
  /** Carried onto the new group so a list keeps playing as a list. */
  provenance?: ListProvenance;
};

/**
 * A place readings can live. Two exist: the chat (readings are assistant
 * messages) and the reader screen (readings are loaded chapters).
 *
 * Every method must degrade rather than throw — a group can disappear while its
 * audio is still queued (a chat message deleted, a chapter scrolled out of the
 * reader's window).
 */
export type ReadingHost = {
  readonly ns: string;
  getGroup(id: ReadingGroupId): ReadingGroup | null;
  /** This host's playable groups, in playback order. */
  listGroups(): ReadingGroup[];
  /** Where "Play" starts when nothing is queued. */
  defaultGroup(): ReadingGroupId | null;
  /** One step back, loading if the host can. Null at a hard boundary (the
   * first chat reading, Genesis 1). */
  previousGroup(id: ReadingGroupId): Promise<ReadingGroupId | null>;
  /**
   * Materialize a reading and return its group id.
   *
   * MUST be idempotent: if that passage is already present, return its existing
   * id rather than creating a duplicate. The reader relies on this because
   * endless scroll may already have loaded the chapter that auto-continuation
   * is about to ask for.
   */
  appendReading(
    verses: VerseSummary[],
    opts: AppendReadingOptions,
  ): Promise<ReadingGroupId | null>;
};

const hosts = new Map<string, ReadingHost>();
let focusedNs = 'chat';

function nsOf(id: ReadingGroupId): string {
  const i = id.indexOf(':');
  return i === -1 ? 'chat' : id.slice(0, i);
}

/**
 * Resolves a playback group id to its verses. **Anything in the playback path
 * that needs "the verses behind what is playing" goes through here** — the
 * transport, autoPlay, playbackController, the last-reading writer,
 * startPlayback, playbackPosition. Never re-introduce a
 * `useChatStore.messages.find(...)` in that path.
 *
 * Dispatch is per id, not per active screen: both hosts can own live groups at
 * once (chat has readings from earlier in the session while the reader has
 * chapters mounted), so a single "current context" would break chat's
 * highlighting the moment the user switched tabs.
 */
export const readingHosts = {
  register(host: ReadingHost): void {
    hosts.set(host.ns, host);
  },

  hostFor(id: ReadingGroupId): ReadingHost | null {
    return hosts.get(nsOf(id)) ?? null;
  },

  getGroup(id: ReadingGroupId): ReadingGroup | null {
    return readingHosts.hostFor(id)?.getGroup(id) ?? null;
  },

  /** Groups following `id` within its own host — derived here so hosts don't
   * each reimplement it. Drives `startReadingPlaylist`'s "keep playing what
   * comes after this". */
  groupsAfter(id: ReadingGroupId): ReadingGroup[] {
    const host = readingHosts.hostFor(id);
    if (!host) return [];
    const list = host.listGroups();
    const i = list.findIndex((g) => g.id === id);
    return i === -1 ? [] : list.slice(i + 1);
  },

  /** Which host the user is looking at. Only consulted when nothing is queued
   * (i.e. "what does Play start?"). Single writer: `useReadingHostFocus`. */
  focus(ns: string): void {
    if (hosts.has(ns)) focusedNs = ns;
  },

  focused(): ReadingHost | null {
    return hosts.get(focusedNs) ?? hosts.get('chat') ?? null;
  },
};

/** Register both hosts. Called once from main.tsx *before*
 * initPlaybackController / initAutoPlay, so their store subscribers never see
 * an empty registry. */
export function initReadingHosts(): void {
  readingHosts.register(chatReadingHost);
  readingHosts.register(readerReadingHost);
}
