import { useMemo } from 'react';
import { readerSequenceFrom } from '@/services/reading/readerSequence';
import type { ReadingSequence } from '@/services/reading/readingSequence';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The reader's active sequence, as a hook — the reactive counterpart of
 * `readerSequence()`, which the store and `lib/` use. Both go through
 * `readerSequenceFrom`, so there is only one copy of the branching.
 *
 * Components need it to render navigation affordances (what is the next
 * passage? is there a previous one?), and those must re-render when the user
 * edits the list or switches source. Every input is *selected* rather than read
 * through `getState()`, so `exhaustive-deps` can see it: a space's posts change
 * when the author publishes or a feed refreshes, and those are invisible to the
 * dependency array otherwise.
 */
export function useReaderSequence(): ReadingSequence {
  const source = useReaderStore((s) => s.source);
  const translation = useSettingsStore((s) => s.translation);
  const lists = useLibraryStore((s) => s.readingLists);
  const profile = useCommunityStore((s) => s.profile);
  const spaces = useCommunityStore((s) => s.spaces);
  const posts = useCommunityStore((s) => s.posts);
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);

  return useMemo(
    () =>
      readerSequenceFrom(source, translation, {
        lists,
        profile,
        spaces,
        posts,
        subscriptions,
        feed,
      }),
    [source, translation, lists, profile, spaces, posts, subscriptions, feed],
  );
}
