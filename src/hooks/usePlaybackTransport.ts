import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startPlaybackForVerses, startReadingPlaylist } from '@/lib/startPlayback';
import {
  getLastPlayedMessageId,
  triggerContinuation,
} from '@/lib/autoPlay';
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

/** Fire the same flow as auto-play's soft-end continuation, but on demand.
 * Pokes the playback status to 'loading' so the floating bar's PlayButton
 * pulses while the cold fetch runs (when there's no prefetch hit). */
function fireContinuationFromTransport(messageId: string): void {
  const store = usePlaybackStore.getState();
  if (store.status === 'idle') store.setStatus('loading');
  void triggerContinuation(messageId);
}

export function navigateVerse(dir: 1 | -1): void {
  const bibles = bibleMessages(useChatStore.getState().messages);
  if (bibles.length === 0) return;
  const current = usePlaybackStore.getState().current;

  if (!current) {
    // No active playback — if we've played something in this session and
    // the user taps next, treat that as "continue past where I left off"
    // rather than restarting the last reading from verse 0 (the play
    // button already covers restart). Prev-direction keeps the existing
    // start-from-top behavior.
    if (dir === 1) {
      const lastId = getLastPlayedMessageId();
      if (lastId && bibles.some((m) => m.id === lastId)) {
        fireContinuationFromTransport(lastId);
        return;
      }
    }
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

  // Resolve the target (message, verse) coordinate one step in `dir`.
  let targetMsgIdx = curMsgIdx;
  let targetVerseIdx = current.verseIndex + dir;
  if (targetVerseIdx < 0) {
    // Before this reading's first verse → previous reading's last verse.
    if (curMsgIdx === 0) return; // already at the very beginning
    targetMsgIdx = curMsgIdx - 1;
    targetVerseIdx = bibles[targetMsgIdx].verses!.length - 1;
  } else if (targetVerseIdx >= verseCount) {
    // Past this reading's last verse → next reading, else fetch a continuation.
    if (curMsgIdx >= bibles.length - 1) {
      fireContinuationFromTransport(current.messageId);
      return;
    }
    targetMsgIdx = curMsgIdx + 1;
    targetVerseIdx = 0;
  }

  if (targetMsgIdx === curMsgIdx) {
    // Same reading: jump within the live queue if the verse is loaded.
    // Otherwise the queue was sliced (we started mid-message), so reload from
    // the target verse — this is what lets a backward step reach a verse that
    // isn't in the current (sliced) queue, including walking back across
    // earlier separate readings one verse at a time.
    if (audioPlayback.goToVerseIndex(targetVerseIdx)) return;
    void startPlaybackForVerses(curMsg.id, curMsg.verses!, targetVerseIdx);
    return;
  }

  const targetMsg = bibles[targetMsgIdx];
  selectMessageById(targetMsg.id);
  void startPlaybackForVerses(targetMsg.id, targetMsg.verses!, targetVerseIdx);
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
