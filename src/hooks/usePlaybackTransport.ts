import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startPlaybackForVerses, startReadingPlaylist } from '@/lib/startPlayback';
import type { ChatMessage } from '@/types/domain';

export const RATE_CYCLE = [0.85, 1.0, 1.15, 1.3] as const;

function bibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => (m.verses?.length ?? 0) > 0);
}

function selectMessageById(id: string) {
  const { messages, setSelected } = useChatStore.getState();
  const idx = messages.findIndex((m) => m.id === id);
  if (idx !== -1) setSelected(idx);
}

export function hasAnyReading(): boolean {
  return bibleMessages(useChatStore.getState().messages).length > 0;
}

export function navigateVerse(dir: 1 | -1): void {
  const bibles = bibleMessages(useChatStore.getState().messages);
  if (bibles.length === 0) return;
  const current = usePlaybackStore.getState().current;

  if (!current) {
    const target = dir === 1 ? bibles[bibles.length - 1] : bibles[0];
    selectMessageById(target.id);
    void startPlaybackForVerses(target.id, target.verses!, 0);
    return;
  }

  const curMsgIdx = bibles.findIndex((m) => m.id === current.messageId);
  if (curMsgIdx === -1) {
    const target = bibles[bibles.length - 1];
    selectMessageById(target.id);
    void startPlaybackForVerses(target.id, target.verses!, 0);
    return;
  }

  const curMsg = bibles[curMsgIdx];
  const verseCount = curMsg.verses!.length;
  const verseIdx = current.verseIndex;

  if (dir === 1) {
    if (verseIdx < verseCount - 1) {
      audioPlayback.next();
      return;
    }
    if (curMsgIdx < bibles.length - 1) {
      const nextMsg = bibles[curMsgIdx + 1];
      selectMessageById(nextMsg.id);
      void startPlaybackForVerses(nextMsg.id, nextMsg.verses!, 0);
    }
    return;
  }

  if (verseIdx > 0) {
    audioPlayback.previous();
    return;
  }
  if (curMsgIdx > 0) {
    const prevMsg = bibles[curMsgIdx - 1];
    const lastIdx = (prevMsg.verses!.length ?? 1) - 1;
    selectMessageById(prevMsg.id);
    void startPlaybackForVerses(prevMsg.id, prevMsg.verses!, lastIdx);
  }
}

/**
 * Play/pause the active track. If nothing is queued, kick off the most recent
 * reading from the start (as a full playlist). Returns true if it acted.
 */
export function togglePlayOrStart(): boolean {
  const status = usePlaybackStore.getState().status;
  const current = usePlaybackStore.getState().current;
  if (current && (status === 'playing' || status === 'paused')) {
    audioPlayback.toggle();
    return true;
  }
  const bibles = bibleMessages(useChatStore.getState().messages);
  const target = bibles[bibles.length - 1];
  if (target) {
    selectMessageById(target.id);
    void startReadingPlaylist(target.id, target.verses!, 0);
    return true;
  }
  return false;
}

export function seekByWords(delta: number): void {
  const status = usePlaybackStore.getState().status;
  const current = usePlaybackStore.getState().current;
  if (!current || (status !== 'playing' && status !== 'paused')) return;
  audioPlayback.seekByWord(delta);
}
