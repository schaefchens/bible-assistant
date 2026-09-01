import { useMemo } from 'react';
import { resolveSpaceFrom, selectionSegments } from '@/services/community/spaceReading';
import {
  bibleSequence,
  listSequence,
  selectionSequence,
  spaceSequence,
  type ReadingSequence,
} from '@/services/reading/readingSequence';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The reader's active sequence, as a hook — the reactive counterpart of
 * `readerStore`'s internal `sequenceFor`. **The two have to grow the same
 * branches**, or the pager and the store disagree about what comes next.
 *
 * Components need it to render navigation affordances (what is the next
 * passage? is there a previous one?), and those must re-render when the user
 * edits the list or switches source. Rebuilt when the list, source or
 * translation changes, because a list sequence is a materialized array.
 */
export function useReaderSequence(): ReadingSequence {
  const source = useReaderStore((s) => s.source);
  const translation = useSettingsStore((s) => s.translation);
  const lists = useLibraryStore((s) => s.readingLists);
  // A space's posts change when the author publishes or a feed refreshes, so
  // the resolver is handed a subscribed snapshot rather than reading
  // getState() — otherwise these are invisible to the dependency array and the
  // memo keeps serving a stale sequence.
  const profile = useCommunityStore((s) => s.profile);
  const spaces = useCommunityStore((s) => s.spaces);
  const posts = useCommunityStore((s) => s.posts);
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);

  return useMemo(() => {
    if (source.kind === 'list') {
      const list = lists.find((l) => l.id === source.listId);
      if (list) return listSequence(list, translation);
    }
    if (source.kind === 'space') {
      const space = resolveSpaceFrom(source, { profile, spaces, posts, subscriptions, feed });
      if (space) return spaceSequence(space.spaceId, space.posts, translation);
    }
    if (source.kind === 'selection') {
      // Deliberately not memoized on `seen`: the selection is a snapshot taken
      // when the user asked for it, so marking pieces seen while reading must
      // not reshuffle it. See ReaderSource's 'selection' variant.
      return selectionSequence(selectionSegments(source.postIds, translation));
    }
    return bibleSequence(translation);
  }, [source, lists, translation, profile, spaces, posts, subscriptions, feed]);
}
