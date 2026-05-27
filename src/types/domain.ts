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

export type CardVerseRange = { start: number; end: number };

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
  createdAt: number;
  updatedAt: number;
};

export type BoardViewMode = 'grid' | 'stack' | 'pile';

export type Board = {
  id: string;
  name: string;
  cardIds: string[];
  color?: CardColor;
  emoji?: string;
  viewMode?: BoardViewMode;
  createdAt: number;
  updatedAt: number;
};
