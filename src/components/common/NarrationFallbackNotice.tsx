import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onNarrationFallback } from '@/lib/startPlayback';

/** Long enough to read one sentence, short enough not to sit over the text. */
const VISIBLE_MS = 7000;

/**
 * Mounted at app root. Explains, once per session, why a reading is being read
 * by the device voice instead of the selected OpenAI one — otherwise the voice
 * silently changes and it reads as a bug rather than as the app coping.
 *
 * Purely informational, so it auto-dismisses. The actionable version of this
 * ("download this chapter's narration") belongs on the reader, not in a banner.
 */
export function NarrationFallbackNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return onNarrationFallback(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 pointer-events-none flex justify-center px-4 pt-safe">
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="pointer-events-auto mt-2 max-w-md w-full text-left bg-surface-raised border border-brand/30 rounded-2xl px-4 py-3 shadow-xl"
      >
        <p className="text-sm text-ink">{t('narrationFallback.title')}</p>
        <p className="text-xs text-ink-muted mt-1">{t('narrationFallback.hint')}</p>
      </button>
    </div>
  );
}
