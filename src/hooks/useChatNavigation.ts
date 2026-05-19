import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { usePlaybackStore } from '@/store/playbackStore';
import { startPlaybackForVerses } from '@/lib/startPlayback';
import type { ChatMessage } from '@/types/domain';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

function bibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => (m.verses?.length ?? 0) > 0);
}

function navigateVerse(dir: 1 | -1) {
  const bibles = bibleMessages(useChatStore.getState().messages);
  if (bibles.length === 0) return;
  const current = usePlaybackStore.getState().current;

  // No active bible playback yet — start from the most recent (down) or oldest (up).
  if (!current) {
    const target = dir === 1 ? bibles[bibles.length - 1] : bibles[0];
    void startPlaybackForVerses(target.id, target.verses!, 0);
    return;
  }

  const curMsgIdx = bibles.findIndex((m) => m.id === current.messageId);
  if (curMsgIdx === -1) {
    // Currently playing something not in chat (e.g. assistant reply TTS).
    // Treat as "no bible context" and start at the latest bible message.
    const target = bibles[bibles.length - 1];
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
      void startPlaybackForVerses(nextMsg.id, nextMsg.verses!, 0);
    }
  } else {
    if (verseIdx > 0) {
      audioPlayback.previous();
      return;
    }
    if (curMsgIdx > 0) {
      const prevMsg = bibles[curMsgIdx - 1];
      const lastIdx = (prevMsg.verses!.length ?? 1) - 1;
      void startPlaybackForVerses(prevMsg.id, prevMsg.verses!, lastIdx);
    }
  }
}

export function useChatNavigation() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateVerse(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        const status = usePlaybackStore.getState().status;
        const current = usePlaybackStore.getState().current;
        if (current && (status === 'playing' || status === 'paused')) {
          e.preventDefault();
          audioPlayback.toggle();
          return;
        }
        // Nothing playing — kick off the latest bible reading if there is one.
        const bibles = bibleMessages(useChatStore.getState().messages);
        const target = bibles[bibles.length - 1];
        if (target) {
          e.preventDefault();
          void startPlaybackForVerses(target.id, target.verses!, 0);
        }
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const status = usePlaybackStore.getState().status;
        const current = usePlaybackStore.getState().current;
        if (!current || (status !== 'playing' && status !== 'paused')) return;
        e.preventDefault();
        audioPlayback.seekByWord(e.key === 'ArrowLeft' ? -5 : 5);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
