import type { PlanItem } from '@/lib/playbackPlan';
import type { VerseSummary } from '@/types/domain';

/**
 * A voice lent to a shelf: what it may read for the shelf's readers, how much
 * of its owner's key they may spend, and how a reader's copy names whose voice
 * it is.
 *
 * The owner's terms are enforced by the server, at the moment of spending
 * (public/api/sponsorship.php) — everything here only *reflects* them, so the
 * app can choose the right voice up front instead of being refused verse by
 * verse. The two must agree, which is why each rule below names its server
 * twin.
 *
 * Pure, and imports only types: the payload builder (sharedPayload.ts) and the
 * resolver (voiceProfiles.ts) both use it.
 */

/** What a shared voice may read for others — word for word api/voices.php's
 * VOICE_SHARE_SCOPES:
 *
 *   scripture  verses, and the app's announcements around them
 *   pieces     that, and the owner's own pieces on the same shelf
 *   anything   everything, the assistant's replies included */
export const VOICE_SHARE_SCOPES = ['scripture', 'pieces', 'anything'] as const;
export type VoiceShareScope = (typeof VOICE_SHARE_SCOPES)[number];

/**
 * The owner's terms. Allowances are whole characters; absent means "no such
 * limit" — which the server allows only on a shelf where the owner approves
 * each reader (see `needsMonthlyPool`).
 */
export type VoiceSharing = {
  scope: VoiceShareScope;
  /** Characters per calendar month (UTC), for all readers together. */
  monthly?: number;
  /** Characters per day (UTC), for each reader. */
  dailyPerReader?: number;
};

/** api/voices.php's MAX_VOICE_ALLOWANCE. */
export const MAX_VOICE_ALLOWANCE = 100_000_000;

/** What the share form starts from: scripture only, and a month's allowance
 * small enough to be a safe first answer — about fourteen chapters — with two
 * chapters a day for each reader. */
export const DEFAULT_VOICE_SHARING: VoiceSharing = Object.freeze({
  scope: 'scripture',
  monthly: 50_000,
  dailyPerReader: 7_000,
});

/** Roughly how many characters a chapter is, for "≈ N chapters" hints. */
export const CHARS_PER_CHAPTER = 3_500;

/**
 * Whose voice a reader is narrating with — carried on the voice config itself
 * (`SharedTtsVoice`), so every path that narrates sends it without being told.
 * `code` and `itemId` are what the server is asked with (`tts.shared`); the
 * shelf and the scope are for deciding locally what the voice can read.
 */
export type SharedVoiceRef = {
  /** The shelf's share code. */
  code: string;
  /** The shared item — what the reader selects the voice by. */
  itemId: string;
  /** The owner's space id, which a piece's reading unit carries. */
  spaceId: string;
  scope: VoiceShareScope;
};

export function isVoiceShareScope(v: unknown): v is VoiceShareScope {
  return typeof v === 'string' && (VOICE_SHARE_SCOPES as readonly string[]).includes(v);
}

function allowance(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, MAX_VOICE_ALLOWANCE) : undefined;
}

/**
 * Terms from anywhere — a received payload, the share form. `null` when there
 * is no scope it knows. An unknown field is dropped here rather than refused:
 * this side only reflects the terms, and the server, which enforces them,
 * refuses what it does not know.
 */
export function normalizeVoiceSharing(raw: unknown): VoiceSharing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isVoiceShareScope(r.scope)) return null;
  const monthly = allowance(r.monthly);
  const dailyPerReader = allowance(r.dailyPerReader);
  return {
    scope: r.scope,
    ...(monthly !== undefined ? { monthly } : {}),
    ...(dailyPerReader !== undefined ? { dailyPerReader } : {}),
  };
}

/**
 * Does a shelf with this approval need a monthly pool before its readers can
 * use the voice? On automatic approval anyone holding the code gets in, and
 * every new identity would bring a fresh daily allowance — so there the pool
 * is the only real limit. The server refuses spending without one
 * (`shared_voice_budget`), whatever the terms said when the voice was shared.
 */
export function needsMonthlyPool(approval: 'auto' | 'manual', sharing: VoiceSharing): boolean {
  return approval === 'auto' && sharing.monthly === undefined;
}

/** May a shared voice read this verse or paragraph? Scripture always; a piece
 * only on `pieces` — and only one from that same shelf — or `anything`. */
function coversVerse(ref: SharedVoiceRef, verse: VerseSummary): boolean {
  if (!verse.unit) return true;
  if (ref.scope === 'anything') return true;
  return ref.scope === 'pieces' && verse.unit.spaceId === ref.spaceId;
}

/**
 * Can this shared voice read the whole of `plan`?
 *
 * Asked before a reading starts, so a reading the voice may not do goes to the
 * fallback from its first word, instead of being refused item by item and
 * changing voice halfway. Judged on the readings — a heading is said for the
 * verses or paragraphs it introduces — and the server checks every item again
 * (sharedScopeAllows() in api/sponsorship.php); this only has to agree with it.
 */
export function voiceCovers(ref: SharedVoiceRef, plan: readonly PlanItem[]): boolean {
  return plan.every((it) => it.kind !== 'verse' || coversVerse(ref, it.verse));
}

/**
 * May this shared voice narrate a download's subject? A chapter always; a
 * piece only on `anything`, or on `pieces` when it is from the voice's own
 * shelf — `voiceCovers`, for what a download is *of* rather than a plan.
 */
export function voiceCoversSubject(
  ref: SharedVoiceRef,
  subject: { kind: 'chapter' } | { kind: 'post'; spaceId: string },
): boolean {
  if (subject.kind === 'chapter' || ref.scope === 'anything') return true;
  return ref.scope === 'pieces' && subject.spaceId === ref.spaceId;
}

/** May a shared voice speak the assistant's replies? Only when its owner said
 * "anything": a reply is free text, which no other scope admits. */
export function voiceCanReply(ref: SharedVoiceRef): boolean {
  return ref.scope === 'anything';
}
