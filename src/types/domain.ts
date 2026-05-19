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

export type Card = {
  id: string;
  title: string;
  references: string[];
  notes?: string;
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
