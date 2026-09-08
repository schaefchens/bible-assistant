import { useEffect, useMemo, useState } from 'react';
import { formatRangeList, formatReference, getBookById } from '@/services/bible/bookCatalog';
import {
  isWholeChapterReading,
  nextReadingAfter,
  type NextReading,
} from '@/lib/readingContinuation';
import { isListProvenance } from '@/lib/readingHosts';
import { playSegmentInChat } from '@/lib/readingListPlayback';
import { useSettingsStore } from '@/store/settingsStore';
import type { ChatMessage, Locale } from '@/types/domain';
import type { SendOpts } from '@/hooks/useCommandPipeline';

type ContinueReading = {
  canContinue: boolean;
  nextLabel: string;
  sendNext: () => void;
};

/**
 * The "continue reading" affordance under a reading: whether there is more
 * after its last verse, a locale-formatted label for it, and the action that
 * reads it.
 *
 * What comes next is `lib/readingContinuation.ts`'s answer, not this hook's —
 * so the chip offers the next entry of a reading list when the reading belongs
 * to one, and the next passage in canonical order otherwise. It used to compute
 * that itself (a fourth copy of the rule, which also couldn't cross a book
 * boundary the way auto-play could, so the chip vanished at the end of a book
 * while the audio read on).
 */
export function useContinueReading(
  message: ChatMessage,
  send: (text: string, opts?: SendOpts) => void | Promise<void>,
): ContinueReading {
  const locale = useSettingsStore((s) => s.locale);
  // Stamped with the message it answers for, so a resolution that lands after
  // the panel has been recycled for another reading is ignored rather than
  // shown against the wrong verses.
  const [resolved, setResolved] = useState<{
    id: string;
    next: NextReading | null;
  } | null>(null);
  const verseCount = message.verses?.length ?? 0;

  useEffect(() => {
    if (verseCount === 0) return;
    let cancelled = false;
    void nextReadingAfter(message.id)
      .then((n) => {
        if (!cancelled) setResolved({ id: message.id, next: n });
      })
      .catch(() => {
        if (!cancelled) setResolved({ id: message.id, next: null });
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, verseCount]);

  const next = resolved?.id === message.id && verseCount > 0 ? resolved.next : null;

  return useMemo(() => {
    // A post continuation has no chat representation: posts are read in the
    // reader, and formatNextReading would be asked for the name of book 0. The
    // reader's own pager is where a space is walked through.
    if (!next || next.post) return { canContinue: false, nextLabel: '', sendNext: () => {} };
    return {
      canContinue: true,
      nextLabel: formatNextReading(next, locale),
      sendNext: () => {
        // A reading that belongs to a list continues *inside* the list, played
        // directly so its provenance — and therefore the rest of the plan —
        // survives. Anything else goes through the model as before, which is
        // what keeps the conversation coherent about what was read.
        const list =
          next.provenance && isListProvenance(next.provenance) ? next.provenance : null;
        if (list) {
          void playSegmentInChat({
            translation: next.translation,
            bookId: next.bookId,
            chapter: next.chapter,
            ranges: next.ranges,
            listId: list.listId,
            entryId: list.entryId,
          });
        } else {
          void send(`Read ${englishReference(next)}`);
        }
      },
    };
  }, [next, locale, send]);
}

function formatNextReading(next: NextReading, locale: Locale): string {
  if (isWholeChapterReading(next)) {
    return formatReference(next.bookId, next.chapter, undefined, undefined, locale);
  }
  return formatRangeList(next.bookId, next.chapter, next.ranges ?? [], locale);
}

/** The reference as the model expects it — English book names, `chapter:start-end`.
 * Canonical continuations always carry a single contiguous range, so the first
 * and last range bound the whole request. */
function englishReference(next: NextReading): string {
  const name = getBookById(next.bookId)?.nameEn ?? String(next.bookId);
  if (isWholeChapterReading(next)) return `${name} ${next.chapter}`;
  const ranges = next.ranges!;
  const start = ranges[0].start;
  const end = ranges[ranges.length - 1].end;
  return start === end
    ? `${name} ${next.chapter}:${start}`
    : `${name} ${next.chapter}:${start}-${end}`;
}
