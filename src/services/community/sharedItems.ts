import { clamp } from '@/lib/math';
import { normalizeCardReferences } from '@/services/bible/cardReference';
import { normalizeReadingList } from '@/services/reading/readingEntries';
import {
  CARD_COLORS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  type Board,
  type BoardOrientation,
  type BoardViewMode,
  type BoardCardsBundle,
  type Card,
  type CardColor,
  type FreeformCardLayout,
  type ReadingList,
} from '@/types/domain';

/**
 * The receiving half of a shared plan or board: turning a payload string that
 * came off the network into something the app will render.
 *
 * Separate from `sharedPayload.ts` deliberately. That module is the signed
 * *format* and imports only types, so `npm run community:verify` can exercise
 * it; this one reaches for the app's boundary coercers, which have runtime
 * imports. The split is the same one `postUnits.ts` already lives on.
 *
 * Everything here is defensive in the way a boundary has to be. A payload's
 * signature proves *who wrote it*, not that they were running this build — an
 * older or newer client may have written fields this one does not know, and a
 * field it does know may hold something it cannot use. So both parsers rebuild
 * their result field by field and drop what does not fit, exactly as
 * `normalizeReadingList` already does for a list arriving from the server.
 */

const CARD_COLOR_SET = new Set<string>(CARD_COLORS);
const VIEW_MODES = new Set<string>(['grid', 'stack', 'pile', 'freeform']);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function cardColor(v: unknown): CardColor | undefined {
  return typeof v === 'string' && CARD_COLOR_SET.has(v) ? (v as CardColor) : undefined;
}

function decode(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A shared plan. `normalizeReadingList` is the whole job — it is already the
 * coercer every other untrusted list goes through (a Dexie row, a server pull,
 * an assistant tool call), it guarantees at least one day, and it drops entries
 * whose `bookId` resolves to no book.
 *
 * The list keeps **the author's id**, which is the premise of the whole
 * feature: see `ReaderSource`'s list variant.
 */
export function parsePlanPayload(payload: string): ReadingList | null {
  const root = decode(payload);
  return root ? normalizeReadingList(root.list) : null;
}

function parseLayout(raw: unknown): FreeformCardLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const x = num(l.x);
  const y = num(l.y);
  const w = num(l.w);
  const h = num(l.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h, rotation: num(l.rotation) ?? 0, z: num(l.z) ?? 0 };
}

function parseCard(raw: unknown): Card | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id);
  if (!id) return null;
  const now = Date.now();
  const scale = num(c.textScale);
  return {
    id,
    title: typeof c.title === 'string' ? c.title : '',
    references: normalizeCardReferences(c.references),
    notes: str(c.notes),
    tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === 'string' && !!t) : undefined,
    color: cardColor(c.color),
    emoji: str(c.emoji),
    textScale: scale === undefined ? undefined : clamp(scale, TEXT_SCALE_MIN, TEXT_SCALE_MAX),
    createdAt: num(c.createdAt) ?? now,
    updatedAt: num(c.updatedAt) ?? now,
  };
}

/**
 * A shared board and its cards.
 *
 * Two invariants the rest of the app assumes and this restores, because a
 * payload cannot be trusted to have them: **`cardIds` names only cards that
 * arrived**, and **`freeform` is keyed only by ids in `cardIds`**. Without the
 * first, the recipient's card count disagrees with what they can see; without
 * the second, `FreeformBoard` places a card that is not there.
 *
 * The board's `background` is not re-validated for scheme here — the publisher
 * already dropped anything but an https URL — but it is length-capped by the
 * server's payload cap, and an unreachable image simply does not render.
 */
export function parseBoardPayload(payload: string): BoardCardsBundle | null {
  const root = decode(payload);
  if (!root || !root.board || typeof root.board !== 'object') return null;
  const b = root.board as Record<string, unknown>;
  const id = str(b.id);
  if (!id) return null;

  const cards = Array.isArray(root.cards)
    ? root.cards.map(parseCard).filter((c): c is Card => c !== null)
    : [];
  const present = new Set(cards.map((c) => c.id));

  const cardIds = Array.isArray(b.cardIds)
    ? b.cardIds.filter((cid): cid is string => typeof cid === 'string' && present.has(cid))
    : [];
  const keep = new Set(cardIds);

  let freeform: Record<string, FreeformCardLayout> | undefined;
  if (b.freeform && typeof b.freeform === 'object') {
    const out: Record<string, FreeformCardLayout> = {};
    for (const [cid, raw] of Object.entries(b.freeform as Record<string, unknown>)) {
      if (!keep.has(cid)) continue;
      const l = parseLayout(raw);
      if (l) out[cid] = l;
    }
    if (Object.keys(out).length > 0) freeform = out;
  }

  const now = Date.now();
  const board: Board = {
    id,
    name: typeof b.name === 'string' ? b.name : '',
    cardIds,
    color: cardColor(b.color),
    emoji: str(b.emoji),
    viewMode:
      typeof b.viewMode === 'string' && VIEW_MODES.has(b.viewMode)
        ? (b.viewMode as BoardViewMode)
        : undefined,
    orientation: b.orientation === 'landscape' ? ('landscape' as BoardOrientation) : undefined,
    background: str(b.background),
    freeform,
    createdAt: num(b.createdAt) ?? now,
    updatedAt: num(b.updatedAt) ?? now,
  };

  // Only the cards the board actually names, in its order — the mirror renders
  // straight from this and never joins against `libraryStore.cards`.
  const byId = new Map(cards.map((c) => [c.id, c]));
  return { board, cards: cardIds.map((cid) => byId.get(cid)!) };
}

/**
 * Fork somebody else's plan into one of the reader's own.
 *
 * **Fresh ids at every level**, and that is the rule to keep: `ReadingProgress`
 * is keyed by `listId` and a `completed` tick by `entryId`, so a copy that kept
 * the author's ids would share one progress row with the mirror and ticking one
 * would tick the other. Progress therefore does not carry over — the copy
 * starts unread, which is what the copy hint says.
 */
export function copyPlan(list: ReadingList, name: string): ReadingList {
  const now = Date.now();
  return {
    ...list,
    id: crypto.randomUUID(),
    name,
    days: list.days.map((day) => ({
      ...day,
      id: crypto.randomUUID(),
      entries: day.entries.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fork somebody else's board, cards and all.
 *
 * Every card gets a new id — these become rows in the reader's own `cards`
 * table, where the author's ids could collide with their own — so `cardIds`
 * **and** `freeform`'s keys have to be remapped through the same mapping, or
 * the corkboard's placements land on nothing and every card is auto-placed.
 */
export function copyBoard(bundle: BoardCardsBundle, name: string): BoardCardsBundle {
  const now = Date.now();
  const remap = new Map<string, string>(bundle.cards.map((c) => [c.id, crypto.randomUUID()]));
  const cards = bundle.cards.map((c) => ({
    ...c,
    id: remap.get(c.id)!,
    createdAt: now,
    updatedAt: now,
  }));

  let freeform: Record<string, FreeformCardLayout> | undefined;
  if (bundle.board.freeform) {
    const out: Record<string, FreeformCardLayout> = {};
    for (const [cid, layout] of Object.entries(bundle.board.freeform)) {
      const next = remap.get(cid);
      if (next) out[next] = layout;
    }
    if (Object.keys(out).length > 0) freeform = out;
  }

  return {
    board: {
      ...bundle.board,
      id: crypto.randomUUID(),
      name,
      cardIds: bundle.board.cardIds.map((cid) => remap.get(cid)).filter((cid): cid is string => !!cid),
      freeform,
      createdAt: now,
      updatedAt: now,
    },
    cards,
  };
}
