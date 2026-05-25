import { useCallback, useEffect, useMemo, useState } from 'react';
import { postChat, type ChatRequestMessage } from '@/services/api/chat';
import { postTtsSpeak } from '@/services/api/tts';
import {
  TOOL_DEFINITIONS,
  playbackStatePrompt,
  systemPrompt,
  type ToolName,
} from '@/services/ai/tools';
import { dispatchTool } from '@/services/ai/dispatch';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useGlobalVoiceStore, type VoiceSource } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { browserTts } from '@/lib/browserTts';
import { cancelAutoPlayPrefetch } from '@/lib/autoPlay';
import { getAmbientTracks } from '@/services/api/ambient';
import { getChapter, type Translation } from '@/services/bible/bibleApi';
import { formatReference, getBookById } from '@/services/bible/bookCatalog';
import { parseReference } from '@/services/bible/referenceParser';
import { isBrowserVoice, type ChatMessage, type ToolCallSummary, type VerseSummary } from '@/types/domain';

const MAX_TOOL_LOOPS = 6;

// Voice/text phrases that map to "stop everything happening right now".
// Normalized to lower-case and trimmed of trailing punctuation before lookup.
const STOP_PHRASES = new Set([
  // English
  'stop',
  'stop it',
  'stop now',
  'stop reading',
  'stop playing',
  'stop playback',
  'cancel',
  'cancel that',
  'halt',
  'quiet',
  'silence',
  'be quiet',
  'shut up',
  'enough',
  'quit',
  'end',
  // German
  'stopp',
  'stoppen',
  'halt an',
  'anhalten',
  'ruhe',
  'leise',
  'still',
  'abbrechen',
  'ende',
  'aufhören',
  'hör auf',
  'hör auf damit',
  'hör bitte auf',
]);

function isStopCommand(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  return STOP_PHRASES.has(normalized);
}

/**
 * In-flight pipeline so a follow-up "stop" command can abort it. Only one
 * send runs at a time (guarded by `isProcessing`), so a single ref is enough.
 */
let activeController: AbortController | null = null;

/**
 * Stop everything that's happening right now: kill audio playback (verse,
 * assistant TTS, browser TTS, ambient), abort any in-flight chat/TTS
 * request, and clear the "thinking" indicator. Safe to call from anywhere.
 */
export function cancelAllActivity(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
  // audioPlayback.stop() also cancels auto-play, but be explicit here so
  // this entry point reads as "kill everything in flight".
  cancelAutoPlayPrefetch();
  audioPlayback.stop();
  useChatStore.getState().setProcessing(false);
  useChatStore.getState().setCurrentTool(null);
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

// Canonical key for a parsed Bible reference, so "John 3:16" and "John 3:16-16"
// collapse to the same identity for turn-level dedup. Returns null when the
// string can't be parsed.
function referenceKey(input: string): string | null {
  const parsed = parseReference(input);
  if (!parsed) return null;
  const start = parsed.verseStart ?? 0;
  const end = parsed.verseEnd ?? start;
  return `${parsed.bookId}:${parsed.chapter}:${start}:${end}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export type SendOpts = { source?: VoiceSource };

export function useCommandPipeline() {
  const send = useCallback(async (userText: string, opts?: SendOpts) => {
    const text = userText.trim();
    if (!text) return;

    // Voice/text "stop" short-circuits the whole pipeline — it can run even
    // while another send is processing, so it goes BEFORE the isProcessing
    // guard. We swallow the phrase silently rather than appending it to the
    // chat so history stays clean.
    if (isStopCommand(text)) {
      cancelAllActivity();
      return;
    }

    if (useChatStore.getState().isProcessing) return;

    // Abort any straggler controller (defensive — isProcessing should
    // already prevent overlap), then arm a fresh one for this send.
    if (activeController) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;

    const source: VoiceSource = opts?.source ?? 'chat';

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      text,
      createdAt: Date.now(),
    };
    useChatStore.getState().appendMessage(userMsg);
    useChatStore.getState().setProcessing(true);
    useChatStore.getState().setCurrentTool(null);

    const { locale, translation, ambient: ambientSettings } =
      useSettingsStore.getState();

    // Resolve the currently-selected ambient track's title from the cached
    // track list so the model can refer to it by name in answers. If the
    // cache isn't populated yet the await primes it for the next request;
    // the snapshot just falls back to "(id only)" this turn.
    let currentTrackTitle: string | null = null;
    if (ambientSettings.trackId) {
      try {
        const tracks = await getAmbientTracks();
        currentTrackTitle =
          tracks.find((t) => t.id === ambientSettings.trackId)?.title ?? null;
      } catch {
        /* offline / list unavailable — fine, the trackId still goes in */
      }
    }

    const history: ChatRequestMessage[] = [
      { role: 'system', content: systemPrompt(locale, translation) },
      { role: 'system', content: playbackStatePrompt(currentTrackTitle) },
      ...useChatStore
        .getState()
        .messages.filter(
          (m) =>
            m.role === 'user' ||
            (m.role === 'assistant' && (m.text || m.historyNote)),
        )
        .slice(-12)
        .map<ChatRequestMessage>((m) =>
          m.role === 'user'
            ? { role: 'user', content: m.text }
            : { role: 'assistant', content: m.historyNote || m.text },
        ),
    ];

    const assistantMsg: ChatMessage = {
      id: newId(),
      role: 'assistant',
      text: '',
      toolCalls: [],
      createdAt: Date.now(),
    };
    useChatStore.getState().appendMessage(assistantMsg);

    try {
      let loops = 0;
      let didReadAction = false;
      const readReferences: string[] = [];
      // Canonical keys of passages already played this turn. Used to silently
      // ignore the gpt-4o-mini tic of issuing `read_verses` with the exact
      // reference just returned by `random_verse`/`continue_from_ribbon` — that
      // duplicate would otherwise pile verses on the message and stomp on the
      // already-started playback. Different references (multi-read flows) are
      // unaffected.
      const playedKeys = new Set<string>();
      while (loops < MAX_TOOL_LOOPS) {
        if (controller.signal.aborted) break;
        loops++;
        const resp = await postChat(
          {
            messages: history,
            tools: TOOL_DEFINITIONS,
            model: 'gpt-4o-mini',
            // Sequential tool calls: the model must see each result before issuing
            // the next. Prevents parallel/duplicate `random_verse` spam while
            // still allowing legit multi-read flows (e.g. "one from OT, one from
            // NT, one from Psalms") by calling the tool once per verse.
            parallel_tool_calls: false,
          },
          { signal: controller.signal },
        );
        const choice = resp.message;
        if (choice.tool_calls && choice.tool_calls.length > 0) {
          history.push({
            role: 'assistant',
            content: choice.content ?? null,
            tool_calls: choice.tool_calls,
          });

          const summaries: ToolCallSummary[] = [];
          for (const tc of choice.tool_calls) {
            if (controller.signal.aborted) break;
            const name = tc.function.name as ToolName;
            const isRead =
              name === 'read_verses' ||
              name === 'random_verse' ||
              name === 'continue_from_ribbon';
            if (isRead) didReadAction = true;

            // Skip a `read_verses` whose reference matches one already played
            // this turn. This neutralizes the model's "I picked X, now I'll
            // read X" follow-up after `random_verse`, without limiting how many
            // distinct verses the user can request.
            if (name === 'read_verses') {
              const parsedArgs = safeJson(tc.function.arguments) as {
                reference?: unknown;
              };
              const refStr = typeof parsedArgs.reference === 'string' ? parsedArgs.reference : '';
              const key = refStr ? referenceKey(refStr) : null;
              if (key && playedKeys.has(key)) {
                const data = { reference: refStr, count: 0, duplicate: true };
                summaries.push({
                  id: tc.id,
                  name: tc.function.name,
                  args: parsedArgs as Record<string, unknown>,
                  result: data,
                });
                history.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({ ok: true, data }),
                });
                continue;
              }
            }

            useChatStore.getState().setCurrentTool(name);
            const result = await dispatchTool(name, tc.function.arguments, {
              messageId: assistantMsg.id,
              signal: controller.signal,
            });
            if (
              isRead &&
              result.ok &&
              result.data &&
              typeof result.data === 'object' &&
              'reference' in result.data &&
              typeof (result.data as { reference: unknown }).reference === 'string'
            ) {
              const ref = (result.data as { reference: string }).reference;
              readReferences.push(ref);
              const key = referenceKey(ref);
              if (key) playedKeys.add(key);
            }
            summaries.push({
              id: tc.id,
              name: tc.function.name,
              args: safeJson(tc.function.arguments),
              result: result.ok ? result.data : undefined,
              error: result.ok ? undefined : result.error,
            });
            history.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error }),
            });
          }
          useChatStore.getState().setCurrentTool(null);
          useChatStore.getState().updateMessage(assistantMsg.id, {
            toolCalls: [...(useChatStore.getState().messages.find((m) => m.id === assistantMsg.id)?.toolCalls ?? []), ...summaries],
          });
          if (choice.content && !didReadAction) {
            useChatStore.getState().updateMessage(assistantMsg.id, { text: choice.content });
          }
          continue;
        }
        // The user wants no confirmation (written or spoken) when the resolved
        // action was a Bible read — the verse playback itself is the response.
        const finalText = didReadAction ? '' : (choice.content ?? '');
        const historyNote = didReadAction
          ? readReferences.length > 0
            ? `(Played aloud: ${readReferences.join('; ')}.)`
            : '(Played the requested passage.)'
          : undefined;
        useChatStore.getState().updateMessage(assistantMsg.id, {
          text: finalText,
          historyNote,
        });
        if (!didReadAction && !controller.signal.aborted) {
          void speakAssistantReply(finalText, assistantMsg.id);
        }
        if (source === 'global') {
          useGlobalVoiceStore.getState().setLastResponse(
            didReadAction
              ? {
                  kind: 'reading',
                  reference: readReferences.join('; ') || '',
                  messageId: assistantMsg.id,
                }
              : { kind: 'reply', text: finalText, messageId: assistantMsg.id },
          );
        }
        break;
      }
    } catch (e) {
      if (!isAbortError(e) && !controller.signal.aborted) {
        useChatStore.getState().updateMessage(assistantMsg.id, {
          text: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      if (activeController === controller) activeController = null;
      useChatStore.getState().setProcessing(false);
      useChatStore.getState().setCurrentTool(null);
    }
  }, []);

  return { send };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

async function speakAssistantReply(text: string, messageId: string): Promise<void> {
  const trimmed = stripMarkdownForSpeech(text);
  if (!trimmed) return;
  const { speakAssistant, assistantVoice, voiceStyle, locale } =
    useSettingsStore.getState();
  if (!speakAssistant) return;
  if (isBrowserVoice(assistantVoice)) {
    void browserTts.enqueue([
      {
        messageId,
        verseIndex: 0,
        text: trimmed,
        translation: locale === 'de' ? 'S00' : 'ESV',
      },
    ]);
    return;
  }
  try {
    const tts = await postTtsSpeak({
      text: trimmed,
      voice: assistantVoice,
      voiceStyle: voiceStyle || undefined,
      language: locale === 'de' ? 'de' : 'en',
    });
    audioPlayback.ensureContext();
    void audioPlayback.enqueue([
      {
        messageId,
        verseIndex: 0,
        audioUrl: tts.audioUrl,
        alignmentUrl: tts.alignmentUrl,
      },
    ]);
  } catch (e) {
    console.warn('assistant TTS failed', e);
  }
}

// Strip the lightweight markdown the assistant may emit so the TTS engine
// doesn't read out asterisks, hashes, or link syntax.
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .trim();
}

// ─── Continue Reading helper ──────────────────────────────────────────

type ContinueReading = {
  canContinue: boolean;
  nextLabel: string;
  sendNext: () => void;
};

const CHUNK_SIZE = 5;

function computeNextRange(
  last: VerseSummary,
  chapterEndVerse: number | null,
  nextChapterMax: number | null,
): { reference: string; translation: Translation; label: string } | null {
  const book = getBookById(last.bookId);
  if (!book) return null;
  if (chapterEndVerse !== null && last.verse < chapterEndVerse) {
    const start = last.verse + 1;
    const end = Math.min(start + CHUNK_SIZE - 1, chapterEndVerse);
    return {
      reference: `${book.nameEn} ${last.chapter}:${start}-${end}`,
      translation: last.translation,
      label: `${book.nameEn} ${last.chapter}:${start}-${end}`,
    };
  }
  if (last.chapter < book.chapters) {
    const nextChapter = last.chapter + 1;
    const end =
      nextChapterMax !== null ? Math.min(CHUNK_SIZE, nextChapterMax) : CHUNK_SIZE;
    return {
      reference: `${book.nameEn} ${nextChapter}:1-${end}`,
      translation: last.translation,
      label: `${book.nameEn} ${nextChapter}:1-${end}`,
    };
  }
  return null;
}

export function useContinueReading(
  message: ChatMessage,
  send: (text: string, opts?: SendOpts) => void | Promise<void>,
): ContinueReading {
  const last = useMemo(() => {
    const verses = message.verses;
    if (!verses || verses.length === 0) return null;
    return verses[verses.length - 1];
  }, [message.verses]);

  const [chapterEndVerse, setChapterEndVerse] = useState<number | null>(null);
  const [nextChapterMax, setNextChapterMax] = useState<number | null>(null);

  useEffect(() => {
    if (!last) return;
    let cancelled = false;
    void getChapter(last.translation, last.bookId, last.chapter)
      .then((verses) => {
        if (cancelled || verses.length === 0) return;
        setChapterEndVerse(verses[verses.length - 1].verse);
      })
      .catch(() => {});
    const book = getBookById(last.bookId);
    if (book && last.chapter < book.chapters) {
      void getChapter(last.translation, last.bookId, last.chapter + 1)
        .then((verses) => {
          if (cancelled || verses.length === 0) return;
          setNextChapterMax(verses[verses.length - 1].verse);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [last]);

  if (!last) {
    return { canContinue: false, nextLabel: '', sendNext: () => {} };
  }

  const next = computeNextRange(last, chapterEndVerse, nextChapterMax);
  if (!next) {
    return { canContinue: false, nextLabel: '', sendNext: () => {} };
  }

  const { locale } = useSettingsStore.getState();
  // Pretty label honors locale formatting (e.g. "Galater 5:23-27").
  const startVerse = next.reference.split(':')[1]?.split('-')[0];
  const endVerse = next.reference.split('-')[1];
  const startNum = startVerse ? parseInt(startVerse, 10) : last.verse + 1;
  const endNum = endVerse ? parseInt(endVerse, 10) : startNum;
  const nextChapter = next.reference.match(/(\d+):/)?.[1];
  const chapterNum = nextChapter ? parseInt(nextChapter, 10) : last.chapter;
  const label = formatReference(last.bookId, chapterNum, startNum, endNum, locale);

  return {
    canContinue: true,
    nextLabel: label,
    sendNext: () => {
      void send(`Read ${next.reference}`);
    },
  };
}
