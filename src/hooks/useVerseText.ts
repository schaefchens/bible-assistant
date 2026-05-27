import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { getVerses, verseSpeakable, type Translation } from '@/services/bible/bibleApi';
import { cardReferenceToParsed } from '@/services/bible/cardReference';
import type { CardReference } from '@/types/domain';

const textCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<void>>();

function rangesKey(ref: CardReference): string {
  if (!ref.ranges || ref.ranges.length === 0) return 'all';
  return ref.ranges.map((r) => `${r.start}-${r.end}`).join(',');
}

function cacheKey(translation: Translation, ref: CardReference): string {
  return `${translation}::${ref.bookId}/${ref.chapter}/${rangesKey(ref)}`;
}

export function useVerseText(ref: CardReference): string | null {
  const globalTranslation = useSettingsStore((s) => s.translation);
  const translation = ref.translation ?? globalTranslation;
  const parsed = cardReferenceToParsed(ref);
  const key = parsed ? cacheKey(translation, ref) : null;
  const [, setTick] = useState(0);
  const cached = key ? textCache.get(key) : undefined;

  useEffect(() => {
    if (!key || !parsed) return;
    if (textCache.has(key)) return;

    let cancelled = false;
    let promise = pendingFetches.get(key);
    if (!promise) {
      promise = getVerses(translation, parsed)
        .then((verses) => {
          textCache.set(key, verses.map((v) => verseSpeakable(v)).join(' '));
        })
        .catch(() => {
          // swallow — UI shows reference without text
        })
        .finally(() => {
          pendingFetches.delete(key);
        });
      pendingFetches.set(key, promise);
    }
    promise.then(() => {
      if (!cancelled) setTick((t) => t + 1);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, translation]);

  return cached ?? null;
}
