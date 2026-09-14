import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';

/**
 * `?install=1` — put the visitor in front of the browser's own install dialog.
 *
 * The link is for QR codes, flyers and "install the app" buttons on other
 * sites, so the arriving visitor has tapped something *elsewhere*. That single
 * fact is what shapes everything below: user activation does not survive a
 * navigation, so the zero-tap attempt is opportunistic and the one-tap button
 * is the path that actually works.
 *
 * Web only. `beforeinstallprompt` is Chromium's, there is no service worker
 * under `capacitor://` (VitePWA is `disable`d for the native build), and inside
 * the app there is nothing left to install.
 *
 * Logic lives here rather than in the card because `react-refresh/only-export-
 * components` is an error in this codebase: a `.tsx` file may export components
 * only. The store follows `lib/pwaUpdate.ts`'s precedent — a zustand store
 * outside `store/`, named `use*` though it is a store — which also keeps the
 * card free of the `set-state-in-effect` dance a hand-rolled subscribe/notify
 * would need.
 */

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };

/**
 * Chromium's install event. Not in lib.dom, so it is declared once here rather
 * than cast at every use.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  /** The pre-2019 shape of the outcome; still populated, and still the fallback. */
  readonly userChoice: Promise<InstallChoice>;
  /** Opens the browser's own dialog. Gesture-gated, and **single-use**. */
  prompt: () => Promise<InstallChoice> | void;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
  interface Window {
    /** Where the inline `<script>` in index.html parks an early event. */
    __installPromptEvent?: BeforeInstallPromptEvent | null;
  }
  interface Navigator {
    /** iOS Safari's own "launched from the home screen" flag. */
    standalone?: boolean;
  }
}

/** The query parameter that asks for the installer. */
export const INSTALL_PARAM = 'install';

/**
 * Where the intent is latched, and why it is latched at all.
 *
 * The URL is rewritten the moment we have read it (nobody wants `?install=1`
 * sitting in the address bar, or copied into a share), so the URL cannot also
 * be the memory. If anything reloads the page between arrival and the visitor
 * answering, the parameter is gone and the installer silently never appears —
 * for exactly the new visitors the link was made for.
 *
 * **In this app that reload does not currently happen**, and it is worth
 * writing down rather than leaving the latch looking like cargo cult: the
 * service worker is `registerType: 'prompt'` with no `clientsClaim`, so a
 * first-time visitor's worker installs, waits, and claims nothing; the only
 * `location.reload()` on this path is the update banner's own button. The latch
 * covers that button, and it is the one line that keeps this feature working if
 * the worker is ever switched to `autoUpdate` — which would otherwise break it
 * invisibly, with every test still green.
 */
const LATCH_KEY = 'ba.install.intent';

/**
 * How long to wait for a `beforeinstallprompt` before falling back to written
 * instructions.
 *
 * Not a poll: the event either fires or it doesn't, and Chrome may take a
 * moment over it — installability is re-evaluated once the service worker
 * registers, which on a first visit is *after* our bundle runs. Three seconds
 * is long enough for that and short enough that an iOS visitor, who will never
 * get the event at all, is not left looking at nothing. The subscription stays
 * alive afterwards, so a late event still upgrades the card to the real button.
 */
const EVENT_DEADLINE_MS = 3000;

type InstallState = {
  /** Is the card up at all? False unless `?install=1` actually asked for it. */
  open: boolean;
  /** A real event is in hand, so the one-tap button will open the real dialog. */
  promptable: boolean;
  /** The wait above has elapsed: show the written instructions instead. */
  timedOut: boolean;
  /** They said yes to the browser's own dialog. */
  installed: boolean;
};

export const useInstallStore = create<InstallState>(() => ({
  open: false,
  promptable: false,
  timedOut: false,
  installed: false,
}));

/*
 * Module scope, not component state, and not the store either. `prompt()` is
 * single-use and StrictMode double-mounts every component in development, so
 * anything that guards "have we already tried this?" has to live where a
 * remount cannot reset it.
 */
let parked: BeforeInstallPromptEvent | null = null;
let autoAttempted = false;
let inFlight: Promise<PromptOutcome> | null = null;
let deadline: number | undefined;
let started = false;

/** Is this page already the installed app? Then do nothing, silently. */
export function runningInstalled(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari does not report `display-mode`; this is its equivalent.
  if (navigator.standalone === true) return true;
  // A Play Store TWA navigates with this referrer.
  if (document.referrer.startsWith('android-app://')) return true;
  return false;
}

function readLatch(): boolean {
  try {
    return sessionStorage.getItem(LATCH_KEY) === '1';
  } catch {
    // Private mode, or storage blocked. The URL was still read; only surviving
    // a reload is lost, which is the cheaper half.
    return false;
  }
}

function writeLatch(): void {
  try {
    sessionStorage.setItem(LATCH_KEY, '1');
  } catch {
    /* see readLatch */
  }
}

function clearLatch(): void {
  try {
    sessionStorage.removeItem(LATCH_KEY);
  } catch {
    /* see readLatch */
  }
}

/**
 * Drop `install` from a query string, keeping everything else.
 *
 * Surgical rather than a blanket `replaceState(null, '', location.pathname)`,
 * because `?piece=<uuid>&install=1` is a plausible link in this app — an
 * invitation that also offers to install — and a blanket replace eats the half
 * that mattered. The hash is preserved for the same reason, and the existing
 * `history.state` is passed through rather than nulled: React Router keeps its
 * own bookkeeping there.
 *
 * Exported for the unit test; there is exactly one caller.
 */
export function urlWithoutInstallParam(search: string, hash = '', pathname = ''): string {
  const params = new URLSearchParams(search);
  params.delete(INSTALL_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

/**
 * Read `?install=1`, remember it, and take it out of the URL.
 *
 * **At module-eval time**, as a `const` initializer rather than inside
 * `initPwaInstall()`, so it cannot be reordered behind anything that rewrites
 * the URL by someone moving one call in `main.tsx`.
 */
const intended: boolean = (() => {
  if (typeof window === 'undefined') return false;
  const asked = new URLSearchParams(window.location.search).get(INSTALL_PARAM) === '1';
  if (!asked) return readLatch();
  writeLatch();
  window.history.replaceState(
    window.history.state,
    '',
    urlWithoutInstallParam(window.location.search, window.location.hash, window.location.pathname),
  );
  return true;
})();

export type PromptOutcome = 'accepted' | 'dismissed' | 'refused' | 'unavailable';

/**
 * Open the browser's own install dialog.
 *
 * **Nothing may be awaited between a click handler and the `event.prompt()`
 * call below.** Chrome checks user activation synchronously, and an `await` —
 * even one that resolves immediately — spends the gesture before the call
 * lands. That is also why this returns a promise rather than being `async`.
 *
 * A second call while one is in flight returns the *same* promise, so a
 * StrictMode remount re-attaches to the open dialog instead of opening a
 * second one.
 */
export function promptInstall(): Promise<PromptOutcome> {
  if (inFlight) return inFlight;
  const event = parked;
  if (!event) return Promise.resolve('unavailable');

  let choice: Promise<InstallChoice>;
  try {
    // `prompt()` resolves to the choice in current Chrome and returns void in
    // the original shape, where `userChoice` carried it.
    choice = event.prompt() ?? event.userChoice;
  } catch (err) {
    return Promise.resolve(afterRefusal(err));
  }

  const settled = choice.then(
    ({ outcome }): PromptOutcome => {
      // The event is spent: calling prompt() on it again throws
      // InvalidStateError. Drop it so the button cannot.
      parked = null;
      if (outcome === 'accepted') {
        clearLatch();
        useInstallStore.setState({ promptable: false, installed: true });
      } else {
        // They have just answered the real dialog. Asking again — with our own
        // card, immediately, over the top — is the one thing not to do.
        closeInstallCard();
      }
      return outcome;
    },
    (err: unknown) => afterRefusal(err),
  );
  inFlight = settled.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * A `prompt()` that threw. The two errors mean opposite things about the event,
 * which is the whole reason to tell them apart:
 *
 *  - `NotAllowedError` — no user gesture. The **normal** result of the zero-tap
 *    attempt, and not an error condition: the event is untouched, so it is kept
 *    and the card offers the button that does have a gesture behind it.
 *  - `InvalidStateError` — already consumed. The event is dead; keeping it
 *    would leave a button that throws every time it is pressed.
 */
function afterRefusal(err: unknown): PromptOutcome {
  if (err instanceof Error && err.name === 'InvalidStateError') {
    parked = null;
    useInstallStore.setState({ promptable: false });
    return 'unavailable';
  }
  return 'refused';
}

function adopt(event: BeforeInstallPromptEvent): void {
  parked = event;
  // The slot in index.html is a hand-off buffer, never a second owner. Its
  // listener was added first and so runs first, and it re-parks *every* event
  // — including ones this module is adopting right now — so leaving it set
  // would strand a reference to an event that may since have been spent.
  // Empty it here and the slot means exactly one thing: `undefined` is "never
  // needed", `null` is "handed over".
  window.__installPromptEvent = null;
  useInstallStore.setState({ promptable: true });
  if (!useInstallStore.getState().open) return;
  // Opportunistic, once per page load. It will almost always be refused — the
  // visitor arrived by navigation and has no activation to spend — and being
  // refused is what puts the button in front of them.
  if (autoAttempted) return;
  autoAttempted = true;
  void promptInstall();
}

/** Close the card and forget the intent, so a reload does not re-open it. */
export function closeInstallCard(): void {
  window.clearTimeout(deadline);
  clearLatch();
  useInstallStore.setState({ open: false });
}

/**
 * Wire up the install flow. Call once, before React mounts — and **before**
 * `initPwaUpdate()`, which registers the service worker: registering is one of
 * the things that makes Chrome fire `beforeinstallprompt`, and a listener added
 * afterwards can miss it.
 */
export function initPwaInstall(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Kept for the whole session rather than removed once the card is answered:
  // Chrome re-fires this whenever installability is re-evaluated, so a late
  // event upgrades written instructions back to the real button (and `adopt`
  // is a no-op for the card when it is closed).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    adopt(e);
  });
  // Covers an install completed some other way — the browser's own menu —
  // while our card is up.
  window.addEventListener('appinstalled', () => {
    parked = null;
    clearLatch();
    useInstallStore.setState({ promptable: false, installed: true });
  });

  if (!intended) return;
  if (runningInstalled()) {
    clearLatch();
    return;
  }

  useInstallStore.setState({ open: true });

  // ADOPTION: whatever the inline `<script>` in index.html caught before this
  // bundle ran. Module scripts are deferred, so on a warm visit the event can
  // arrive while the document is still parsing — the listener above would then
  // be added minutes of CPU time too late, and nothing re-fires it on its own.
  const early = window.__installPromptEvent;
  if (early) adopt(early);

  deadline = window.setTimeout(() => {
    useInstallStore.setState({ timedOut: true });
  }, EVENT_DEADLINE_MS);
}

export type InstallPlatform = 'ios' | 'firefox' | 'safari' | 'other';

/**
 * Which written instructions to show when there is no install API at all.
 *
 * **The one place in this feature that branches on the user agent**, and it is
 * a pure function over its arguments so it can be checked as a table. (The app
 * has one other UA test, `spaceInvite.needsAppHandOff()`, which answers a
 * different question — whether to offer the native app — and predates this.)
 *
 * Order is load-bearing. iPadOS 13+ reports a *desktop Mac* user agent, so it
 * is only separable from a real Mac by the touch screen; and every Chromium
 * browser carries "Safari" in its UA, so desktop Safari can only be identified
 * by what is absent.
 */
export function installPlatform(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  touchPoints: number = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
): InstallPlatform {
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && touchPoints > 1) return 'ios';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua)) return 'safari';
  return 'other';
}
