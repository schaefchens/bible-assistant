import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { VoiceId } from '@/types/domain';

export type ToolName =
  | 'read_verses'
  | 'lookup_verses'
  | 'random_verse'
  | 'create_card'
  | 'update_card'
  | 'delete_card'
  | 'list_cards'
  | 'reorder_cards'
  | 'create_board'
  | 'delete_board'
  | 'add_card_to_board'
  | 'remove_card_from_board'
  | 'list_boards'
  | 'set_language'
  | 'set_translation'
  | 'set_voice';

export type ToolArgs = {
  read_verses: { reference: string; translation?: Translation };
  lookup_verses: { reference: string; translation?: Translation };
  random_verse: {
    book?: string;
    chapter?: number;
    translation?: Translation;
  };
  create_card: { title: string; references: string[]; notes?: string; boards?: string[] };
  update_card: {
    card: string;
    title?: string;
    references?: string[];
    notes?: string;
  };
  delete_card: { card: string };
  list_cards: Record<string, never>;
  reorder_cards: { order: string[] };
  create_board: { name: string; cardIds?: string[] };
  delete_board: { id: string };
  add_card_to_board: { card: string; board: string };
  remove_card_from_board: { card: string; board: string };
  list_boards: Record<string, never>;
  set_language: { language: 'en' | 'de' };
  set_translation: { translation: Translation };
  set_voice: { voice: VoiceId };
};

export const TOOL_DEFINITIONS: ChatToolDefinition[] = [
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
              'Canonical reference like "Galatians 5:22", "Matthew 23:8-10", "Luke 15:11-32", or whole chapter "Matthew 1". Always use English book names with chapter:verse format.',
          },
          translation: {
            type: 'string',
            enum: ['S00', 'ESV'],
            description: 'Optional override. Defaults to user-selected translation.',
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
          translation: { type: 'string', enum: ['S00', 'ESV'] },
        },
        required: ['reference'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'random_verse',
      description:
        'Pick a single random verse from the Bible and read it aloud. Use this when the user asks for a random verse, surprise verse, or wants you to choose for them. Optionally constrain to one book (e.g. "a random Psalm") or one chapter (e.g. "a random verse from John 3").',
      parameters: {
        type: 'object',
        properties: {
          book: {
            type: 'string',
            description:
              'Optional English book name (e.g. "Psalms", "John") to constrain the random pick. Omit for a verse from anywhere in the Bible.',
          },
          chapter: {
            type: 'number',
            description:
              'Optional chapter number, only used when "book" is provided.',
          },
          translation: {
            type: 'string',
            enum: ['S00', 'ESV'],
            description: 'Optional override. Defaults to user-selected translation.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_card',
      description: 'Create a new memorization card from one or more verses.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          references: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of canonical references like ["Galatians 5:22"].',
          },
          notes: { type: 'string' },
          boards: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional boards to attach the new card to. Each entry may be a board id OR a board name (case-insensitive). Returns an error if any entry cannot be resolved.',
          },
        },
        required: ['title', 'references'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_card',
      description:
        'Update fields of an existing card. The "card" field accepts a card id OR an exact card title (case-insensitive). Errors if the card cannot be resolved unambiguously.',
      parameters: {
        type: 'object',
        properties: {
          card: {
            type: 'string',
            description: 'Card id or exact card title (case-insensitive).',
          },
          title: { type: 'string' },
          references: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['card'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_card',
      description:
        'Delete a card. The "card" field accepts a card id OR an exact card title (case-insensitive). Errors if the card cannot be resolved unambiguously.',
      parameters: {
        type: 'object',
        properties: {
          card: {
            type: 'string',
            description: 'Card id or exact card title (case-insensitive).',
          },
        },
        required: ['card'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_cards',
      description:
        'List all cards in the order the user sees them on the /cards screen. Returns array of {id, title, references, notes, tags}. Call this first whenever you need to reason about card identity, order, or position.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorder_cards',
      description:
        'Set the user-visible order of cards on the /cards screen. Pass the full ordered array of card ids (top of the stack first, bottom last). Cards not included keep their relative order at the end. Call list_cards first to learn the current ids.',
      parameters: {
        type: 'object',
        properties: {
          order: {
            type: 'array',
            items: { type: 'string' },
            description: 'Full ordered array of card ids, top first.',
          },
        },
        required: ['order'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_board',
      description: 'Create a new board (a logical group of cards).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cardIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_board',
      description: 'Delete a board by ID (cards remain).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_card_to_board',
      description:
        'Associate a card with a board. Both "card" and "board" accept either an id OR a name/title (case-insensitive). Errors if either cannot be resolved unambiguously.',
      parameters: {
        type: 'object',
        properties: {
          card: {
            type: 'string',
            description: 'Card id or exact card title (case-insensitive).',
          },
          board: {
            type: 'string',
            description: 'Board id or board name (case-insensitive).',
          },
        },
        required: ['card', 'board'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_card_from_board',
      description:
        'Remove a card from a board. Both "card" and "board" accept either an id OR a name/title (case-insensitive). Errors if either cannot be resolved unambiguously.',
      parameters: {
        type: 'object',
        properties: {
          card: {
            type: 'string',
            description: 'Card id or exact card title (case-insensitive).',
          },
          board: {
            type: 'string',
            description: 'Board id or board name (case-insensitive).',
          },
        },
        required: ['card', 'board'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_boards',
      description: 'List all boards with their card IDs.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_language',
      description: 'Switch UI language (en or de).',
      parameters: {
        type: 'object',
        properties: { language: { type: 'string', enum: ['en', 'de'] } },
        required: ['language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_translation',
      description: 'Switch Bible translation. S00 = Schlachter 2000 (German), ESV = English Standard Version.',
      parameters: {
        type: 'object',
        properties: { translation: { type: 'string', enum: ['S00', 'ESV'] } },
        required: ['translation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_voice',
      description: 'Switch TTS voice.',
      parameters: {
        type: 'object',
        properties: {
          voice: {
            type: 'string',
            enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'sage', 'verse'],
          },
        },
        required: ['voice'],
      },
    },
  },
];

export function systemPrompt(locale: 'en' | 'de', translation: Translation): string {
  const today = new Date().toISOString().slice(0, 10);
  if (locale === 'de') {
    return [
      `Du bist ein Bibel-Assistent. Heute ist ${today}.`,
      `Standard-Übersetzung: ${translation} (S00 = Schlachter 2000, ESV = English Standard Version).`,
      `Wenn der Benutzer einen Vers, eine Geschichte oder ein Kapitel hören möchte, rufe IMMER das Tool "read_verses" auf.`,
      `Für zufällige Verse ("ein zufälliger Vers", "ein zufälliger Psalm", "irgendein Vers aus Johannes 3") nutze "random_verse".`,
      `Du kennst die Bibel: wenn der Benutzer eine Geschichte beim Namen nennt (z.B. "der verlorene Sohn"), löse die Stelle selbst auf (Lukas 15,11-32) und übergib sie als Referenz im Format "Buch K:V-V" (englische Buchnamen).`,
      `Antworte kurz und freundlich auf Deutsch.`,
      `Nach einem read_verses- oder random_verse-Aufruf GIB KEINE Textantwort zurück (leerer content). Die Bibelstelle selbst ist die Antwort — sie wird angezeigt und vorgelesen, eine Bestätigung wäre überflüssig.`,
      `Cards = Lernkarten mit Titel, Versen und Notizen. Boards = thematische Sammlungen von Cards. Nutze die passenden Tools.`,
    ].join(' ');
  }
  return [
    `You are a Bible assistant. Today is ${today}.`,
    `Default translation: ${translation} (S00 = Schlachter 2000 German, ESV = English Standard Version).`,
    `When the user wants to hear, read, or be told a verse, chapter, or story, ALWAYS call the "read_verses" tool.`,
    `For random picks ("a random verse", "a random Psalm", "any verse from John 3"), use "random_verse".`,
    `You know the Bible: if the user names a story (e.g. "the lost son"), resolve the reference yourself (Luke 15:11-32) and pass it in "Book C:V-V" form (English book name).`,
    `Reply briefly and warmly.`,
    `After a read_verses or random_verse call, return NO text content (empty content). The Bible passage itself is the response — it is shown and played; a confirmation would be redundant.`,
    `Cards = memorization cards with title, verses, notes. Boards = thematic groups of cards. Use the appropriate tools.`,
  ].join(' ');
}
