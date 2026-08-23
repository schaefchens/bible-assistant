import { Capacitor } from '@capacitor/core';
import type { BibleVerse, Translation } from './bibleApi';

/** Shape written by scripts/bible/buildPacks.mjs. Keys are terse because this
 * is 5 MB per translation and every byte lands on a user's device. */
export type BookPack = {
  /** format marker, e.g. 'pack-v1' */
  f: string;
  t: Translation;
  /** book id */
  b: number;
  /** pack version */
  v: string;
  /** chapter number (as a string key) -> verses */
  c: Record<string, PackVerse[]>;
};

type PackVerse = {
  pk: number;
  verse: number;
  text: string;
  /** Omitted by the builder whenever it equals `text`, which is the case for
   * the overwhelming majority of verses. */
  textTts?: string;
};

export const PACK_FORMAT = 'pack-v1';

/** Version of the packs shipped inside the app bundle. Must match the
 * PACK_VERSION used by scripts/bible/buildPacks.mjs. */
export const BUNDLED_PACK_VERSION = '2026-08-16.1';

/** Translations shipped in the binary — the two public-domain texts. */
export const BUNDLED_TRANSLATIONS: readonly Translation[] = ['LUT', 'KJV'];

/**
 * Pull one chapter out of a book pack, restoring the `textTts` the builder
 * omitted. Returns null when the pack simply doesn't have that chapter — note
 * that's a legitimate answer, not an error: LUT/S51/ELB use German
 * versification and genuinely lack e.g. Malachi 4.
 */
export function decodeChapter(pack: BookPack, chapter: number): BibleVerse[] | null {
  const rows = pack.c?.[String(chapter)];
  if (!rows) return null;
  return rows.map((v) => (v.textTts === undefined ? { ...v, textTts: v.text } : v));
}

export function isBundled(translation: Translation): boolean {
  return BUNDLED_TRANSLATIONS.includes(translation);
}

/**
 * Whether `translation` is readable with no download AND no network.
 *
 * True only on native. `cap sync` copies the packs into the iOS/Android asset
 * bundle, where the WebView serves them as local files. The web build ships
 * the same files under dist/bible-packs/, but they are ordinary HTTP fetches:
 * the service worker's globPatterns deliberately exclude .json (the packs are
 * ~10 MB and precaching them would bloat every SW install), so offline they
 * are simply unavailable.
 *
 * So on web a bundled text is treated as an ordinary *downloadable* pack —
 * which is the only thing that makes the PWA readable offline at all. Callers
 * must ask this rather than isBundled() whenever the question is "can I read
 * this without the network?".
 *
 * Note this deliberately ignores the manifest's own `bundled` flag:
 * BUNDLED_TRANSLATIONS is build-time truth about what shipped in *this*
 * binary, while the manifest is server-authored and cannot know that. Trusting
 * the manifest would strand a user with neither a local file nor a download
 * button.
 */
export function isPreinstalled(translation: Translation): boolean {
  return isBundled(translation) && Capacitor.isNativePlatform();
}
