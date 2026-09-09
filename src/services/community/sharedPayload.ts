import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type {
  Board,
  Card,
  CardReference,
  FreeformCardLayout,
  ReadingList,
  VerseRange,
} from '@/types/domain';

/**
 * The bytes a shared plan or board is published as.
 *
 * **This is a format, not an implementation detail.** `canonicalItemMessage`
 * signs `sha256(payload)`, so changing how anything here serialises invalidates
 * every signature already out there: existing shared plans stop verifying on
 * every subscriber's device and are refused rather than rendered. Same standing
 * as `postUnits.ts`, and for the same kind of reason.
 *
 * Four rules make the output canonical:
 *
 * 1. **Fixed field order.** Every object is written as a literal in the order
 *    below; `JSON.stringify` preserves insertion order for string keys.
 * 2. **Absent means omitted**, never `null` — `JSON.stringify` drops a key whose
 *    value is `undefined`, which is why every optional is normalised to
 *    `undefined` rather than left as an empty string.
 * 3. **Array order is preserved**, because it is meaning: a plan's entries are
 *    its reading order.
 * 4. **`freeform`'s keys are sorted.** It is a `Record` keyed by card id, and a
 *    `Record` has no inherent order — two devices holding the same board would
 *    otherwise produce two different payloads and therefore two different
 *    hashes.
 *
 * It is also **the one producer**: the publish path and the "has this changed
 * since I shared it?" check both call `buildPlanPayload`/`buildBoardPayload`,
 * or they would disagree about what is actually published. Nothing ever
 * re-serialises a *parsed* payload — the parsers live in `sharedItems.ts` and
 * the string received from the server is stored verbatim, because that string
 * is what the hash covers.
 *
 * Like `postSignature.ts` and `postUnits.ts` this module imports only **types**
 * from the app, so `npm run community:verify` can exercise the real code.
 */

/** Bumped only for a breaking change to the shapes below. */
export const SHARED_PAYLOAD_VERSION = 1;

/**
 * A board background is dropped unless it is a plain https URL.
 *
 * A `data:` URI is an entire image and would blow `MAX_ITEM_PAYLOAD_BYTES` on
 * its own; a blob or filesystem URL means nothing on somebody else's device.
 * Dropping it costs the recipient a background and nothing else.
 */
const MAX_BACKGROUND_CHARS = 500;

function shareableBackground(background: string | undefined): string | undefined {
  if (!background || background.length > MAX_BACKGROUND_CHARS) return undefined;
  return background.startsWith('https://') ? background : undefined;
}

function text(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function ranges(value: VerseRange[] | undefined): VerseRange[] | undefined {
  if (!value || value.length === 0) return undefined;
  return value.map((r) => ({ start: r.start, end: r.end }));
}

function reference(ref: CardReference): CardReference {
  return {
    bookId: ref.bookId,
    chapter: ref.chapter,
    ranges: ranges(ref.ranges),
    translation: ref.translation,
    label: text(ref.label),
    raw: text(ref.raw),
  };
}

function layout(l: FreeformCardLayout): FreeformCardLayout {
  return { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation, z: l.z };
}

/** Sorted, because a `Record`'s key order is whatever insertion happened to be. */
function freeform(
  value: Record<string, FreeformCardLayout> | undefined,
): Record<string, FreeformCardLayout> | undefined {
  if (!value) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.length === 0) return undefined;
  const out: Record<string, FreeformCardLayout> = {};
  for (const key of keys) out[key] = layout(value[key]);
  return out;
}

export function buildPlanPayload(list: ReadingList): string {
  return JSON.stringify({
    v: SHARED_PAYLOAD_VERSION,
    list: {
      id: list.id,
      name: list.name,
      description: text(list.description),
      days: list.days.map((day) => ({
        id: day.id,
        title: text(day.title),
        entries: day.entries.map((entry) => ({
          id: entry.id,
          bookId: entry.bookId,
          chapter: entry.chapter,
          chapterEnd: entry.chapterEnd,
          ranges: ranges(entry.ranges),
          translation: entry.translation,
          label: text(entry.label),
        })),
      })),
      color: list.color,
      emoji: text(list.emoji),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    },
  });
}

/**
 * A board and the cards it holds.
 *
 * `cardIds` and `freeform` keep the author's card ids verbatim, so the
 * corkboard's placement survives the trip. A *copy* remaps both (see
 * `sharedItems.copyBoard`) — the mirror does not, because it is never written
 * into `libraryStore.cards` and so can never collide with the reader's own.
 *
 * Cards are emitted in `cardIds` order rather than in whatever order the caller
 * resolved them, and an id in `cardIds` with no live card is dropped from both
 * — a deleted card leaves its id behind in every board that held it, and
 * shipping a dangling id would make the recipient's count disagree with what
 * they can see.
 */
export function buildBoardPayload(board: Board, cards: Card[]): string {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const cardIds = board.cardIds.filter((id) => byId.has(id));
  const keep = new Set(cardIds);
  return JSON.stringify({
    v: SHARED_PAYLOAD_VERSION,
    board: {
      id: board.id,
      name: board.name,
      cardIds,
      color: board.color,
      emoji: text(board.emoji),
      viewMode: board.viewMode,
      orientation: board.orientation,
      background: shareableBackground(board.background),
      freeform: freeform(
        board.freeform
          ? Object.fromEntries(Object.entries(board.freeform).filter(([id]) => keep.has(id)))
          : undefined,
      ),
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    },
    cards: cardIds.map((id) => {
      const card = byId.get(id)!;
      return {
        id: card.id,
        title: card.title,
        references: card.references.map(reference),
        notes: text(card.notes),
        tags: card.tags && card.tags.length > 0 ? card.tags : undefined,
        color: card.color,
        emoji: text(card.emoji),
        textScale: card.textScale,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };
    }),
  });
}

/** Hex sha256 of the payload's UTF-8 bytes. What the signature commits to. */
export function payloadHash(payload: string): string {
  return bytesToHex(sha256(utf8ToBytes(payload)));
}

/** UTF-8 length, which is what the server's byte cap measures. */
export function payloadBytes(payload: string): number {
  return utf8ToBytes(payload).length;
}
