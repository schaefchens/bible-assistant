import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { RandomUnit } from '@/services/bible/randomPassage';

/**
 * Reading scripture aloud, and looking it up without playing it.
 *
 * `random_passage` is the only way a random pick is made — both system prompts
 * say so in as many words, because a model asked to "pick a random verse" does
 * not sample: it returns John 3:16, Jeremiah 29:11, Philippians 4:13, forever.
 */

export type ReadingToolArgs = {
  read_verses: { reference: string; translation?: Translation; immediate?: boolean };
  lookup_verses: { reference: string; translation?: Translation };
  random_passage: {
    /** Optional only so a model that omits it still gets the common case;
     * the schema asks for it. Defaults to a single verse. */
    unit?: RandomUnit;
    /** How many to draw in this one call. Exists so "three random verses" is
     * one request: repeating the identical call is treated as the model going
     * round again and is dropped. */
    count?: number;
    book?: string;
    chapter?: number;
    translation?: Translation;
  };
};

export const READING_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_verses',
      description:
        'Fetch a Bible passage and play it aloud. Use this whenever the user wants to hear or read a verse, chapter, or story. Resolve story names (e.g. "the lost son") to a canonical reference yourself.',
      parameters: {
        type: 'object',
        properties: {
          reference: {
            type: 'string',
            description:
              'Canonical reference. Use English book names and chapter:verse format. Examples: single verse "Galatians 5:22", verse range "Matthew 23:8-10", whole chapter "Matthew 1", non-contiguous verses "Matthew 22:37,39", or a mix "Matthew 22:37-39,42". When the user names specific separate verses (e.g. "verse 37 and 39", "Vers 37 und 39"), pass them as a comma-separated list — DO NOT widen to a range that includes verses they did not name.',
          },
          translation: {
            type: 'string',
            enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'],
            description: 'Optional override. Defaults to user-selected translation.',
          },
          immediate: {
            type: 'boolean',
            description:
              'Set to true ONLY when the user wants this passage RIGHT NOW, interrupting whatever is currently playing — signalled by an urgency word like "now", "immediately", "instantly", "right now", or German "sofort", "jetzt", "gleich" (e.g. "read Genesis 1 now", "lies Galater 5 sofort"). It hard-stops the current reading and plays this one immediately. For a plain "read X" / "lies X" with no such word, OMIT it — the passage then queues after the current reading as usual.',
          },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_verses',
      description: 'Fetch and display a passage without auto-playing.',
      parameters: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          translation: { type: 'string', enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'] },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'random_passage',
      description:
        'Draw a random passage and read it aloud. THE ONLY way to pick something at random: never choose a reference yourself for a random request — your own pick is not random, it lands on the same famous verses every time. Use it for "a random verse", "surprise me", "any psalm", "a random chapter", "pick a book for me". `unit` says what to draw: "verse" (one verse), "chapter" (a whole chapter), "book" (a random book, opened at its first chapter). Optional `book` narrows the draw to one book (e.g. "Psalms", "John") and optional `chapter` narrows it further, both in English book names — omit them to draw from the whole Bible. Call this exactly ONCE per request: for several of the same kind ("three random verses") pass `count`, and for several different scopes ("one from the OT and one from Psalms") call once per scope and wait for each result before the next. Never re-call to "improve randomness" or with the same arguments, and never follow it with read_verses for what it returned.',
      parameters: {
        type: 'object',
        properties: {
          unit: {
            type: 'string',
            enum: ['verse', 'chapter', 'book'],
            description:
              'What to draw: "verse" for a single verse (the default reading of "a random verse"), "chapter" for a whole chapter ("a random chapter", "read me a random psalm"), "book" to open a random book at chapter 1 ("pick a book for me to read").',
          },
          count: {
            type: 'number',
            description:
              'How many to draw, 1-5 (default 1). Use this for "give me three random verses" — ONE call with count 3, never three calls: a repeated call with the same arguments is dropped as a re-roll.',
          },
          book: {
            type: 'string',
            description:
              'Optional English book name (e.g. "Psalms", "John") to constrain the draw. Omit to draw from anywhere in the Bible.',
          },
          chapter: {
            type: 'number',
            description:
              'Optional chapter number, only used when "book" is provided and unit is "verse".',
          },
          translation: {
            type: 'string',
            enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'],
            description: 'Optional override. Defaults to user-selected translation.',
          },
        },
        required: ['unit'],
      },
    },
  },
];

/** Whose effect is scripture read aloud — see `READ_TOOL_NAMES`. */
export const READING_READ_TOOLS = [
  'read_verses',
  'random_passage',
] as const;
