import { Capacitor } from '@capacitor/core';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * What a feedback submission carries besides the words.
 *
 * Every field here is a question the maintainer would otherwise have to ask
 * back — and there is no reply channel in the app, so a report that needs a
 * follow-up question is a report that dies. The user agent is deliberately
 * *not* in here: api.php takes it from the request instead, where it cannot be
 * wrong.
 */
export type FeedbackContext = {
  /** Which screen they were on. `useLocation().pathname` even on the hash
   * router, so `#/read` reads as `/read` — see CLAUDE.md's native table. */
  route: string;
  /** The running build. The single most useful line in a bug report about a
   * sideloaded APK, where "which version?" is otherwise unanswerable. */
  commit: string;
  buildTime: string;
  /** `ios` / `android` / `web` — web and native are separate installs with
   * separate identities and genuinely different code paths. */
  platform: string;
  locale: string;
  /** `375x812`. Most layout bugs in this app are width bugs (see the mic
   * dock's width ladder), and asking someone their viewport is hopeless. */
  viewport: string;
  /** Whether they were online *as they wrote it* — a great deal of this app is
   * offline-first, so "it didn't play" means two different things. */
  online: boolean;
};

/**
 * Snapshot the diagnostics for a feedback submission.
 *
 * A plain function reading the stores through `getState()` rather than a hook:
 * it is called once, at submit, and what matters is the state at that moment —
 * not a value a re-render might have refreshed since the user started typing.
 */
export function collectFeedbackContext(route: string): FeedbackContext {
  return {
    route,
    commit: __GIT_COMMIT__,
    buildTime: __BUILD_TIME__,
    platform: Capacitor.getPlatform(),
    locale: useSettingsStore.getState().locale,
    viewport:
      typeof window === 'undefined'
        ? 'unknown'
        : `${window.innerWidth}x${window.innerHeight}`,
    online: useLibraryStore.getState().online,
  };
}
