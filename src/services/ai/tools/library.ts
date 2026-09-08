import type { ChatToolDefinition } from '@/services/api/chat';

/**
 * Cards and boards — a verse note, and a group of them for memorization.
 *
 * The only domain here with no reading tool: everything in it returns data or
 * confirms a write, so the assistant always has something to say back.
 */

export type LibraryToolArgs = {
  create_card: {
    title: string;
    references: string[];
    notes?: string;
    boards?: string[];
    textScale?: number;
  };
  update_card: {
    card: string;
    title?: string;
    references?: string[];
    notes?: string;
    textScale?: number;
  };
  delete_card: { card: string };
  list_cards: Record<string, never>;
  reorder_cards: { order: string[] };
  create_board: { name: string; cardIds?: string[] };
  delete_board: { id: string };
  add_card_to_board: { card: string; board: string };
  remove_card_from_board: { card: string; board: string };
  arrange_card: {
    board: string;
    card: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
  };
  list_boards: Record<string, never>;
};

export const LIBRARY_TOOLS: ChatToolDefinition[] = [
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
            description:
              'Array of references. Each entry is "Reference[; Translation][; Custom text]". ' +
              'The reference is canonical like "Galatians 5:22". You may pin a translation code ' +
              '(e.g. ESV, S00, LUT) and/or add a short highlighted note. ' +
              'Examples: "Galatians 5:22", "Galatians 5:22; ESV", "Galatians 5:22; LUT; The fruit of the Spirit". ' +
              'To compare translations, add two entries for the same verse with different codes.',
          },
          notes: { type: 'string' },
          boards: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional boards to attach the new card to. Each entry may be a board id OR a board name (case-insensitive). Returns an error if any entry cannot be resolved.',
          },
          textScale: {
            type: 'number',
            description:
              "Optional text-size multiplier for the card's title/verses/notes. 1 = normal, " +
              '0.7 = smallest, 2 = largest (clamped). Use for "make the text bigger/smaller".',
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
          references: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Replaces all references. Each entry is "Reference[; Translation][; Custom text]", ' +
              'e.g. "Galatians 5:22; ESV; The fruit of the Spirit".',
          },
          notes: { type: 'string' },
          textScale: {
            type: 'number',
            description:
              "Text-size multiplier for the card's title/verses/notes. 1 = normal, 0.7 = smallest, " +
              '2 = largest (clamped). Use for "make the text on card X bigger/smaller".',
          },
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
      name: 'arrange_card',
      description:
        "Position, resize, or tilt a card on a board's FREEFORM corkboard view. " +
        'This is purely spatial — it does NOT add or remove the card from the board ' +
        '(use add_card_to_board / remove_card_from_board for membership). The card must ' +
        'already be on the board. Both "card" and "board" accept an id OR a name/title ' +
        '(case-insensitive). All spatial values are FRACTIONS of the board (0..1): the board ' +
        'is a fixed A4 sheet, x=0,y=0 is the TOP-LEFT corner and x=1,y=1 the bottom-right. ' +
        '"x"/"y" set the card\'s top-left corner; "width"/"height" set its size as fractions ' +
        'of board width/height (independent — aspect ratio is free); "rotation" is the tilt in ' +
        'degrees, clockwise positive (e.g. 5 tilts right, -5 left). Pass only the fields you ' +
        'want to change; omitted fields keep their current value. Example: place a card near ' +
        'the top-left, tilted left → x:0.05, y:0.05, rotation:-4.',
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
          x: { type: 'number', description: 'Top-left X as a fraction of board width, 0..1.' },
          y: { type: 'number', description: 'Top-left Y as a fraction of board height, 0..1.' },
          width: { type: 'number', description: 'Card width as a fraction of board width, 0..1.' },
          height: { type: 'number', description: 'Card height as a fraction of board height, 0..1.' },
          rotation: { type: 'number', description: 'Tilt in degrees, clockwise positive.' },
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
];
