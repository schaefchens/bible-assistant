import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { usePlaybackStore } from '@/store/playbackStore';
import { startPlaybackForVerses } from '@/lib/startPlayback';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export function useChatNavigation() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const { messages, selectedIndex, moveSelection } = useChatStore.getState();
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        const msg = messages[selectedIndex];
        if (!msg || !msg.verses?.length) return;
        e.preventDefault();
        const status = usePlaybackStore.getState().status;
        const current = usePlaybackStore.getState().current;
        if (current?.messageId === msg.id && (status === 'playing' || status === 'paused')) {
          audioPlayback.toggle();
          return;
        }
        void startPlaybackForVerses(msg.id, msg.verses);
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
