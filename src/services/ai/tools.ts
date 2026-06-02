import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';
import { useSettingsStore } from '@/store/settingsStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';

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
  'random_verse',
  'continue_from_ribbon',
]);

export function isReadTool(name: ToolName): boolean {
  return READ_TOOL_NAMES.has(name);
}

export type ToolArgs = {
  read_verses: { reference: string; translation?: Translation; immediate?: boolean };
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
  set_mic_position: { corner: 'tl' | 'tr' | 'bl' | 'br' };
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
      name: 'random_verse',
      description:
        'Pick ONE random verse from the Bible and read it aloud. Call this exactly ONCE for each verse the user explicitly asked for — never re-call to "improve randomness" or with the same arguments. For a plain "give me a random verse", call exactly once and stop. If the user asks for several with different scopes (e.g. "one from the OT and one from Psalms"), call once per scope and wait for each result before issuing the next. Optional `book` constrains the pick to one book (e.g. "Psalms", "John"); optional `chapter` constrains further.',
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
            enum: ['S00', 'ESV', 'KJV', 'NKJV', 'LUT', 'HFA', 'S51', 'ELB'],
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
        'Move the floating microphone to a corner. The playback bar (when visible) sits in the opposite corner automatically.',
      parameters: {
        type: 'object',
        properties: {
          corner: {
            type: 'string',
            enum: ['tl', 'tr', 'bl', 'br'],
            description:
              'tl = top-left, tr = top-right, bl = bottom-left, br = bottom-right.',
          },
        },
        required: ['corner'],
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
      `Für zufällige Verse ("ein zufälliger Vers", "ein zufälliger Psalm", "irgendein Vers aus Johannes 3") nutze "random_verse".`,
      `Du kennst die Bibel: wenn der Benutzer eine Geschichte beim Namen nennt (z.B. "der verlorene Sohn"), löse die Stelle selbst auf (Lukas 15,11-32) und übergib sie als Referenz im Format "Buch K:V-V" (englische Buchnamen).`,
      `Antworte kurz und freundlich auf Deutsch.`,
      `Nach einem read_verses- oder random_verse-Aufruf GIB KEINE Textantwort zurück (leerer content). Die Bibelstelle selbst ist die Antwort — sie wird angezeigt und vorgelesen, eine Bestätigung wäre überflüssig.`,
      `Cards = Lernkarten mit Titel, Versen und Notizen. Boards = thematische Sammlungen von Cards. Nutze die passenden Tools.`,
      `Wenn der Benutzer einfach "weiterlesen", "weiter", "lies weiter" oder "die nächsten Verse" sagt OHNE ein Lesezeichen zu nennen: rufe "read_verses" mit dem nächsten Versabschnitt auf. Schau in den letzten "(Played aloud: …)"-Systemnotizen, was zuletzt gelesen wurde, und bestimme die folgenden Verse selbst (gleiches Kapitel falls noch Verse übrig, sonst Anfang des nächsten Kapitels). "(Played aloud: …)" ist ausschließlich eine Verlaufs-Markierung — gib diese Phrase NIEMALS selbst als Antworttext aus; nutze immer das read_verses-Tool, um zu lesen.`,
      `Lesezeichen (Ribbons): Es gibt fünf farbige Lesezeichen (gold, blue, red, green, purple). "save_ribbon" speichert die aktuelle Leseposition; "continue_from_ribbon" liest ab dem gespeicherten Lesezeichen weiter. Rufe diese Tools NUR auf, wenn der Benutzer ausdrücklich "Lesezeichen", "Ribbon" oder eine der Farben erwähnt. "Weiterlesen" ohne Erwähnung eines Lesezeichens ist KEIN Ribbon-Befehl. Wenn keine Farbe genannt wurde, lass das Argument color weg — bei save_ribbon ist gold die Vorgabe, bei continue_from_ribbon wird automatisch das einzige gesetzte Lesezeichen verwendet.`,
      `Wiedergabe-Einstellungen sind per Sprachbefehl steuerbar: "set_playback_rate" für Tempo ("lies schneller/langsamer"), "set_music" für Musik an/aus/Titel/Lautstärke ("Musik aus", "Musik leiser", "spiel Forest Hymn"), "set_reader_preferences" für Auto-Play / Auto-Scroll / Vers-Wiederholung, "set_announcements" für Kapitel-Ansage / Vers-Nummern / Pausen, "set_mic_position" um das Mikrofon in eine Ecke zu schieben. Übergib nur die Felder, die der Benutzer wirklich erwähnt hat — keine Default-Werte für nicht genannte Optionen erfinden.`,
      `Freihändig-Modus: "enter_eyes_free_mode" öffnet einen Vollbild-Modus mit fünf großen Tastflächen (oben Beenden, unten Mikro, links/rechts vor/zurück, Mitte Play/Pause). Nutze dieses Tool bei "Freihändig-Modus", "Großtasten", "blind bedienen" o.ä. "exit_eyes_free_mode" schließt ihn wieder ("zurück zum Chat", "Freihändig beenden").`,
    ].join(' ');
  }
  return [
    `You are a Bible assistant. Today is ${today}.`,
    `Default translation: ${translation} (S00 = Schlachter 2000 German, LUT = Luther German, HFA = Hoffnung für Alle German, ESV = English Standard Version, KJV = King James Version, NKJV = New King James Version).`,
    `When the user wants to hear, read, or be told a verse, chapter, or story, ALWAYS call the "read_verses" tool.`,
    `For random picks ("a random verse", "a random Psalm", "any verse from John 3"), use "random_verse".`,
    `You know the Bible: if the user names a story (e.g. "the lost son"), resolve the reference yourself (Luke 15:11-32) and pass it in "Book C:V-V" form (English book name).`,
    `Reply briefly and warmly.`,
    `After a read_verses or random_verse call, return NO text content (empty content). The Bible passage itself is the response — it is shown and played; a confirmation would be redundant.`,
    `Cards = memorization cards with title, verses, notes. Boards = thematic groups of cards. Use the appropriate tools.`,
    `When the user says simply "continue reading", "read on", "next verses", "weiterlesen" or similar WITHOUT mentioning a ribbon/bookmark: call "read_verses" with the next slice. Look at the most recent "(Played aloud: …)" system notes to see what was just read and figure out the next verses yourself (continue in the same chapter if verses remain, otherwise start the next chapter). "(Played aloud: …)" is only a history marker — NEVER emit that phrase as your own reply text; always call read_verses to actually read.`,
    `Ribbons (bookmarks): there are five colored ribbons (gold, blue, red, green, purple). "save_ribbon" stores the current reading position; "continue_from_ribbon" resumes from a saved ribbon. ONLY call these tools when the user explicitly mentions "ribbon", "bookmark", "Lesezeichen", or names a color. Plain "continue reading" / "weiterlesen" is NOT a ribbon command. If no color is given, omit the color argument — save_ribbon defaults to "gold" and continue_from_ribbon automatically uses the single saved ribbon when there's exactly one.`,
    `Playback settings are voice-controllable: "set_playback_rate" for tempo ("read faster", "slow down", "normal speed"), "set_music" for music on/off/track/volume ("music off", "play the forest track", "music louder"), "set_reader_preferences" for auto-play / auto-scroll / repeat-verse, "set_announcements" for chapter headings / verse numbers / pause durations, "set_mic_position" to move the mic to a corner. Only pass the fields the user actually mentioned — never invent defaults for fields they didn't talk about. The current values are provided in the next system message; use them to compute relative changes ("a bit louder" = current + ~0.1, "much faster" = ~1.3) and DO NOT ask the user for fields you can derive (e.g. "turn music on" should reuse the already-selected track — only ask if no track is selected).`,
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
    `  corner: ${s.micCorner}`,
  ];
  return lines.join('\n');
}
