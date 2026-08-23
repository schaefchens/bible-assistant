import { useMemo } from 'react';
import {
  bibleSequence,
  listSequence,
  type ReadingSequence,
} from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The reader's active sequence, as a hook — the reactive counterpart of
 * `readerStore`'s internal `sequenceFor`.
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

  return useMemo(() => {
    if (source.kind === 'list') {
      const list = lists.find((l) => l.id === source.listId);
      if (list) return listSequence(list, translation);
    }
    return bibleSequence(translation);
  }, [source, lists, translation]);
}
