import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { VoiceId } from '@/types/domain';

export type ToolName =
  | 'read_verses'
  | 'lookup_verses'
  | 'create_card'
  | 'update_card'
  | 'delete_card'
  | 'list_cards'
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
  create_card: { title: string; references: string[]; notes?: string; boardIds?: string[] };
  update_card: {
    id: string;
    title?: string;
    references?: string[];
    notes?: string;
  };
  delete_card: { id: string };
  list_cards: Record<string, never>;
  create_board: { name: string; cardIds?: string[] };
  delete_board: { id: string };
  add_card_to_board: { cardId: string; boardId: string };
  remove_card_from_board: { cardId: string; boardId: string };
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
          boardIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional board IDs to attach the new card to.',
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
      description: 'Update fields of an existing card.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          references: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_card',
      description: 'Delete a card by ID.',
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
      name: 'list_cards',
      description: 'List all cards. Returns array of {id, title, references, notes}.',
      parameters: { type: 'object', properties: {} },
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
      description: 'Associate a card with a board.',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string' },
          boardId: { type: 'string' },
        },
        required: ['cardId', 'boardId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_card_from_board',
      description: 'Remove a card from a board.',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string' },
          boardId: { type: 'string' },
        },
        required: ['cardId', 'boardId'],
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
      `Du kennst die Bibel: wenn der Benutzer eine Geschichte beim Namen nennt (z.B. "der verlorene Sohn"), löse die Stelle selbst auf (Lukas 15,11-32) und übergib sie als Referenz im Format "Buch K:V-V" (englische Buchnamen).`,
      `Antworte kurz und freundlich auf Deutsch. Nenne nach einem read_verses-Aufruf nur die gefundene Stelle, nicht den Text — der Text wird in der UI angezeigt und vorgelesen.`,
      `Cards = Lernkarten mit Titel, Versen und Notizen. Boards = thematische Sammlungen von Cards. Nutze die passenden Tools.`,
    ].join(' ');
  }
  return [
    `You are a Bible assistant. Today is ${today}.`,
    `Default translation: ${translation} (S00 = Schlachter 2000 German, ESV = English Standard Version).`,
    `When the user wants to hear, read, or be told a verse, chapter, or story, ALWAYS call the "read_verses" tool.`,
    `You know the Bible: if the user names a story (e.g. "the lost son"), resolve the reference yourself (Luke 15:11-32) and pass it in "Book C:V-V" form (English book name).`,
    `Reply briefly and warmly. After a read_verses call, just confirm the reference — do NOT repeat the verse text; it is shown and played in the UI.`,
    `Cards = memorization cards with title, verses, notes. Boards = thematic groups of cards. Use the appropriate tools.`,
  ].join(' ');
}
