import { SERVER_ORIGIN, SERVER_BASE_PATH } from '@/services/api/origin';
import type { Translation } from './bibleApi';

export type ManifestBook = {
  b: number;
  path: string;
  bytes: number;
  /** SHA-256 of the uncompressed JSON, for integrity checking after download.
   * Optional so an older manifest still works. */
  sha256?: string;
};

export type ManifestTranslation = {
  code: Translation;
  bundled: boolean;
  /** The kill switch. Server-side, so a translation can be withdrawn without
   * shipping an app update — see the licensing note in the plan. */
  available: boolean;
  /** When true, an already-installed pack is deleted rather than merely hidden. */
  revoke?: boolean;
  version: string;
  bytes: number;
  wireBytes: number;
  books: ManifestBook[];
};

export type PackManifest = {
  schema: number;
  packFormat: string;
  version: string;
  translations: ManifestTranslation[];
};

/** Where downloadable packs live on the server. */
export function packBaseUrl(): string {
  return `${SERVER_ORIGIN}${SERVER_BASE_PATH}/bible-packs`;
}

export function packUrl(relPath: string): string {
  return `${packBaseUrl()}/${relPath}`;
}

let cached: PackManifest | null = null;

/**
 * Fetch the manifest, falling back to the copy bundled in the app.
 *
 * The server copy is authoritative (it carries the availability flags), but
 * the bundled fallback means the translation picker still renders correct
 * "installed / included" state with no connectivity — which is exactly when an
 * offline-Bible feature needs to look right.
 */
export async function getManifest(force = false): Promise<PackManifest | null> {
  if (cached && !force) return cached;

  try {
    const res = await fetch(`${packBaseUrl()}/manifest.json`, { cache: 'no-cache' });
    if (res.ok) {
      cached = (await res.json()) as PackManifest;
      return cached;
    }
  } catch {
    // offline or server down — fall through
  }

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bible-packs/manifest.json`);
    if (res.ok) {
      cached = (await res.json()) as PackManifest;
      return cached;
    }
  } catch {
    // no bundled manifest either (e.g. a web build without packs deployed)
  }
  return null;
}

export function findTranslation(
  manifest: PackManifest | null,
  code: Translation,
): ManifestTranslation | null {
  return manifest?.translations.find((t) => t.code === code) ?? null;
}
