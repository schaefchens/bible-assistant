import type { Translation } from '@/services/bible/bibleApi';

export type Locale = 'en' | 'de';

export type OpenAiVoiceId =
  | 'alloy'
  | 'echo'
  | 'fable'
  | 'onyx'
  | 'nova'
  | 'shimmer'
  | 'coral'
  | 'sage'
  | 'verse';

export type VoiceId = OpenAiVoiceId | 'browser';

export const OPENAI_VOICE_OPTIONS: OpenAiVoiceId[] = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
  'coral',
  'sage',
  'verse',
];

export const VOICE_OPTIONS: VoiceId[] = ['browser', ...OPENAI_VOICE_OPTIONS];

export function isBrowserVoice(v: VoiceId): v is 'browser' {
  return v === 'browser';
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Marks a reading unit that is **not scripture** — one paragraph of a
 * user-written post (see "Community spaces" in CLAUDE.md).
 *
 * This is an optional field on `VerseSummary` rather than a widened
 * `ReadingUnit` supertype because `VerseSummary` is the currency of the whole
 * playback path: the reader, `groupIntoParagraphs`, `buildPlaybackPlan`, the
 * TTS cache keys, `WordHighlighter`, `readingContinuation`, `lastReadingStore`
 * and `publishNowPlaying` are all typed on `VerseSummary[]`. Widening it would
 * touch ~20 files; a bare `bookId: 0` sentinel would instead leak into
 * `getBookById(0)`, the lock-screen subtitle and the last-reading slot.
 *
 * So `unit` is the one discriminant, it carries exactly what the display sites
 * need, and `isScriptureUnit()` is how you test for it.
 */
export type PostUnit = {
  kind: 'post';
  spaceId: string;
  postId: string;
  /** Paragraph index within the post, 0-based. */
  index: number;
  /** The post's own language — drives the TTS voice and the spoken heading. */
  language: Locale;
  /** Post title, for the reader heading and the lock screen. */
  title: string;
  /** Author display name, for the subheading and the lock screen. */
  author: string;
  /** When the piece was published, for the byline. */
  publishedAt: number;
};

export type VerseSummary = {
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
  text: string;
  /** "Galatians 5:22" or "Galater 5,22" depending on locale */
  display: string;
  /** Set only on a post paragraph. See {@link PostUnit}. */
  unit?: PostUnit;
};

/** False for a post paragraph, true for anything that is really a Bible verse. */
export function isScriptureUnit(v: VerseSummary): boolean {
  return v.unit === undefined;
}

export type ToolCallSummary = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  /** plain text content shown to user (may be empty for tool-only messages) */
  text: string;
  /** verses attached to this message — drives playback */
  verses?: VerseSummary[];
  toolCalls?: ToolCallSummary[];
  /**
   * Internal record of what the assistant actually did, used as the
   * assistant turn's content when rebuilding chat history for the model.
   * Never rendered in the UI. Lets the model keep context across turns
   * even when the visible `text` is suppressed (e.g. after read actions).
   */
  historyNote?: string;
  /** True when the original read request covered an entire chapter
   * (no verse range). Drives the heading-announcement phrasing on
   * tap-to-play. Defaults to false (treat as a specific verse range). */
  headingWholeChapter?: boolean;
  /** The reading-list entry this message's verses came from, when it was played
   * as part of a list. Together these are the `ListProvenance` the chat host
   * reports, which is what keeps a list playing as a list from the chat screen
   * — see `lib/readingHosts.ts`. */
  listId?: string;
  entryId?: string;
  createdAt: number;
};

export type WordTimestamp = {
  word: string;
  start: number;
  end: number;
};

export type Alignment = {
  words: WordTimestamp[];
  duration?: number;
};

export type CardColor =
  | 'none'
  | 'yellow'
  | 'amber'
  | 'coral'
  | 'rose'
  | 'lavender'
  | 'sage'
  | 'sky';

export const CARD_COLORS: CardColor[] = [
  'none',
  'yellow',
  'amber',
  'coral',
  'rose',
  'lavender',
  'sage',
  'sky',
];

/** A contiguous verse interval [start..end] (1-based, inclusive). Canonical
 * shape shared by parsed references and card references. */
export type VerseRange = { start: number; end: number };

/** @deprecated Alias of {@link VerseRange}; kept for card-reference call sites. */
export type CardVerseRange = VerseRange;

/**
 * A verse reference attached to a card. Stored structurally as numbers
 * (book/chapter/verse) so it is i18n-stable — display text and the fetched
 * verse are resolved at runtime. `bookId`/`chapter` are absent only when the
 * user's input could not be parsed, in which case `raw` holds it verbatim.
 */
export type CardReference = {
  bookId?: number;
  chapter?: number;
  /** Verse ranges, in order. `undefined` means the whole chapter. */
  ranges?: CardVerseRange[];
  /** Optional per-reference translation override of the global setting. */
  translation?: Translation;
  /** Optional custom highlighted text shown alongside the heading. */
  label?: string;
  /** Original input, kept only when the line could not be parsed. */
  raw?: string;
};

export type Card = {
  id: string;
  title: string;
  references: CardReference[];
  notes?: string;
  tags?: string[];
  color?: CardColor;
  emoji?: string;
  /** Text-size multiplier for this card's title / verses / notes. 1 = default
   * (undefined treated as 1). Clamped to [TEXT_SCALE_MIN, TEXT_SCALE_MAX]. */
  textScale?: number;
  createdAt: number;
  updatedAt: number;
};

/** Bounds for {@link Card.textScale}. */
export const TEXT_SCALE_MIN = 0.7;
export const TEXT_SCALE_MAX = 2;
export const TEXT_SCALE_STEP = 0.1;

export type BoardViewMode = 'grid' | 'stack' | 'pile' | 'freeform';

/** One card's placement on a freeform corkboard. All spatial values are
 * FRACTIONS of the (fixed A4) board, so they're resolution-independent and
 * survive pan/zoom.
 *   x, y      top-left corner, 0..1 of board width/height (unrotated frame)
 *   w, h      size, 0..1 of board width/height (free aspect ratio)
 *   rotation  tilt in degrees, clockwise positive, about the card CENTER
 *   z         stacking order; higher renders on top */
export type FreeformCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
};

/** Corkboard sheet orientation. Defaults to portrait. */
export type BoardOrientation = 'portrait' | 'landscape';

export type Board = {
  id: string;
  name: string;
  cardIds: string[];
  color?: CardColor;
  emoji?: string;
  viewMode?: BoardViewMode;
  /** Corkboard sheet orientation (freeform view). Defaults to portrait. */
  orientation?: BoardOrientation;
  /** Optional background image URL for the board. Shown as the corkboard
   * sheet surface, and behind the cards in the other views. Empty/undefined
   * = no background. */
  background?: string;
  /** Freeform-view placement, keyed by cardId. Sparse — cards in `cardIds`
   * with no entry are auto-placed deterministically (see lib/freeformLayout).
   * Per-board by construction, so the same card on two boards has independent
   * placement. Stale entries (card removed/deleted) are harmless. */
  freeform?: Record<string, FreeformCardLayout>;
  createdAt: number;
  updatedAt: number;
};

/**
 * One passage in a reading list: a whole book, one chapter, a span of
 * chapters, or verse ranges inside a chapter.
 *
 * Stored structurally (numbers, not strings) for the same reason
 * {@link CardReference} is: the display text is locale-dependent and the verse
 * text is translation-dependent, so both are resolved at read time.
 */
export type ReadingEntry = {
  /**
   * Stable within its list. It is the reorder key, the progress tick's key,
   * and part of the playback group id — which is why the same passage listed
   * twice stays two entries a plan can track separately.
   */
  id: string;
  bookId: number;
  /** `undefined` → every chapter of the book, in order. */
  chapter?: number;
  /** Last chapter of a multi-chapter entry ("Genesis 1-3"). Requires `chapter`. */
  chapterEnd?: number;
  /** `undefined` → the whole chapter. Only meaningful with a single `chapter`. */
  ranges?: VerseRange[];
  /** Overrides the active translation for this entry only. */
  translation?: Translation;
  /** Free text shown beside the reference ("Morning", "Memorize this"). */
  label?: string;
};

/**
 * One ordered group of entries — a day of a plan.
 *
 * Rendered as "Day N" from its index unless `title` says otherwise, so a
 * weekly plan can call its groups "Week 3" without a second data shape.
 */
export type ReadingDay = {
  id: string;
  title?: string;
  entries: ReadingEntry[];
};

/**
 * A reading list: a compiled sequence of passages, either a structured plan or
 * a plain custom list.
 *
 * Named `ReadingList` rather than "reading" because `reading`, `ReadingGroup`
 * and `ReadingHost` already mean "a playback group bound to verses" throughout
 * `lib/` — see `lib/readingHosts.ts`.
 */
export type ReadingList = {
  id: string;
  name: string;
  description?: string;
  /**
   * Always at least one day. A plain list is a single untitled day, which the
   * UI renders flat with no day headings — one shape, two presentations.
   */
  days: ReadingDay[];
  color?: CardColor;
  emoji?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Progress through one list, keyed by `listId`.
 *
 * Merged by **union of `completed`**, not last-write-wins: two devices working
 * different days of the same plan must not erase each other's ticks. Only
 * `currentEntryId` follows `updatedAt`, because "where am I" genuinely has one
 * newest answer. Both the client pull and the server writer implement this.
 */
export type ReadingProgress = {
  listId: string;
  /** Entry ids finished, in no meaningful order. */
  completed: string[];
  /** The entry to resume at. */
  currentEntryId?: string;
  updatedAt: number;
};

/* ------------------------------------------------------------------ *
 * Community spaces
 *
 * A `Space` is one person's collection of their own writing; a `Post` is one
 * piece in it. Sharing is invite-only: a `Subscription` is a space I follow,
 * a `Membership` is somebody following one of mine. There is no public
 * listing, and no way to name a space other than its share code.
 * ------------------------------------------------------------------ */

/**
 * The public half of a community identity.
 *
 * Deliberately separate from `Identity` (`lib/identity.ts`): that is the
 * credential every request carries, this is the name and face a subscriber
 * sees. A profile does not exist until the user makes one.
 */
export type Profile = {
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  /**
   * Ed25519 public key, hex. Derived from the mnemonic (see
   * `lib/postSigning.ts`), so it is the same on every device the user
   * recovers onto and needs no storage of its own. Published so subscribers
   * can verify signatures.
   */
  authorKey: string;
  updatedAt: number;
};

/** Whether new subscribers are let in automatically or wait for the owner. */
export type SpaceApproval = 'auto' | 'manual';

export type Space = {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  /**
   * `'today'` is the one space every profile gets, created with the profile
   * and neither deletable nor renameable. Everything else is `'custom'`.
   */
  kind: 'today' | 'custom';
  /**
   * Set → items older than this are pruned server-side on every read and
   * write, and hidden client-side even from a stale cache. 24 for `'today'`.
   */
  ephemeralHours?: number;
  approval: SpaceApproval;
  /**
   * How this space is found — an address, not a key. Holding it lets somebody
   * *ask* to read; `approval` decides whether asking is enough. Minted
   * client-side because a generated code commits to the author's signing key
   * (see `lib/spaceCode.ts`). Absent until the space is first shared; replacing
   * it drops every existing reader, since a membership is per code.
   */
  shareCode?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * One piece of writing.
 *
 * `body` is **plain text**: blank lines separate paragraphs, and each
 * paragraph becomes one narration unit. That is not a stylistic preference —
 * `services/bible/verseSummaries.ts` records the rule that rendered text and
 * narrated text must be the same string, or the word highlight silently
 * desyncs from the audio. Markup would have to be stripped for TTS and the
 * two would drift.
 */
export type Post = {
  id: string;
  spaceId: string;
  title: string;
  body: string;
  language: Locale;
  /**
   * 0 → a draft that has never left the device. Immutable once set, because
   * it is covered by the signature: withdrawing from the server and later
   * re-sharing must keep both the date and the signature valid.
   */
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
  /** Ed25519 signature over `canonicalPostMessage()`, hex. Set when published. */
  signature?: string;
  /** The signer's public key, hex — pinned per space by the subscriber. */
  authorKey?: string;
  /** Canonicalization version, e.g. `'ba.post.v1'`. */
  sigVersion?: string;
};

/** A space I follow. Keyed by its share code, which is how it is addressed. */
export type Subscription = {
  code: string;
  spaceName: string;
  spaceEmoji?: string;
  /**
   * The kind and expiry of the space as its *owner* set them, refreshed from
   * every feed response. Together they answer "is this their Today space?",
   * which is what "read today's pieces from everyone I follow" filters on — and
   * `kind` lets the built-in name be localized rather than showing the stored
   * literal 'Today' to a reader in another language.
   */
  spaceKind?: 'today' | 'custom';
  spaceEphemeralHours?: number;
  ownerName: string;
  ownerAvatarUrl?: string;
  status: 'pending' | 'accepted' | 'revoked';
  /**
   * The author's signing key, pinned once at subscribe time — after matching
   * the fingerprint in the pasted code where the code carried one, else on
   * first contact. Every post from this space must verify against it, and a key
   * that changes later is an explicit re-pin prompt, never a silent adoption.
   *
   * Unrelated to access, which is `status`: pinning is about *who wrote this*,
   * accepting is about *may I read it*.
   */
  pinnedKey: string;
  keyPinnedAt: number;
  addedAt: number;
  updatedAt: number;
};

/** Somebody following one of my spaces. */
export type Membership = {
  userId: string;
  spaceId: string;
  status: 'pending' | 'accepted' | 'blocked';
  /** Snapshot taken when they asked, so the owner knows who they are deciding on. */
  displayName: string;
  avatarUrl?: string;
  requestedAt: number;
  decidedAt?: number;
};
