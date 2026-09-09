import type { ChatToolDefinition } from '@/services/api/chat';

/**
 * Shelves: one person's collection of their own writing, and the shelves they
 * read.
 *
 * **The tools are named `_shelf`; the code is still `Space`.** That is the same
 * line the rest of the app draws — copy says shelf, code says space — but the
 * tool contract sits on the *copy* side of it, because a tool name is what the
 * model reads and reasons with. Handed `read_space` while every string it sees
 * says "Regal", gpt-4o-mini has to make the connection itself, and it made it
 * unreliably. Tool names are also the cheapest thing in this app to rename:
 * they are sent fresh with every request and persisted nowhere, unlike
 * `spaceId`, `spaces.upsert` or `storage/users/{id}/items/{spaceId}.json`.
 *
 * **Everything a shelf can have done to it is here.** The app's selling point
 * is that it can be driven without looking at it, and "the user does that part
 * themselves in the app" is exactly the assumption that breaks the promise —
 * so making a shelf, renaming it, putting things on it, taking them off,
 * publishing a piece, deciding who may read, and letting go of somebody
 * else's shelf are all callable.
 *
 * Two things are deliberately **not**, and both are complaints rather than
 * housekeeping: blocking an author and reporting content. They are rare,
 * they are about a person, and a misheard word should not be able to cut
 * somebody off — those stay in the app, where they take a deliberate tap.
 *
 * Following a shelf has no tool either, for a plainer reason: a share code is
 * eighteen characters of base32 and a speech-to-text transcript of one is a
 * coin flip. Pasting it into the chat is handled *before* the model sees it —
 * see `shelfCodeIntent` and `useCommandPipeline`.
 *
 * `read_shelf` and `read_new` open the **reader**, not the chat — chat has no
 * representation for a piece. That is why their handlers report `opensReader`:
 * a tool cannot navigate, so the hook does it.
 */

export type SpaceToolArgs = {
  list_shelves: Record<string, never>;
  create_shelf: { name: string; description?: string };
  update_shelf: {
    shelf: string;
    name?: string;
    description?: string;
    approval?: 'manual' | 'auto';
  };
  delete_shelf: { shelf: string };
  share_shelf: { shelf: string };
  decide_reader: { reader: string; decision: 'accept' | 'deny'; shelf?: string };
  write_piece: { text: string; title?: string; shelf?: string; language?: 'en' | 'de' };
  publish_piece: { piece: string };
  delete_piece: { piece: string };
  add_to_shelf: { shelf?: string; plan?: string; board?: string };
  remove_from_shelf: { shelf?: string; plan?: string; board?: string; piece?: string };
  read_shelf: { shelf: string };
  read_new: { scope?: 'unseen' | 'today' };
  unfollow_shelf: { shelf: string };
  copy_from_shelf: { plan?: string; board?: string };
};

const OWN_SHELF = "One of the user's own shelves, by name.";
/** Repeated on both tools that put something on a shelf, and on `publish_piece`. */
const SNAPSHOT =
  'A snapshot is published, not a live link: later edits reach readers only when the user ' +
  'shares it again. Omit `shelf` only if the user has exactly one; otherwise ask which.';

export const SPACE_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_shelves',
      description:
        "List the user's own shelves and the shelves they read, with what each holds and who " +
        'is waiting to be let in. Call this to resolve a shelf, a piece, or a reader the user ' +
        'names loosely before acting on it.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_shelf',
      description:
        'Make a new shelf of the user\'s own. A shelf holds their pieces, reading plans and ' +
        'boards, and is shared with a code afterwards — creating one shares nothing with anybody.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'One line on what the shelf is for.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_shelf',
      description:
        "Rename one of the user's shelves, change its description, or change whether holding " +
        'its code is enough to read it ("auto") or the user decides each reader ("manual"). ' +
        'Pass only what changes. The Today shelf cannot be renamed.',
      parameters: {
        type: 'object',
        properties: {
          shelf: { type: 'string', description: OWN_SHELF },
          name: { type: 'string' },
          description: { type: 'string' },
          approval: { type: 'string', enum: ['manual', 'auto'] },
        },
        required: ['shelf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_shelf',
      description:
        "Delete one of the user's own shelves and everything on it, for everybody who reads " +
        'it. This cannot be undone, so ASK THE USER TO CONFIRM in your previous turn and call ' +
        'this only once they have said yes. The Today shelf cannot be deleted.',
      parameters: {
        type: 'object',
        properties: { shelf: { type: 'string', description: OWN_SHELF } },
        required: ['shelf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'share_shelf',
      description:
        'Get the share code for one of the user\'s own shelves, making one if it has none. ' +
        'The code is an address, not a password: holding it lets somebody ask to read. Tell ' +
        'the user the code exists and that the shelf screen can send it as a link — reading ' +
        'eighteen characters aloud is not much use to them.',
      parameters: {
        type: 'object',
        properties: { shelf: { type: 'string', description: OWN_SHELF } },
        required: ['shelf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'decide_reader',
      description:
        'Let somebody in to one of the user\'s shelves, or turn them down. Use the name as ' +
        '`list_shelves` reported it. Only people who have already asked can be decided on.',
      parameters: {
        type: 'object',
        properties: {
          reader: { type: 'string', description: 'The person, by the name they asked under.' },
          decision: { type: 'string', enum: ['accept', 'deny'] },
          shelf: { type: 'string', description: 'Only needed if they have asked for several.' },
        },
        required: ['reader', 'decision'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_piece',
      description:
        "Save a piece of the user's own writing as a DRAFT on one of their shelves. This is " +
        'for dictation — the user speaking a reflection they want written down. Pass their ' +
        'words as `text`, edited only for punctuation and paragraphs: separate paragraphs with ' +
        'a blank line, because each paragraph becomes one narrated block. Never invent content, ' +
        'never expand on what they said, and never write a piece on their behalf from a topic. ' +
        'Omit `shelf` for the "Today" shelf, whose pieces expire after 24 hours. A draft is not ' +
        'yet readable by anyone — publish_piece does that, as a separate act.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          title: { type: 'string' },
          shelf: { type: 'string' },
          language: { type: 'string', enum: ['en', 'de'] },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_piece',
      description:
        'Publish one of the user\'s draft pieces, so the people who read that shelf can read ' +
        'it. It is signed with their key and checked against the content standards, and it may ' +
        'be refused — say so plainly if it is. Only do this when the user asks for it; writing ' +
        'a piece down and publishing it are two separate requests.',
      parameters: {
        type: 'object',
        properties: { piece: { type: 'string', description: 'The piece, by title.' } },
        required: ['piece'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_piece',
      description:
        "Delete one of the user's own pieces outright — from their device and from anyone " +
        'reading it. This destroys their writing and cannot be undone, so ASK THEM TO CONFIRM ' +
        'first. To merely stop sharing it and keep the text, use remove_from_shelf instead.',
      parameters: {
        type: 'object',
        properties: { piece: { type: 'string', description: 'The piece, by title.' } },
        required: ['piece'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_shelf',
      description:
        "Put one of the user's reading plans or boards on one of their own shelves, so the " +
        'people who read it can follow it and take their own copy. Pass exactly one of `plan` ' +
        'or `board`. ' +
        SNAPSHOT,
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: 'A reading list of theirs, by name.' },
          board: { type: 'string', description: 'A board of theirs, by name.' },
          shelf: { type: 'string', description: OWN_SHELF },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_shelf',
      description:
        'Take something off one of the user\'s own shelves, so their readers no longer see it. ' +
        'Pass exactly one of `plan`, `board` or `piece`. Nothing of theirs is destroyed: a plan ' +
        'and a board stay in their library, and a piece goes back to being a draft.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string' },
          board: { type: 'string' },
          piece: { type: 'string' },
          shelf: { type: 'string', description: OWN_SHELF },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_shelf',
      description:
        'Read a shelf aloud in the reader, starting with its newest piece and continuing ' +
        'through the shelf until it ends or the user stops. Works for the user\'s own shelves ' +
        'and for shelves they read. A shelf belongs to a person, so it is usually named ' +
        'after them — "Christoph\'s Today", "Anna\'s reflections", or just "Christoph". Pass ' +
        'whatever the user said, author and all: the app matches the author\'s name as well as ' +
        'the shelf\'s, and answers with the real names when it cannot tell which was meant. A name ' +
        'that does not resolve is NEVER a Bible reference — do not fall back to read_verses.',
      parameters: {
        type: 'object',
        properties: { shelf: { type: 'string' } },
        required: ['shelf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_new',
      description:
        "Read aloud, in the reader, the pieces the user has not seen yet from every shelf " +
        'they read — "what\'s new", "read me the new pieces", "anything new to read". Pass ' +
        'scope:"today" instead for the Today shelves of everyone they follow ("read today\'s", ' +
        '"what did people write today"), which includes pieces they have already seen. Covers ' +
        "other people's writing only, never the user's own.",
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['unseen', 'today'] } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unfollow_shelf',
      description:
        'Stop reading somebody else\'s shelf. Nothing of theirs and nothing of the user\'s is ' +
        'destroyed, and the code would let them back in, but say what is happening before ' +
        'doing it if the request was at all vague.',
      parameters: {
        type: 'object',
        properties: { shelf: { type: 'string', description: 'The shelf, or its author, by name.' } },
        required: ['shelf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_from_shelf',
      description:
        'Take the user\'s own editable copy of a reading plan or board somebody else shared ' +
        'with them. The copy is theirs to change and is not linked to the original: later ' +
        'edits by its author do not reach it. Pass exactly one of `plan` or `board`.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: "A shared plan, by name." },
          board: { type: 'string', description: 'A shared board, by name.' },
        },
      },
    },
  },
];

/** Whose effect is text read aloud — see `READ_TOOL_NAMES`. */
export const SPACE_READ_TOOLS = [
  'read_shelf',
  'read_new',
] as const;
