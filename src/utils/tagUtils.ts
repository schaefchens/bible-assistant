/** Canonical tag format used throughout the cards/boards UI: lowercase, no
 * leading '#', spaces collapsed to single hyphens, and only [a-z0-9-_] kept.
 * Tags are stored already-normalized, so display surfaces (e.g. TagFilterBar)
 * can render them verbatim. Returns '' for input that normalizes to nothing. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '');
}
