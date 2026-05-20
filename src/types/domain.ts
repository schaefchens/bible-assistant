import type { Translation } from '@/services/bible/bibleApi';

export type Locale = 'en' | 'de';

export type VoiceId =
  | 'alloy'
  | 'echo'
  | 'fable'
  | 'onyx'
  | 'nova'
  | 'shimmer'
  | 'coral'
  | 'sage'
  | 'verse';

export const VOICE_OPTIONS: VoiceId[] = [
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

export type Card = {
  id: string;
  title: string;
  references: string[];
  notes?: string;
  tags?: string[];
  color?: CardColor;
  emoji?: string;
  createdAt: number;
  updatedAt: number;
};

export type Board = {
  id: string;
  name: string;
  cardIds: string[];
  createdAt: number;
  updatedAt: number;
};
