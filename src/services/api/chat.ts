import { apiPostJson } from './client';

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatRequestMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content?: string | null;
      tool_calls?: ChatToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResponse = {
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason?: string;
};

export function postChat(body: {
  messages: ChatRequestMessage[];
  tools: ChatToolDefinition[];
  model?: string;
  parallel_tool_calls?: boolean;
}): Promise<ChatResponse> {
  return apiPostJson<ChatResponse>('chat', body);
}
