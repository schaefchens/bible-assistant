import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * "Back" for screens that aren't a nav tab and can be reached from more than one
 * place — the reading-list index and editor arrive from the picker on Chat or
 * Read, or from each other.
 *
 * History, not a fixed parent route: a fixed parent turns two screens into a
 * loop (the editor pushes the index, the index goes back to the editor…), and it
 * strands anyone who arrived from a third place. `fallback` covers the cold deep
 * link with nothing behind it.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
