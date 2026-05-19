import { useCallback } from 'react';
import { postChat, type ChatRequestMessage } from '@/services/api/chat';
import { TOOL_DEFINITIONS, systemPrompt, type ToolName } from '@/services/ai/tools';
import { dispatchTool } from '@/services/ai/dispatch';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ChatMessage, ToolCallSummary } from '@/types/domain';

const MAX_TOOL_LOOPS = 6;

function newId(): string {
  return crypto.randomUUID();
}

export function useCommandPipeline() {
  const send = useCallback(async (userText: string) => {
    const text = userText.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      text,
      createdAt: Date.now(),
    };
    useChatStore.getState().appendMessage(userMsg);
    useChatStore.getState().setProcessing(true);

    const { locale, translation } = useSettingsStore.getState();

    const history: ChatRequestMessage[] = [
      { role: 'system', content: systemPrompt(locale, translation) },
      ...useChatStore
        .getState()
        .messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text))
        .slice(-12)
        .map<ChatRequestMessage>((m) =>
          m.role === 'user'
            ? { role: 'user', content: m.text }
            : { role: 'assistant', content: m.text },
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
            const result = await dispatchTool(tc.function.name as ToolName, tc.function.arguments, {
              messageId: assistantMsg.id,
            });
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
          useChatStore.getState().updateMessage(assistantMsg.id, {
            toolCalls: [...(useChatStore.getState().messages.find((m) => m.id === assistantMsg.id)?.toolCalls ?? []), ...summaries],
          });
          if (choice.content) {
            useChatStore.getState().updateMessage(assistantMsg.id, { text: choice.content });
          }
          continue;
        }
        useChatStore.getState().updateMessage(assistantMsg.id, {
          text: choice.content ?? '',
        });
        break;
      }
    } catch (e) {
      useChatStore.getState().updateMessage(assistantMsg.id, {
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      useChatStore.getState().setProcessing(false);
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
