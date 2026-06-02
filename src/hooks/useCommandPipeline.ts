import { useCallback } from 'react';
import { postChat, type ChatRequestMessage } from '@/services/api/chat';
import {
  TOOL_DEFINITIONS,
  isReadTool,
  playbackStatePrompt,
  systemPrompt,
  type ToolName,
} from '@/services/ai/tools';
import { dispatchTool } from '@/services/ai/dispatch';
import { speakAssistantReply } from '@/services/ai/assistantSpeech';
import { isStopCommand } from '@/services/ai/stopCommand';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useGlobalVoiceStore, type VoiceSource } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { cancelAutoPlayPrefetch } from '@/lib/autoPlay';
import { parseJsonSafe } from '@/lib/json';
import { getAmbientTracks } from '@/services/api/ambient';
import { parseReference } from '@/services/bible/referenceParser';
import type { ChatMessage, ToolCallSummary } from '@/types/domain';

const MAX_TOOL_LOOPS = 6;

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
        // Pure read-action turns produce no chat text — only the verse audio.
        // We log them as `historyNote: "(Played aloud: …)"` so the model can
        // resolve "continue reading" later. Surface those notes as `system`
        // observations rather than fake `assistant` content; otherwise, after
        // several reads in a row, the model pattern-matches on its own past
        // "(Played aloud: …)" entries and emits that string as natural-language
        // reply text instead of calling read_verses.
        .flatMap<ChatRequestMessage>((m) => {
          if (m.role === 'user') return [{ role: 'user', content: m.text }];
          const out: ChatRequestMessage[] = [];
          if (m.text) out.push({ role: 'assistant', content: m.text });
          if (m.historyNote) out.push({ role: 'system', content: m.historyNote });
          return out;
        }),
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
            const isRead = isReadTool(name);
            if (isRead) didReadAction = true;

            // Skip a `read_verses` whose reference matches one already played
            // this turn. This neutralizes the model's "I picked X, now I'll
            // read X" follow-up after `random_verse`, without limiting how many
            // distinct verses the user can request.
            if (name === 'read_verses') {
              const parsedArgs = parseJsonSafe(tc.function.arguments) as {
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
              args: parseJsonSafe(tc.function.arguments),
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
        // A verse playing right now means this is a mid-reading Q&A — surface
        // the answer in the inline overlay (and speakAssistantReply will pause
        // the reading to speak it) so the chat doesn't scroll away from the verse.
        const readingActive = usePlaybackStore.getState().status === 'playing';
        if (!didReadAction && !controller.signal.aborted) {
          void speakAssistantReply(finalText, assistantMsg.id);
        }
        if (source === 'global' || (!didReadAction && readingActive)) {
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
