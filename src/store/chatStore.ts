import { create } from 'zustand';
import type { ChatMessage, VerseSummary } from '@/types/domain';

type ChatState = {
  messages: ChatMessage[];
  selectedIndex: number;
  isProcessing: boolean;
  appendMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  attachVerses: (messageId: string, verses: VerseSummary[]) => void;
  setSelected: (index: number) => void;
  moveSelection: (delta: number) => void;
  clear: () => void;
  setProcessing: (value: boolean) => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  selectedIndex: -1,
  isProcessing: false,
  appendMessage: (msg) =>
    set((s) => ({
      messages: [...s.messages, msg],
      selectedIndex: s.messages.length,
    })),
  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  attachVerses: (messageId, verses) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, verses: [...(m.verses ?? []), ...verses] } : m,
      ),
    })),
  setSelected: (index) => set({ selectedIndex: index }),
  moveSelection: (delta) => {
    const { messages, selectedIndex } = get();
    if (messages.length === 0) return;
    const next = Math.max(0, Math.min(messages.length - 1, selectedIndex + delta));
    set({ selectedIndex: next });
  },
  clear: () => set({ messages: [], selectedIndex: -1 }),
  setProcessing: (value) => set({ isProcessing: value }),
}));
