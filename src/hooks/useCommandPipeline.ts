import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/lib/appRoutes';
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

/** Identity of a random draw: same arguments, same request. Built field by
 * field rather than from the raw JSON so key order or an omitted default can't
 * make one call look like two. */
function drawKey(args: Record<string, unknown>): string {
  const part = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return [
    part(args.unit ?? 'verse'),
    part(args.count ?? 1),
    part(args.book),
    part(args.chapter),
    part(args.translation),
  ].join('|');
}

function newId(): string {
  return crypto.randomUUID();
}

export type SendOpts = { source?: VoiceSource };

export function useCommandPipeline() {
  // Only so a tool that reads into the reader can take the user there; see
  // `ToolDispatchResult.opensReader`. Stable in react-router v7, so `send`
  // keeps its identity and the components holding it don't re-render.
  const navigate = useNavigate();
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
      /** A tool put its reading in the reader, so that is where to go. */
      let openReader = false;
      const readReferences: string[] = [];
      // Canonical keys of passages already played this turn. Used to silently
      // ignore the gpt-4o-mini tic of issuing `read_verses` with the exact
      // reference just returned by `random_passage`/`continue_from_ribbon` — that
      // duplicate would otherwise pile verses on the message and stomp on the
      // already-started playback. Different references (multi-read flows) are
      // unaffected.
      const playedKeys = new Set<string>();
      // The draws already made this turn, keyed by their arguments. One ask for
      // a random verse is one draw: repeating the identical call is the model
      // going round again, not a second passage the user asked for. Different
      // arguments ("one from the OT and one from Psalms") still go through.
      const drawnKeys = new Set<string>();
      while (loops < MAX_TOOL_LOOPS) {
        if (controller.signal.aborted) break;
        loops++;
        const resp = await postChat(
          {
            messages: history,
            tools: TOOL_DEFINITIONS,
            model: 'gpt-4o-mini',
            // Sequential tool calls: the model must see each result before issuing
            // the next. Prevents parallel/duplicate `random_passage` spam while
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

            // Two ways the model goes round again after a reading, both
            // intercepted here rather than dispatched:
            //   - `read_verses` for a reference already played this turn — its
            //     "I picked X, now I'll read X" follow-up, which would pile the
            //     verses on the message and stomp on the started playback;
            //   - `random_passage` with the identical arguments — a second roll
            //     of the same request.
            // Neither limits what the user can actually ask for: a different
            // reference, or a draw with a different scope, passes through.
            const parsedArgs = parseJsonSafe(tc.function.arguments) as Record<string, unknown>;
            let repeated = false;
            if (name === 'read_verses') {
              const refStr = typeof parsedArgs.reference === 'string' ? parsedArgs.reference : '';
              const key = refStr ? referenceKey(refStr) : null;
              repeated = !!key && playedKeys.has(key);
            } else if (name === 'random_passage') {
              const key = drawKey(parsedArgs);
              repeated = drawnKeys.has(key);
              drawnKeys.add(key);
            }
            if (repeated) {
              // Deliberately *not* `count: 0` — that read as "the passage came
              // back empty", and the model answered it by drawing again, three
              // times over, until MAX_TOOL_LOOPS cut it off. The result has to
              // say the request is already fulfilled.
              const played =
                (typeof parsedArgs.reference === 'string' ? parsedArgs.reference : '') ||
                readReferences[readReferences.length - 1] ||
                '';
              const data = {
                reference: played,
                alreadyRead: true,
                note: 'This passage is already playing from this turn — the request is fulfilled. Do not read it again, do not draw another passage, and reply with empty content.',
              };
              summaries.push({
                id: tc.id,
                name: tc.function.name,
                args: parsedArgs,
                result: data,
              });
              history.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({ ok: true, data }),
              });
              continue;
            }

            useChatStore.getState().setCurrentTool(name);
            const result = await dispatchTool(name, tc.function.arguments, {
              messageId: assistantMsg.id,
              signal: controller.signal,
            });
            if (result.opensReader) openReader = true;
            if (isRead && result.ok && result.data && typeof result.data === 'object') {
              // `references` (plural) is how a multi-draw reports what it read;
              // everything else reports the one `reference`. Both are recorded
              // whole, so the history note names every passage and each one is
              // covered by the duplicate guard.
              const data = result.data as { reference?: unknown; references?: unknown };
              const refs = Array.isArray(data.references)
                ? data.references.filter((r): r is string => typeof r === 'string')
                : typeof data.reference === 'string'
                  ? [data.reference]
                  : [];
              for (const ref of refs) {
                readReferences.push(ref);
                const key = referenceKey(ref);
                if (key) playedKeys.add(key);
              }
            }
            summaries.push({
              id: tc.id,
              name: tc.function.name,
              args: parsedArgs,
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
          // The reading is in the reader, so go there — as soon as it starts,
          // rather than after the model's closing turn, since the audio is
          // already playing. Once only: the flag stays set for the rest of the
          // loop, but a second navigation would fight a user who has just
          // stepped somewhere else.
          if (openReader && !controller.signal.aborted) {
            openReader = false;
            navigate(ROUTES.read);
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
  }, [navigate]);

  return { send };
}
