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

export type VerseSummary = {
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
  text: string;
  /** "Galatians 5:22" or "Galater 5,22" depending on locale */
  display: string;
};

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
