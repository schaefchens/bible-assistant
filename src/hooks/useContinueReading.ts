import { useEffect, useMemo, useState } from 'react';
import { getChapter, type Translation } from '@/services/bible/bibleApi';
import { formatReference, getBookById } from '@/services/bible/bookCatalog';
import { useSettingsStore } from '@/store/settingsStore';
import type { ChatMessage, VerseSummary } from '@/types/domain';
import type { SendOpts } from '@/hooks/useCommandPipeline';

type ContinueReading = {
  canContinue: boolean;
  nextLabel: string;
  sendNext: () => void;
};

const CHUNK_SIZE = 5;

function computeNextRange(
  last: VerseSummary,
  chapterEndVerse: number | null,
  nextChapterMax: number | null,
  wholeChapter: boolean,
): { reference: string; translation: Translation; label: string } | null {
  const book = getBookById(last.bookId);
  if (!book) return null;
  if (wholeChapter) {
    if (last.chapter >= book.chapters) return null;
    const nextChapter = last.chapter + 1;
    return {
      reference: `${book.nameEn} ${nextChapter}`,
      translation: last.translation,
      label: `${book.nameEn} ${nextChapter}`,
    };
  }
  if (chapterEndVerse !== null && last.verse < chapterEndVerse) {
    const start = last.verse + 1;
    const end = Math.min(start + CHUNK_SIZE - 1, chapterEndVerse);
    return {
      reference: `${book.nameEn} ${last.chapter}:${start}-${end}`,
      translation: last.translation,
      label: `${book.nameEn} ${last.chapter}:${start}-${end}`,
    };
  }
  if (last.chapter < book.chapters) {
    const nextChapter = last.chapter + 1;
    const end =
      nextChapterMax !== null ? Math.min(CHUNK_SIZE, nextChapterMax) : CHUNK_SIZE;
    return {
      reference: `${book.nameEn} ${nextChapter}:1-${end}`,
      translation: last.translation,
      label: `${book.nameEn} ${nextChapter}:1-${end}`,
    };
  }
  return null;
}

/** Computes the "continue reading" affordance for a reading message: whether
 * there is more to read after its last verse, a pretty locale-aware label for
 * that next range, and a `sendNext()` that issues the follow-up read. */
export function useContinueReading(
  message: ChatMessage,
  send: (text: string, opts?: SendOpts) => void | Promise<void>,
): ContinueReading {
  const last = useMemo(() => {
    const verses = message.verses;
    if (!verses || verses.length === 0) return null;
    return verses[verses.length - 1];
  }, [message.verses]);

  const [chapterEndVerse, setChapterEndVerse] = useState<number | null>(null);
  const [nextChapterMax, setNextChapterMax] = useState<number | null>(null);

  useEffect(() => {
    if (!last) return;
    let cancelled = false;
    void getChapter(last.translation, last.bookId, last.chapter)
      .then((verses) => {
        if (cancelled || verses.length === 0) return;
        setChapterEndVerse(verses[verses.length - 1].verse);
      })
      .catch(() => {});
    const book = getBookById(last.bookId);
    if (book && last.chapter < book.chapters) {
      void getChapter(last.translation, last.bookId, last.chapter + 1)
        .then((verses) => {
          if (cancelled || verses.length === 0) return;
          setNextChapterMax(verses[verses.length - 1].verse);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [last]);

  if (!last) {
    return { canContinue: false, nextLabel: '', sendNext: () => {} };
  }

  const next = computeNextRange(
    last,
    chapterEndVerse,
    nextChapterMax,
    message.headingWholeChapter === true,
  );
  if (!next) {
    return { canContinue: false, nextLabel: '', sendNext: () => {} };
  }

  const { locale } = useSettingsStore.getState();
  // Pretty label honors locale formatting (e.g. "Galater 5:23-27" or
  // "Galater 6" for a whole-chapter continuation).
  const hasVerseRange = next.reference.includes(':');
  const chapterMatch = next.reference.match(/(\d+)(?::|$)/)?.[1];
  const chapterNum = chapterMatch ? parseInt(chapterMatch, 10) : last.chapter;
  let label: string;
  if (hasVerseRange) {
    const startVerse = next.reference.split(':')[1]?.split('-')[0];
    const endVerse = next.reference.split('-')[1];
    const startNum = startVerse ? parseInt(startVerse, 10) : last.verse + 1;
    const endNum = endVerse ? parseInt(endVerse, 10) : startNum;
    label = formatReference(last.bookId, chapterNum, startNum, endNum, locale);
  } else {
    label = formatReference(last.bookId, chapterNum, undefined, undefined, locale);
  }

  return {
    canContinue: true,
    nextLabel: label,
    sendNext: () => {
      void send(`Read ${next.reference}`);
    },
  };
}
