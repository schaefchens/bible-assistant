import { create } from 'zustand';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

export type CurrentTrack = {
  groupId: string;
  verseIndex: number;
  totalVerses: number;
  audioUrl: string;
  alignmentUrl?: string;
  /** seconds within current verse */
  position: number;
  duration: number;
  currentWordIndex: number;
  /** False while a heading or verse-number announcement is playing; tap-
   * to-play uses this to decide whether seekToWord is meaningful. */
  isVerse: boolean;
};

type PlaybackState = {
  status: PlaybackStatus;
  current: CurrentTrack | null;
  ambientPlaying: boolean;
  setStatus: (status: PlaybackStatus) => void;
  setCurrent: (current: CurrentTrack | null) => void;
  patchCurrent: (patch: Partial<CurrentTrack>) => void;
  setAmbientPlaying: (v: boolean) => void;
};

export const usePlaybackStore = create<PlaybackState>((set) => ({
  status: 'idle',
  current: null,
  ambientPlaying: false,
  setStatus: (status) => set({ status }),
  setCurrent: (current) => set({ current }),
  patchCurrent: (patch) =>
    set((s) => (s.current ? { current: { ...s.current, ...patch } } : s)),
  setAmbientPlaying: (ambientPlaying) => set({ ambientPlaying }),
}));
