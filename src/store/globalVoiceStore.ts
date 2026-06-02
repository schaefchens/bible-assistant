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
  // Mirrored from the single VoiceController so any component can read mic
  // state / drive the UI without mounting its own voice pipeline.
  pttRecording: boolean;
  available: boolean;
  error: string | null;
  setListening: (value: boolean) => void;
  setTranscript: (value: string) => void;
  setSource: (value: VoiceSource) => void;
  setOverlayOpen: (value: boolean) => void;
  setLastResponse: (value: VoiceLastResponse | null) => void;
  setEyesFreeMode: (value: boolean) => void;
  setPttRecording: (value: boolean) => void;
  setAvailable: (value: boolean) => void;
  setError: (value: string | null) => void;
  reset: () => void;
};

export const useGlobalVoiceStore = create<GlobalVoiceState>((set) => ({
  listening: false,
  transcript: '',
  source: 'chat',
  overlayOpen: false,
  lastResponse: null,
  eyesFreeMode: false,
  pttRecording: false,
  available: false,
  error: null,
  setListening: (listening) => set({ listening }),
  setTranscript: (transcript) => set({ transcript }),
  setSource: (source) => set({ source }),
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
  setLastResponse: (lastResponse) => set({ lastResponse }),
  setEyesFreeMode: (eyesFreeMode) => set({ eyesFreeMode }),
  setPttRecording: (pttRecording) => set({ pttRecording }),
  setAvailable: (available) => set({ available }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      listening: false,
      transcript: '',
      overlayOpen: false,
      lastResponse: null,
      eyesFreeMode: false,
    }),
}));
