import { create } from 'zustand';

export type VoiceSource = 'chat' | 'global';

export type VoiceLastResponse =
  | { kind: 'reading'; reference: string; messageId: string }
  | { kind: 'reply'; text: string; messageId: string };

type GlobalVoiceState = {
  listening: boolean;
  transcript: string;
  source: VoiceSource;
  overlayOpen: boolean;
  lastResponse: VoiceLastResponse | null;
  eyesFreeMode: boolean;
  setListening: (value: boolean) => void;
  setTranscript: (value: string) => void;
  setSource: (value: VoiceSource) => void;
  setOverlayOpen: (value: boolean) => void;
  setLastResponse: (value: VoiceLastResponse | null) => void;
  setEyesFreeMode: (value: boolean) => void;
  reset: () => void;
};

export const useGlobalVoiceStore = create<GlobalVoiceState>((set) => ({
  listening: false,
  transcript: '',
  source: 'chat',
  overlayOpen: false,
  lastResponse: null,
  eyesFreeMode: false,
  setListening: (listening) => set({ listening }),
  setTranscript: (transcript) => set({ transcript }),
  setSource: (source) => set({ source }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
  setLastResponse: (lastResponse) => set({ lastResponse }),
  setEyesFreeMode: (eyesFreeMode) => set({ eyesFreeMode }),
  reset: () =>
    set({
      listening: false,
      transcript: '',
      overlayOpen: false,
      lastResponse: null,
      eyesFreeMode: false,
    }),
}));
