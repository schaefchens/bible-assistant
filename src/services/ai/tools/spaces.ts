import type { ChatToolDefinition } from '@/services/api/chat';

/**
 * Community spaces: one person's collection of their own writing.
 *
 * `read_space` and `read_new` open the **reader**, not the chat — chat has no
 * representation for a post. That is why their handlers report
 * `opensReader`: a tool cannot navigate, so the hook does it.
 */

export type SpaceToolArgs = {
  list_spaces: Record<string, never>;
  write_post: { text: string; title?: string; space?: string; language?: 'en' | 'de' };
  read_space: { space: string };
  read_new: { scope?: 'unseen' | 'today' };
};

export const SPACE_TOOLS: ChatToolDefinition[] = [
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
        'for spaces they subscribe to. A space belongs to a person, so it is usually named after ' +
        'them — "Christoph\'s Today", "Anna\'s reflections", or just "Christoph". Pass whatever ' +
        'the user said, author and all: the app matches the author\'s name as well as the ' +
        'space\'s, and answers with the real names when it cannot tell which was meant. A name ' +
        'that does not resolve is NEVER a Bible reference — do not fall back to read_verses.',
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
];

/** Whose effect is scripture read aloud — see `READ_TOOL_NAMES`. */
export const SPACE_READ_TOOLS = [
  'read_space',
  'read_new',
] as const;
