import type { Alignment, WordTimestamp } from '@/types/domain';

/**
 * OpenAI gpt-4o-transcribe returns `words: [{ word, start, end }, …]` when
 * `response_format=verbose_json` and `timestamp_granularities=["word"]`.
 * The PHP server stores this verbatim as the alignment JSON.
 */
export function parseAlignment(raw: unknown): Alignment {
  if (!raw || typeof raw !== 'object') return { words: [] };
  const obj = raw as Record<string, unknown>;
  const wordsRaw = (obj.words as unknown[]) ?? [];
  const words: WordTimestamp[] = wordsRaw
    .map((w): WordTimestamp | null => {
      if (!w || typeof w !== 'object') return null;
      const wi = w as Record<string, unknown>;
      const word = typeof wi.word === 'string' ? wi.word : '';
      const start = typeof wi.start === 'number' ? wi.start : -1;
      const end = typeof wi.end === 'number' ? wi.end : -1;
      if (!word || start < 0 || end < 0) return null;
      return { word, start, end };
    })
    .filter((w): w is WordTimestamp => w !== null);
  const duration =
    typeof obj.duration === 'number' ? obj.duration : words.at(-1)?.end;
  return { words, duration };
}

export function findCurrentWordIndex(alignment: Alignment, t: number): number {
  const { words } = alignment;
  // Binary search for last word whose start <= t
  let lo = 0;
  let hi = words.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (result === -1) return -1;
  if (t > words[result].end + 0.05) return -1;
  return result;
}

export async function fetchAlignment(url: string): Promise<Alignment> {
  const res = await fetch(url);
  if (!res.ok) return { words: [] };
  const raw = await res.json();
  return parseAlignment(raw);
}
