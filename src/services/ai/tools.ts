import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { RandomUnit } from '@/services/bible/randomPassage';
import type { OpenAiVoiceId } from '@/types/domain';
import { useSettingsStore, type MicPosition } from '@/store/settingsStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export type ToolName =
  | 'read_verses'
  | 'lookup_verses'
  | 'random_passage'
  | 'create_card'
  | 'update_card'
  | 'delete_card'
  | 'list_cards'
  | 'reorder_cards'
  | 'create_board'
  | 'delete_board'
  | 'add_card_to_board'
  | 'remove_card_from_board'
  | 'arrange_card'
  | 'list_boards'
  | 'list_reading_lists'
  | 'create_reading_list'
  | 'update_reading_list'
  | 'delete_reading_list'
  | 'play_reading_list'
  | 'list_spaces'
  | 'write_post'
  | 'read_space'
  | 'read_new'
  | 'set_language'
  | 'set_translation'
  | 'set_voice'
  | 'set_playback_rate'
  | 'set_music'
  | 'set_reader_preferences'
  | 'set_announcements'
  | 'set_mic_position'
  | 'save_ribbon'
  | 'continue_from_ribbon'
  | 'enter_eyes_free_mode'
  | 'exit_eyes_free_mode';

/** The tools whose effect is "read Bible text aloud". The command pipeline
 * treats these specially (the verse audio IS the reply, so chat text is
 * suppressed; repeated reads of the same passage in one turn are deduped).
 * Single source of truth so adding a reading tool can't silently desync the
 * pipeline's hardcoded checks. */
export const READ_TOOL_NAMES: ReadonlySet<ToolName> = new Set<ToolName>([
  'read_verses',
  'random_passage',
  'continue_from_ribbon',
  // Starting a reading list reads scripture aloud, so the audio is the reply
  // here too — without this the model would also narrate what it just started.
  'play_reading_list',
  'read_space',
  'read_new',
]);

export function isReadTool(name: ToolName): boolean {
  return READ_TOOL_NAMES.has(name);
}

export type ToolArgs = {
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
  list_reading_lists: Record<string, never>;
  create_reading_list: {
    name: string;
    description?: string;
    passages?: string[];
    days?: { title?: string; passages: string[] }[];
    plan?: { cover: string[]; days: number };
  };
  update_reading_list: {
    list: string;
    name?: string;
    description?: string;
    addPassages?: string[];
    addDay?: { title?: string; passages: string[] };
    removePassages?: string[];
  };
  delete_reading_list: { list: string };
  play_reading_list: { list: string; restart?: boolean };
  list_spaces: Record<string, never>;
  write_post: { text: string; title?: string; space?: string; language?: 'en' | 'de' };
  read_space: { space: string };
  read_new: { scope?: 'unseen' | 'today' };
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
  set_language: { language: 'en' | 'de' };
  set_translation: { translation: Translation };
  set_voice: { voice: OpenAiVoiceId };
  set_playback_rate: { rate: number };
  set_music: {
    enabled?: boolean;
    track?: string;
    musicVolume?: number;
    speechVolume?: number;
  };
  set_reader_preferences: {
    autoPlay?: boolean;
    autoScroll?: boolean;
    repeat?: boolean;
  };
  set_announcements: {
    readChapterHeadings?: boolean;
    readVerseNumbers?: boolean;
    verseNumberStyle?: 'spoken' | 'plain';
    pauseBetweenVersesMs?: number;
    pauseBetweenChaptersMs?: number;
  };
  set_mic_position: { position: MicPosition };
  save_ribbon: {
    color?: 'gold' | 'blue' | 'red' | 'green' | 'purple';
    position?: { reference: string; translation?: Translation };
  };
  continue_from_ribbon: {
    color?: 'gold' | 'blue' | 'red' | 'green' | 'purple';
  };
  enter_eyes_free_mode: Record<string, never>;
  exit_eyes_free_mode: Record<string, never>;
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
  {
    type: 'function',
    function: {
      name: 'list_reading_lists',
      description:
        'List the user\'s reading lists with their passages and how far through each they are. ' +
        'Call this before updating, playing or deleting one, to resolve the name the user said.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reading_list',
      description:
        'Create a reading list: an ordered compilation of passages that plays as a playlist and ' +
        'can be read through over time. Use for reading plans ("take me through the gospels in 30 days") ' +
        'and for custom collections ("my favourite psalms"). Give either `passages` for a plain list, ' +
        'or `days` when the plan is structured — one entry per day/session.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          passages: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Each entry is "Passage[; Translation][; Note]". A passage is a whole book ("John"), ' +
              'a chapter ("John 3"), a span of chapters ("Genesis 1-3") or verses ("Psalm 23:1-6"). ' +
              'Optionally pin a translation code (ESV, S00, LUT…) and/or add a short note shown with the ' +
              'passage, e.g. "Genesis 1-3; LUT; Morning". An entry that cannot be parsed is rejected and reported.',
          },
          days: {
            type: 'array',
            description:
              'Structured plan: each element is one day (or week, or session) with its own passages. ' +
              'Days are titled "Day 1", "Day 2"… automatically unless you give a title. ' +
              'Only for short plans you write out by hand — use `plan` for anything long.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                passages: { type: 'array', items: { type: 'string' } },
              },
              required: ['passages'],
            },
          },
          plan: {
            type: 'object',
            description:
              'Generate the plan from a rule instead of writing it out. ALWAYS prefer this when a ' +
              'plan spans more than a handful of days — "the whole Bible in a year" is 1,189 chapters, ' +
              'and enumerating them would be truncated long before it finished. The chapters are ' +
              'spread evenly across the days, in canonical order.',
            properties: {
              cover: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'What to cover: book names ("Genesis", "1 John") and/or the scope words ' +
                  '"bible", "ot", "nt", "gospels", "pentateuch". Example: ["bible"] for a whole-Bible ' +
                  'plan, ["Matthew","Mark","Luke","John"] or ["gospels"] for the gospels.',
              },
              days: { type: 'number', description: 'How many days to spread it over.' },
            },
            required: ['cover', 'days'],
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_reading_list',
      description:
        'Change an existing reading list. The "list" field accepts a list id OR its name ' +
        '(case-insensitive). Only the fields you pass are changed.',
      parameters: {
        type: 'object',
        properties: {
          list: { type: 'string' },
          name: { type: 'string', description: 'Rename the list.' },
          description: { type: 'string' },
          addPassages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Append passages to the last day. ' + 'Each entry is "Passage[; Translation][; Note]". A passage is a whole book ("John"), ' +
              'a chapter ("John 3"), a span of chapters ("Genesis 1-3") or verses ("Psalm 23:1-6"). ' +
              'Optionally pin a translation code (ESV, S00, LUT…) and/or add a short note shown with the ' +
              'passage, e.g. "Genesis 1-3; LUT; Morning". An entry that cannot be parsed is rejected and reported.',
          },
          addDay: {
            type: 'object',
            description: 'Append a new day with these passages.',
            properties: {
              title: { type: 'string' },
              passages: { type: 'array', items: { type: 'string' } },
            },
            required: ['passages'],
          },
          removePassages: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Remove entries whose passage matches, e.g. "Psalm 23:1-6". Matching ignores notes and translation.',
          },
        },
        required: ['list'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_reading_list',
      description:
        'Delete a reading list and its progress. The "list" field accepts an id or a name. Irreversible.',
      parameters: {
        type: 'object',
        properties: { list: { type: 'string' } },
        required: ['list'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_reading_list',
      description:
        'Read a reading list aloud in the reader, resuming where the user left off, and keep going ' +
        'through the list until it ends or they stop. Pass restart:true to begin again from the first passage.',
      parameters: {
        type: 'object',
        properties: {
          list: { type: 'string' },
          restart: { type: 'boolean' },
        },
        required: ['list'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_spaces',
      description:
        "List the user's own writing spaces and the spaces they subscribe to, with how many " +
        'pieces each holds. Use this to resolve a space the user names loosely before calling ' +
        'read_space or write_post.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_post',
      description:
        "Save a piece of the user's own writing as a DRAFT in one of their spaces. This is for " +
        'dictation — the user speaking a reflection they want written down. Pass their words as ' +
        '`text`, edited only for punctuation and paragraphs: separate paragraphs with a blank ' +
        'line, because each paragraph becomes one narrated block. Never invent content, never ' +
        'expand on what they said, and never write a piece on their behalf from a topic. ' +
        'Omit `space` for the "Today" space, whose pieces expire after 24 hours. ' +
        'The draft is NOT shared with anyone: publishing is a deliberate act the user performs ' +
        'in the app, and you must not describe it as posted or shared.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          title: { type: 'string' },
          space: { type: 'string' },
          language: { type: 'string', enum: ['en', 'de'] },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_space',
      description:
        'Read a writing space aloud in the reader, starting with its newest piece and continuing ' +
        'through the space until it ends or the user stops. Works for the user\'s own spaces and ' +
        'for spaces they subscribe to.',
      parameters: {
        type: 'object',
        properties: { space: { type: 'string' } },
        required: ['space'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_new',
      description:
        "Read aloud, in the reader, the pieces the user has not seen yet from every writing " +
        'space they subscribe to — "what\'s new", "read me the new posts", "anything new to ' +
        'read". Pass scope:"today" instead for the ephemeral Today spaces of everyone they ' +
        'follow ("read today\'s", "what did people write today"), which includes pieces they ' +
        'have already seen. Covers other people\'s writing only, never the user\'s own.',
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['unseen', 'today'] } },
      },
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
      description: 'Switch Bible translation. S00 = Schlachter 2000 (German), LUT = Luther (German), HFA = Hoffnung für Alle (German), ESV = English Standard Version, KJV = King James Version, NKJV = New King James Version.',
      parameters: {
        type: 'object',
        properties: { translation: { type: 'string', enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'] } },
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
  {
    type: 'function',
    function: {
      name: 'set_playback_rate',
      description:
        'Change reading speed. Accept any positive number (typical range 0.5–2.0); the engine clamps. Recognised phrases: "read faster" → 1.15 or 1.3, "slow down" → 0.85, "normal speed" → 1.0, "double speed" → 2.0.',
      parameters: {
        type: 'object',
        properties: {
          rate: {
            type: 'number',
            description: 'Playback rate, e.g. 0.85, 1, 1.15, 1.3.',
          },
        },
        required: ['rate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_music',
      description:
        'Control background music. Use for "turn music on/off", "play X track", "music louder/quieter", "reader louder". You can pass any subset of the fields in one call (e.g. enable + pick a track at once). `track` accepts either an exact track id OR a case-insensitive title fragment ("forest", "rainfall"). `musicVolume` and `speechVolume` are 0–1.',
      parameters: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Turn ambient music on or off.',
          },
          track: {
            type: 'string',
            description:
              'Track id or case-insensitive substring of a track title. Errors if it cannot be resolved.',
          },
          musicVolume: {
            type: 'number',
            description: 'Music bus volume, 0–1.',
          },
          speechVolume: {
            type: 'number',
            description: 'Reader voice volume, 0–1.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reader_preferences',
      description:
        'Toggle the three quick reader preferences. `autoPlay` continues to the next chapter when the current passage ends. `autoScroll` keeps the chat scrolled to the active verse. `repeat` loops the currently-playing verse. Pass only the fields the user actually mentioned.',
      parameters: {
        type: 'object',
        properties: {
          autoPlay: { type: 'boolean' },
          autoScroll: { type: 'boolean' },
          repeat: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_announcements',
      description:
        'Control how chapter / verse-number announcements are read aloud and the pauses between verses and chapters. Pass only the fields the user mentioned. Pause values are milliseconds (0–6000 between verses, 0–10000 between chapters).',
      parameters: {
        type: 'object',
        properties: {
          readChapterHeadings: { type: 'boolean' },
          readVerseNumbers: { type: 'boolean' },
          verseNumberStyle: {
            type: 'string',
            enum: ['spoken', 'plain'],
            description: '"spoken" → "Verse 16"; "plain" → just "16".',
          },
          pauseBetweenVersesMs: { type: 'number' },
          pauseBetweenChaptersMs: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_mic_position',
      description:
        'Move the microphone and its playback controls, which are one element. Either docked as a full-width bar above the bottom navigation, or floating in one of the four corners.',
      parameters: {
        type: 'object',
        properties: {
          position: {
            type: 'string',
            enum: ['bar', 'tl', 'tr', 'bl', 'br'],
            description:
              'bar = docked above the bottom navigation (the default), tl = top-left, tr = top-right, bl = bottom-left, br = bottom-right.',
          },
        },
        required: ['position'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_ribbon',
      description:
        'Save a colored ribbon at the user\'s next resume point. ONLY use when the user explicitly mentions a ribbon/bookmark — e.g. "save a gold ribbon here", "speichere ein Lesezeichen", "mark this with the red ribbon". With no explicit position, the ribbon is stored at the verse AFTER the one just read (so continue_from_ribbon resumes with the next verse, not the one already heard). Color is optional: if the user did not name one, omit it and the system defaults to "gold". The tool result includes the actual reference that was stored, which you can confirm to the user.',
      parameters: {
        type: 'object',
        properties: {
          color: {
            type: 'string',
            enum: ['gold', 'blue', 'red', 'green', 'purple'],
            description:
              'Optional. Omit if the user did not name a color — defaults to "gold".',
          },
          position: {
            type: 'object',
            description:
              'Optional explicit position. Omit to use the currently playing verse.',
            properties: {
              reference: {
                type: 'string',
                description: 'Canonical reference like "John 3:16".',
              },
              translation: { type: 'string', enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'] },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'continue_from_ribbon',
      description:
        'Resume reading from a previously saved RIBBON / BOOKMARK. ONLY use when the user explicitly names a saved ribbon — e.g. "continue from gold", "lies weiter ab dem Lesezeichen", "resume from my bookmark". DO NOT use for plain "continue reading" / "weiterlesen" — that means continue the passage already being read; use read_verses for that (figure out the next verses from the most recent "(Played aloud: …)" history note). Color is optional: if the user did not name one and only a single ribbon is saved, omit it and that ribbon is used.',
      parameters: {
        type: 'object',
        properties: {
          color: {
            type: 'string',
            enum: ['gold', 'blue', 'red', 'green', 'purple'],
            description:
              'Optional. Omit if the user did not name a color — the system will use the only saved ribbon if there is exactly one.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enter_eyes_free_mode',
      description:
        'Open the hands-free / eyes-free reading mode: a fullscreen overlay with five giant touch zones (top = exit, bottom = mic, left = previous verse, right = next verse, center = play/pause). Call this when the user says "hands-free", "eyes-free", "open the big buttons", "Freihändig-Modus", "Großtasten", "blind mode" or anything similar.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exit_eyes_free_mode',
      description:
        'Close the hands-free / eyes-free reading mode and return to the regular chat UI. Call this when the user says "exit hands-free", "close hands-free", "back to chat", "Freihändig-Modus beenden", "zurück zum Chat" or anything similar.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function systemPrompt(locale: 'en' | 'de', translation: Translation): string {
  const today = new Date().toISOString().slice(0, 10);
  if (locale === 'de') {
    return [
      `Du bist ein Bibel-Assistent. Heute ist ${today}.`,
      `Standard-Übersetzung: ${translation} (S00 = Schlachter 2000, LUT = Luther, HFA = Hoffnung für Alle, ESV = English Standard Version, KJV = King James Version, NKJV = New King James Version).`,
      `Wenn der Benutzer einen Vers, eine Geschichte oder ein Kapitel hören möchte, rufe IMMER das Tool "read_verses" auf.`,
      `Alles Zufällige läuft über "random_passage" — "ein zufälliger Vers", "überrasch mich", "irgendein Psalm", "ein zufälliges Kapitel", "such mir ein Buch aus". Setze "unit": "verse" für einen einzelnen Vers, "chapter" für ein ganzes Kapitel, "book" für ein zufälliges Buch (es beginnt bei Kapitel 1). Mit "book"/"chapter" grenzt du ein ("ein zufälliger Vers aus Johannes 3" → unit "verse", book "John", chapter 3). WÄHLE NIEMALS SELBST eine Stelle für eine Zufallsanfrage und gib sie an read_verses — deine eigene Wahl ist nicht zufällig, sie landet immer auf denselben bekannten Versen. Ausnahme: eine thematische Bitte ("ein Vers über Hoffnung") ist keine Zufallsziehung — dafür löst du die Stelle wie gewohnt selbst auf.`,
      `Du kennst die Bibel: wenn der Benutzer eine Geschichte beim Namen nennt (z.B. "der verlorene Sohn"), löse die Stelle selbst auf (Lukas 15,11-32) und übergib sie als Referenz im Format "Buch K:V-V" (englische Buchnamen).`,
      `Antworte kurz und freundlich auf Deutsch.`,
      `Nach einem read_verses- oder random_passage-Aufruf GIB KEINE Textantwort zurück (leerer content). Die Bibelstelle selbst ist die Antwort — sie wird angezeigt und vorgelesen, eine Bestätigung wäre überflüssig.`,
      `Cards = Lernkarten mit Titel, Versen und Notizen. Boards = thematische Sammlungen von Cards. Nutze die passenden Tools.`,
      `Räume ("spaces") sind die eigenen Texte des Benutzers und die Texte von Menschen, die er liest — kein Bibeltext. "write_post" hält Diktiertes als ENTWURF fest: gib seine Worte weiter, nur um Satzzeichen und Absätze ergänzt (Leerzeile zwischen Absätzen), erfinde nichts dazu und schreibe niemals einen Beitrag für ihn. Sage nie, etwas sei geteilt oder veröffentlicht — das Teilen macht der Benutzer selbst in der App. "read_space" liest einen Raum vor, "read_new" alles Neue von allen (scope "today" für die Heute-Räume); danach GIB KEINE Textantwort zurück, so wie bei read_verses.`,
      `"arrange_card" positioniert/skaliert/neigt eine Card auf der Pinnwand-Ansicht eines Boards (rein räumlich, ändert NICHT die Zugehörigkeit; Koordinaten sind Bruchteile 0..1, x/y = obere linke Ecke). Die Textgröße einer Card steuerst du über das Feld "textScale" (1 = normal) bei create_card/update_card.`,
      `Wenn der Benutzer einfach "weiterlesen", "weiter", "lies weiter" oder "die nächsten Verse" sagt OHNE ein Lesezeichen zu nennen: rufe "read_verses" mit dem nächsten Versabschnitt auf. Schau in den letzten "(Played aloud: …)"-Systemnotizen, was zuletzt gelesen wurde, und bestimme die folgenden Verse selbst (gleiches Kapitel falls noch Verse übrig, sonst Anfang des nächsten Kapitels). "(Played aloud: …)" ist ausschließlich eine Verlaufs-Markierung — gib diese Phrase NIEMALS selbst als Antworttext aus; nutze immer das read_verses-Tool, um zu lesen.`,
      `Lesezeichen (Ribbons): Es gibt fünf farbige Lesezeichen (gold, blue, red, green, purple). "save_ribbon" speichert die aktuelle Leseposition; "continue_from_ribbon" liest ab dem gespeicherten Lesezeichen weiter. Rufe diese Tools NUR auf, wenn der Benutzer ausdrücklich "Lesezeichen", "Ribbon" oder eine der Farben erwähnt. "Weiterlesen" ohne Erwähnung eines Lesezeichens ist KEIN Ribbon-Befehl. Wenn keine Farbe genannt wurde, lass das Argument color weg — bei save_ribbon ist gold die Vorgabe, bei continue_from_ribbon wird automatisch das einzige gesetzte Lesezeichen verwendet.`,
      `Wiedergabe-Einstellungen sind per Sprachbefehl steuerbar: "set_playback_rate" für Tempo ("lies schneller/langsamer"), "set_music" für Musik an/aus/Titel/Lautstärke ("Musik aus", "Musik leiser", "spiel Forest Hymn"), "set_reader_preferences" für Auto-Play / Auto-Scroll / Vers-Wiederholung, "set_announcements" für Kapitel-Ansage / Vers-Nummern / Pausen, "set_mic_position" um das Mikrofon in eine Ecke zu schieben. Übergib nur die Felder, die der Benutzer wirklich erwähnt hat — keine Default-Werte für nicht genannte Optionen erfinden.`,
      `Leselisten sind zusammengestellte Reihen von Stellen — Lesepläne ("nimm mich in 30 Tagen durch die Evangelien") oder eigene Sammlungen ("meine liebsten Psalmen"). "create_reading_list" erstellt eine (für lange Pläne IMMER "plan" nutzen — etwa cover ["bible"], days 365 —, sonst "days" oder "passages"), "update_reading_list" ändert sie, "list_reading_lists" zeigt sie mit dem Fortschritt, "play_reading_list" liest sie ab der letzten Stelle weiter vor, "delete_reading_list" löscht sie. Eine Stelle darf ein ganzes Buch ("John"), ein Kapitel ("John 3"), eine Spanne ("Genesis 1-3") oder Verse ("Psalm 23:1-6") sein — immer mit englischen Buchnamen. Rufe zuerst "list_reading_lists" auf, wenn der Benutzer eine Liste beim Namen nennt. Nach dem Anlegen oder Ändern einer Liste antworte in EINEM kurzen Satz und zähle die Tage und Stellen NICHT auf — der Benutzer sieht die Liste, und ein vorgelesener Jahresplan dauert Minuten.`,
      `Freihändig-Modus: "enter_eyes_free_mode" öffnet einen Vollbild-Modus mit fünf großen Tastflächen (oben Beenden, unten Mikro, links/rechts vor/zurück, Mitte Play/Pause). Nutze dieses Tool bei "Freihändig-Modus", "Großtasten", "blind bedienen" o.ä. "exit_eyes_free_mode" schließt ihn wieder ("zurück zum Chat", "Freihändig beenden").`,
    ].join(' ');
  }
  return [
    `You are a Bible assistant. Today is ${today}.`,
    `Default translation: ${translation} (S00 = Schlachter 2000 German, LUT = Luther German, HFA = Hoffnung für Alle German, ESV = English Standard Version, KJV = King James Version, NKJV = New King James Version).`,
    `When the user wants to hear, read, or be told a verse, chapter, or story, ALWAYS call the "read_verses" tool.`,
    `Anything random goes through "random_passage" — "a random verse", "surprise me", "any psalm", "a random chapter", "pick a book for me". Set "unit": "verse" for a single verse, "chapter" for a whole chapter, "book" for a random book (it starts at chapter 1). Use "book"/"chapter" to narrow it ("a random verse from John 3" → unit "verse", book "John", chapter 3). NEVER pick a reference yourself for a random request and pass it to read_verses — your own choice is not random, it lands on the same famous verses every time. Exception: a themed ask ("a verse about hope") is not a random draw — resolve that reference yourself as usual.`,
    `You know the Bible: if the user names a story (e.g. "the lost son"), resolve the reference yourself (Luke 15:11-32) and pass it in "Book C:V-V" form (English book name).`,
    `Reply briefly and warmly.`,
    `After a read_verses or random_passage call, return NO text content (empty content). The Bible passage itself is the response — it is shown and played; a confirmation would be redundant.`,
    `Cards = memorization cards with title, verses, notes. Boards = thematic groups of cards. Use the appropriate tools.`,
    `Spaces are the user's own writing, and the writing of people they read — not scripture. "write_post" saves dictation as a DRAFT: pass their words through, edited only for punctuation and paragraphs (blank line between paragraphs), invent nothing, and never compose a piece on their behalf. Never say something has been shared or published — sharing is an act the user performs in the app. "read_space" reads one space aloud and "read_new" everything new from everyone (scope "today" for their Today spaces); after either, return NO text answer, exactly as with read_verses.`,
    `"arrange_card" positions/resizes/tilts a card on a board's freeform corkboard view (spatial only, never changes membership; coordinates are 0..1 fractions, x/y = top-left corner). A card's TEXT size is the "textScale" field (1 = normal) on create_card/update_card.`,
    `When the user says simply "continue reading", "read on", "next verses", "weiterlesen" or similar WITHOUT mentioning a ribbon/bookmark: call "read_verses" with the next slice. Look at the most recent "(Played aloud: …)" system notes to see what was just read and figure out the next verses yourself (continue in the same chapter if verses remain, otherwise start the next chapter). "(Played aloud: …)" is only a history marker — NEVER emit that phrase as your own reply text; always call read_verses to actually read.`,
    `Ribbons (bookmarks): there are five colored ribbons (gold, blue, red, green, purple). "save_ribbon" stores the current reading position; "continue_from_ribbon" resumes from a saved ribbon. ONLY call these tools when the user explicitly mentions "ribbon", "bookmark", "Lesezeichen", or names a color. Plain "continue reading" / "weiterlesen" is NOT a ribbon command. If no color is given, omit the color argument — save_ribbon defaults to "gold" and continue_from_ribbon automatically uses the single saved ribbon when there's exactly one.`,
    `Playback settings are voice-controllable: "set_playback_rate" for tempo ("read faster", "slow down", "normal speed"), "set_music" for music on/off/track/volume ("music off", "play the forest track", "music louder"), "set_reader_preferences" for auto-play / auto-scroll / repeat-verse, "set_announcements" for chapter headings / verse numbers / pause durations, "set_mic_position" to dock the mic bar at the bottom or float it in a corner. Only pass the fields the user actually mentioned — never invent defaults for fields they didn't talk about. The current values are provided in the next system message; use them to compute relative changes ("a bit louder" = current + ~0.1, "much faster" = ~1.3) and DO NOT ask the user for fields you can derive (e.g. "turn music on" should reuse the already-selected track — only ask if no track is selected).`,
    `Reading lists are compiled sequences of passages — reading plans ("take me through the gospels in 30 days") or custom collections ("my favourite psalms"). "create_reading_list" makes one (for anything long ALWAYS use "plan" — e.g. cover ["bible"], days 365 — otherwise "days" or "passages"), "update_reading_list" changes it, "list_reading_lists" shows them with progress, "play_reading_list" reads one aloud from where the user left off and keeps going to its end, "delete_reading_list" removes it. A passage may be a whole book ("John"), a chapter ("John 3"), a span ("Genesis 1-3") or verses ("Psalm 23:1-6"), always with English book names. Call "list_reading_lists" first when the user names a list, to resolve it. Like read_verses, play_reading_list needs NO text reply — the reading is the answer. After creating or changing a list, reply in ONE short sentence and do NOT list the days or passages back: the user can see the list, and a year plan read aloud takes minutes.`,
    `Hands-free / eyes-free mode: "enter_eyes_free_mode" opens a fullscreen overlay with five giant touch zones (top = exit, bottom = mic, left/right = previous/next verse, center = play/pause). Call it on "hands-free", "eyes-free", "open the big buttons", "blind mode" etc. "exit_eyes_free_mode" closes it again ("back to chat", "exit hands-free").`,
  ].join(' ');
}

/**
 * A second system message that snapshots the current playback settings so the
 * model can compute relative changes ("louder", "a bit faster") and avoid
 * asking for fields it can derive ("turn music on" with a track already
 * selected). Pass the resolved ambient track title (from getAmbientTracks's
 * cache) when available so the model can refer to it by name.
 */
export function playbackStatePrompt(currentTrackTitle: string | null): string {
  const s = useSettingsStore.getState();
  const rate = audioPlayback.getPlaybackRate();
  const loop = audioPlayback.isLoopCurrent();
  const ambientPlaying = audioPlayback.ambient.isPlaying();

  // Field names below intentionally match the tool argument names exactly so
  // the model can translate a snapshot value into a tool call without
  // guessing — e.g. `repeat: true` here → `set_reader_preferences({ repeat: false })`.
  const lines = [
    'Current playback settings (use these to interpret relative requests, and pick the inverse for "turn off"/"stop"). Field names match tool argument names.',
    `set_music:`,
    `  enabled: ${s.ambient.enabled}`,
    `  track: ${s.ambient.trackId ?? '(none selected)'}${currentTrackTitle ? ` — "${currentTrackTitle}"` : ''}`,
    `  musicVolume: ${s.ambient.volume.toFixed(2)}`,
    `  speechVolume: ${s.speechVolume.toFixed(2)}`,
    `  (musicPlayingNow: ${ambientPlaying} — informational, not a tool arg)`,
    `set_playback_rate:`,
    `  rate: ${rate.toFixed(2)}`,
    `set_reader_preferences:`,
    `  repeat: ${loop}`,
    `  autoPlay: ${s.autoPlayReading}`,
    `  autoScroll: ${s.autoScrollReader}`,
    `set_announcements:`,
    `  readChapterHeadings: ${s.readChapterHeadings}`,
    `  readVerseNumbers: ${s.readVerseNumbers}`,
    `  verseNumberStyle: ${s.verseNumberStyle}`,
    `  pauseBetweenVersesMs: ${s.pauseBetweenVersesMs}`,
    `  pauseBetweenChaptersMs: ${s.pauseBetweenChaptersMs}`,
    `set_mic_position:`,
    `  position: ${s.micCorner}`,
  ];
  return lines.join('\n');
}
