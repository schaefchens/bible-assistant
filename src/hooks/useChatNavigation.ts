import { useEffect } from 'react';
import {
  navigateVerse,
  togglePlayOrStart,
  seekByWords,
} from './usePlaybackTransport';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
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
        if (togglePlayOrStart()) e.preventDefault();
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seekByWords(e.key === 'ArrowLeft' ? -5 : 5);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
