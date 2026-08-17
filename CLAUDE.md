# Bible Assistant — Architecture Map

Mobile-first app for voice-controlled Bible reading: speak (or type) a reference, hear it read aloud. React 19 + Vite + TypeScript + Tailwind v3 + Zustand; a PHP backend (`public/api.php`) proxies OpenAI (chat / TTS / Whisper) and serves Bible text from local Zefania XML.

**Three build targets from one codebase**: the web PWA (`npm run build` → `dist/`, deployed to
https://bibleassistant.apps.schaefchens.de) and native iOS + Android via Capacitor 8
(`npm run build:native` → `dist-native/`, then `cap sync`). See "Native builds" below —
several things differ per target and getting them wrong is the usual source of breakage.

This file is the orientation map. When changing code, find the relevant subsystem here first, then read the named files.

## Commands
- `npm run dev` — Vite dev server (the maintainer usually already has this on `localhost:5173`; probe before starting).
- `npm run build` — `tsc -b && vite build`. **This is the primary correctness gate** — keep it green.
- `npm run build:native` / `npm run sync` — the Capacitor build; `sync` also runs `cap sync`.
- `npm run bible:build` / `bible:verify` — regenerate the offline Bible packs, and diff them
  against golden fixtures from the PHP parser. **Run verify after touching either parser.**
- `./scripts/deploy.sh [--dry-run]` — deploy the PWA + PHP over SFTP. Uses an explicit
  allow-list: it must never upload `storage/` (live user data) or `secrets.php`.
- `npm run lint` — ESLint. Note: a handful of pre-existing `react-hooks/refs` errors live in `EyesFreeMode.tsx`, `FloatingPlaybackBar.tsx`, and `CardStack.tsx`; don't add new ones.

## Entry points
| Concern | File |
| --- | --- |
| Router + error boundary | `src/App.tsx` → routes render under `src/components/common/AppShell.tsx` |
| App init (audio teardown, last-reading, network, key hydration, ambient prefetch) | `AppShell.tsx` effects (→ extracting to `useAppInitialization`) |
| Voice/text command pipeline | `src/hooks/useCommandPipeline.ts` (`send()`), tool loop in `src/services/ai/orchestrate.ts` |
| Global mic / push-to-talk | `src/hooks/useGlobalVoice.ts` + `src/components/voice/*` |
| AI tool definitions (the model's API) | `src/services/ai/tools.ts` |
| AI tool dispatch (the handlers) | `src/services/ai/dispatch.ts` (table-driven `TOOL_REGISTRY`) |
| Audio engine (OpenAI TTS) | `src/lib/audioPlaybackManager.ts` singleton `audioPlayback` |
| Verse/reply/ambient playback (HTMLAudioElement) | `src/lib/elementTrackPlayer.ts`, `src/lib/ambientAudioBus.ts` |
| Browser TTS engine (SpeechSynthesis) | `src/lib/browserTts.ts` singleton `browserTts` |
| Persistent audio + alignment cache (IndexedDB) | `src/lib/mediaCache.ts` |
| Native speech recognition | `src/lib/nativeSpeech.ts` (Whisper stays the fallback) |
| Auto-continuation + prefetch | `src/lib/autoPlay.ts` |
| Bible data / references | `src/services/bible/*` |
| HTTP to backend | `src/services/api/*` (all via `client.ts`) |

## Data flow — a voice command
```
mic / text input
  └─ useGlobalVoice → useCommandPipeline.send(text)
       ├─ isStopCommand? → cancelAllActivity() (kills audio + aborts in-flight)
       └─ postChat({messages, tools})            [services/api/chat.ts → api.php ?action=chat]
            └─ orchestrateToolCalls() loops while the model calls tools:
                 dispatchTool(name, args)         [services/ai/dispatch.ts → TOOL_REGISTRY]
                   ├─ read_verses → getChapter/getVerses → buildPlaybackPlan
                   │     → startPlayback → audioPlayback.enqueue / browserTts.enqueue
                   │         → playbackStore.setStatus / setCurrent  (UI reads these)
                   ├─ create_card / create_board → libraryStore (+ Dexie + sync queue)
                   └─ set_* → settingsStore
            └─ assistant reply (if no read action) → speakAssistantReply → TTS
```
Reading aloud is the response: pure `read_verses` turns emit **no** chat text, only audio (logged as a `historyNote` so the model can later "continue reading").

## Stores (Zustand) — who owns what
All in `src/store/`. `(persist)` = survives reload via `zustand/middleware`.
| Store | Owns |
| --- | --- |
| `usePlaybackStore` | **Source of truth for audio state**: status, current track, word index (drives `WordHighlighter`), volumes |
| `useChatStore` | Conversation history, `isProcessing`, `currentTool` |
| `useSettingsStore` *(persist v12 + migrations)* | User prefs: locale, translation, voices, reading/announcement prefs, ambient, mic corner |
| `useLibraryStore` | Cards + boards + their order + the offline sync queue (flushed to `api.php`) |
| `useRibbonsStore` *(persist)* | Colored bookmarks ("ribbons") |
| `useGlobalVoiceStore` | Mic listening state, last voice response |
| `useLastReadingStore` *(persist)* | Resume point for "play last reading" |
| `useUiLayoutStore` | Transient layout (composer height, etc.) |
| `useUpdateStore` (in `lib/pwaUpdate.ts`) | PWA update-available flag *(named `use*` though it's a store, not a hook — a known, intentionally-left naming exception)* |

**Store reads from services/lib go through `src/services/storeAccess.ts`** (the single read contract). React components use the `useXStore(selector)` hooks directly for reactivity.

## Layer rules
- `components/` → call hooks + store selector hooks; presentational.
- `hooks/` → orchestrate; call `lib/` and `services/`.
- `lib/` → stateful singletons & logic (audio, gestures, sound cues); read stores via `storeAccess`.
- `services/` → stateless data access. `services/api/*` = HTTP; `services/bible/*` = reference parsing + verse fetch/format; `services/ai/*` = tool contract + dispatch.
- `store/` → Zustand state. `types/domain.ts` = canonical shared types. `utils/` = pure helpers.

## Naming conventions
- `use*` is reserved for **React hooks** (`hooks/`) and **Zustand store hooks** (`store/`).
- `lib/` singletons are camelCase nouns: `audioPlayback`, `browserTts`.
- `services/` modules export plain functions, not singletons.

## Backend — `public/api.php`
Single PHP entry; routes on `?action=`. Per-user data dirs keyed by an identity derived from the user's passphrase. OpenAI actions (`chat`, `tts`, `tts.speak`, `transcribe`, `recording.upload`) require a key — a personal key (sent by the client) or the shared key, selected via the `X-Prefer-Shared-Key` header.

Actions: `chat`, `tts`, `tts.speak`, `bible.chapter`, `transcribe`, `auth.openaiKey.{status,set,clear}`, `cards.{list,upsert,delete,order.get,order.set}`, `boards.{list,upsert,delete,order.get,order.set}`, `recording.upload`, `ambient.list`.

Bible text is parsed from Zefania XML in `public/bibles/*.xml` (S00, S51, LUT, HFA, ELB = German; ESV, KJV, NKJV = English). Client base URL + error handling: `src/services/api/client.ts` (`apiPostJson` / `apiGetJson` / `apiPostForm`, `ApiError`, `onUserKeyFailure`).

## Native builds (Capacitor 8) — the per-target differences

`vite build --mode capacitor` is a genuinely different artifact, not just a repackaged web build:

| | web | native |
| --- | --- | --- |
| `base` | `/` | `./` |
| outDir | `dist/` | `dist-native/` |
| `publicDir` | `public/` | **off** — an allow-list is copied instead |
| Router | `BrowserRouter` | `HashRouter` (Android WebView ≥117 won't change paths on custom schemes) |
| Service worker | yes | none — no SW under `capacitor://` |
| API origin | same-origin, relative | absolute, from `.env.capacitor` (`src/services/api/origin.ts`) |
| Bible source | `bible.chapter` POST | bundled LUT/KJV packs first, then downloads, then network |

**`webDir` must stay `dist-native`.** `dist/` is ~300 MB and contains `secrets.php` (a live
OpenAI key), `storage/` (every user's cards + `secret.txt`) and the Bible XML, because Vite
copies `public/` verbatim. `vite.config.ts` has a recursive `closeBundle` assertion that fails
the build if any of that reaches the bundle — don't weaken it.

### Audio: why playback is an HTMLAudioElement, not Web Audio
Measured on iOS, not assumed: WebKit **suspends the AudioContext** as soon as the page is
hidden. Over a 13 s background window `ctx.currentTime` froze at 7.97 while a media element's
`currentTime` advanced 9.02 → 22.17. `UIBackgroundModes: audio` does not change this — Web Audio
never gets background privileges, and iOS only attaches lock-screen controls to media elements.

So: verses, assistant replies and ambient music run on media elements
(`elementTrackPlayer.ts`, `ambientAudioBus.ts`). The AudioContext remains **only** for UI cues
(`micCue`, `clickTick`, `thinkingDrone`, `speakLabel`), which are foreground-only so suspension
is harmless. Word highlighting reads `element.currentTime` directly.

Two traps live in `elementTrackPlayer.ts`, both learned the hard way:
- Priming with `play()` on a **src-less** element wedges it at `readyState 0` forever — prime
  with a real silent WAV, and always call `.load()` after assigning `src`.
- Never clear `src` from an async callback; it races `load()` and wipes the track out from
  under the element.

Interruptions (calls, Siri, headphone unplug) are handled by *following the element*: it fires
`pause`, and `onExternalPause` syncs app state. Web Audio gave no such signal. `AppDelegate`
reactivates the `AVAudioSession` when an interruption ends; playback deliberately does **not**
auto-resume.

### Speech input
Native builds prefer on-device recognition (`nativeSpeech.ts`, `@capgo/capacitor-speech-recognition`).
The Web Speech API does not exist in either WebView, so the web build is Whisper-only, and
Whisper (`?action=transcribe`) remains the fallback everywhere.

The iOS workaround layer — `iosAudioRouting.ts`'s silent-WAV nudge, the AEC/AGC-disabling
`micConstraints()`, `DUCK_FACTOR = 0` — is now **only on the Whisper/push-to-talk path**, which
still uses `getUserMedia` and so still hijacks the audio session. It can't be deleted while that
fallback exists.
