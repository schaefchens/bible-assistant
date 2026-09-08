import type { ChatToolDefinition } from '@/services/api/chat';

/**
 * Reading lists: a plan, or a custom collection of passages.
 *
 * `create_reading_list` takes a `plan` rule ({cover, days}) rather than an
 * enumeration, because having the model write out a year — 1,189 chapters — is
 * slow, expensive, and truncates long before it finishes. A truncated plan is a
 * wrong plan.
 */

export type ReadingListToolArgs = {
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
};

export const READING_LIST_TOOLS: ChatToolDefinition[] = [
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
];

/** Whose effect is scripture read aloud — see `READ_TOOL_NAMES`. */
export const READING_LIST_READ_TOOLS = [
  'play_reading_list',
] as const;
