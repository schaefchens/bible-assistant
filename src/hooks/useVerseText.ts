import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { getVerses, verseSpeakable, type Translation } from '@/services/bible/bibleApi';
import { parseReference } from '@/services/bible/referenceParser';

const textCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<void>>();

function cacheKey(translation: Translation, reference: string): string {
  return `${translation}::${reference}`;
}

export function useVerseText(reference: string): string | null {
  const translation = useSettingsStore((s) => s.translation);
  const key = cacheKey(translation, reference);
  const [, setTick] = useState(0);
  const cached = textCache.get(key);

  useEffect(() => {
    if (textCache.has(key)) return;
    const parsed = parseReference(reference);
    if (!parsed) return;

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
  }, [key, reference, translation]);

  return cached ?? null;
}
