import { useCallback, useEffect, useMemo, useState } from 'react';
import { postChat, type ChatRequestMessage } from '@/services/api/chat';
import { postTtsSpeak } from '@/services/api/tts';
import { TOOL_DEFINITIONS, systemPrompt, type ToolName } from '@/services/ai/tools';
import { dispatchTool } from '@/services/ai/dispatch';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useGlobalVoiceStore, type VoiceSource } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { getChapter, type Translation } from '@/services/bible/bibleApi';
import { formatReference, getBookById } from '@/services/bible/bookCatalog';
import type { ChatMessage, ToolCallSummary, VerseSummary } from '@/types/domain';

const MAX_TOOL_LOOPS = 6;

function newId(): string {
  return crypto.randomUUID();
}

export type SendOpts = { source?: VoiceSource };

export function useCommandPipeline() {
  const send = useCallback(async (userText: string, opts?: SendOpts) => {
    const text = userText.trim();
    if (!text) return;
    if (useChatStore.getState().isProcessing) return;

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

    const { locale, translation } = useSettingsStore.getState();

    const history: ChatRequestMessage[] = [
      { role: 'system', content: systemPrompt(locale, translation) },
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
      while (loops < MAX_TOOL_LOOPS) {
        loops++;
        const resp = await postChat({
          messages: history,
          tools: TOOL_DEFINITIONS,
          model: 'gpt-4o-mini',
        });
        const choice = resp.message;
        if (choice.tool_calls && choice.tool_calls.length > 0) {
          history.push({
            role: 'assistant',
            content: choice.content ?? null,
            tool_calls: choice.tool_calls,
          });

          const summaries: ToolCallSummary[] = [];
          for (const tc of choice.tool_calls) {
            const name = tc.function.name as ToolName;
            if (
              name === 'read_verses' ||
              name === 'random_verse' ||
              name === 'continue_from_ribbon'
            ) {
              didReadAction = true;
            }
            useChatStore.getState().setCurrentTool(name);
            const result = await dispatchTool(name, tc.function.arguments, {
              messageId: assistantMsg.id,
            });
            if (
              (name === 'read_verses' ||
                name === 'random_verse' ||
                name === 'continue_from_ribbon') &&
              result.ok &&
              result.data &&
              typeof result.data === 'object' &&
              'reference' in result.data &&
              typeof (result.data as { reference: unknown }).reference === 'string'
            ) {
              readReferences.push((result.data as { reference: string }).reference);
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
        if (!didReadAction) {
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
      useChatStore.getState().updateMessage(assistantMsg.id, {
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
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
  const trimmed = text.trim();
  if (!trimmed) return;
  const { speakAssistant, assistantVoice, voiceStyle } = useSettingsStore.getState();
  if (!speakAssistant) return;
  try {
    const tts = await postTtsSpeak({
      text: trimmed,
      voice: assistantVoice,
      voiceStyle: voiceStyle || undefined,
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
