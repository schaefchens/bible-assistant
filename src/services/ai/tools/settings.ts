import type { ChatToolDefinition } from '@/services/api/chat';
import type { Translation } from '@/services/bible/bibleApi';
import type { OpenAiVoiceId } from '@/types/domain';
import type { MicPosition } from '@/store/settingsStore';

/**
 * Preferences, ribbons and hands-free mode — everything the assistant can
 * change about how the app behaves rather than about what it reads.
 *
 * `continue_from_ribbon` is the odd one: it lives here because a ribbon is a
 * saved place, but its effect is scripture read aloud, so it is a read tool.
 */

export type SettingsToolArgs = {
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

export const SETTINGS_TOOLS: ChatToolDefinition[] = [
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

/** Whose effect is scripture read aloud — see `READ_TOOL_NAMES`. */
export const SETTINGS_READ_TOOLS = [
  'continue_from_ribbon',
] as const;
