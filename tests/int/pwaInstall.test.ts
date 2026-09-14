import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The `?install=1` event lifecycle — the half of the feature that needs a
 * window.
 *
 * The rule worth a test here is that **`prompt()` is single-use, and the two
 * ways it can fail mean opposite things about the event**: `NotAllowedError`
 * leaves it usable and is the normal result of the zero-tap attempt, while a
 * success or `InvalidStateError` spends it. Get that backwards and the card
 * shows a button that throws, or hides the only button that would have worked.
 *
 * Nothing is mocked but the event itself — which is exactly what a browser
 * hands the app — so this drives the real module through its real listeners.
 *
 * `vi.resetModules()` per case because the module reads `?install=1` at
 * module-eval time (deliberately: see the comment on `intended`), so the URL
 * has to be set before the import rather than before a call.
 */

type Choice = { outcome: 'accepted' | 'dismissed'; platform: string };

/** The shape Chrome dispatches, with a `prompt()` the test controls. */
function installEvent(prompt: () => Promise<Choice>) {
  const e = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<Choice>;
    userChoice: Promise<Choice>;
  };
  e.prompt = vi.fn(prompt);
  e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
  return e;
}

const notAllowed = () => {
  const err = new Error('The prompt() method must be called with a user gesture');
  err.name = 'NotAllowedError';
  return err;
};

const invalidState = () => {
  const err = new Error('The prompt() method may only be called once');
  err.name = 'InvalidStateError';
  return err;
};

/**
 * Listeners survive `resetModules` — they are on the one jsdom window, not on
 * the module — so a later dispatch would also reach every earlier instance and
 * call its `prompt()` too, which is precisely what the call-count assertions
 * below are about. Record what each boot adds and take it back off afterwards.
 */
const realAdd = window.addEventListener.bind(window);
let added: Array<[string, EventListener]> = [];

/** Let every pending microtask run — a `.finally` is two deep. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function boot(url: string) {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  const mod = await import('@/lib/pwaInstall');
  mod.initPwaInstall();
  return mod;
}

beforeEach(() => {
  added = [];
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ) => {
    added.push([type, fn]);
    realAdd(type, fn, opts);
  }) as typeof window.addEventListener);
});

afterEach(() => {
  for (const [type, fn] of added) window.removeEventListener(type, fn);
  delete window.__installPromptEvent;
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('?install=1', () => {
  it('opens the card and takes the parameter out of the URL, keeping the rest', async () => {
    const mod = await boot('/subscribe/CODE?piece=abc&install=1');
    expect(mod.useInstallStore.getState().open).toBe(true);
    expect(window.location.pathname + window.location.search).toBe('/subscribe/CODE?piece=abc');
  });

  it('stays shut when nobody asked, even if the browser offers an install', async () => {
    const mod = await boot('/');
    window.dispatchEvent(installEvent(() => Promise.reject(notAllowed())));
    expect(mod.useInstallStore.getState().open).toBe(false);
  });

  it('adopts an event the inline <script> parked before the bundle ran', async () => {
    // The listener the module adds cannot see an event that already fired, and
    // nothing re-fires it on request — so without the parked copy this is a
    // card that falls through to written instructions in Chrome.
    const early = installEvent(() => Promise.reject(notAllowed()));
    window.__installPromptEvent = early as never;
    const mod = await boot('/?install=1');
    await vi.waitFor(() => expect(mod.useInstallStore.getState().promptable).toBe(true));
    expect(early.prompt).toHaveBeenCalledTimes(1);
    // The slot is a hand-off buffer, not a second owner: the inline listener
    // re-parks every event it sees, so an adopted one left sitting there is a
    // reference to an event that may since have been spent.
    expect(window.__installPromptEvent).toBeNull();
  });

  it('empties the hand-off slot for an event that arrives later too', async () => {
    // What actually happens on a cold visit: the module initializes before
    // Chrome has decided anything, and the inline listener — added first —
    // parks the event a moment later, on its way to the module's own listener.
    // index.html's listener, stood up here because jsdom loads no document.
    // Registered *before* the module, as it is in the real page: it is a plain
    // inline script in <head> and the bundle is `type="module"`, hence
    // deferred — so the inline one always runs first, and the module's clear is
    // the last word. Swap these two lines and this test fails, which is the
    // point of writing it this way round.
    window.addEventListener('beforeinstallprompt', (e) => {
      window.__installPromptEvent = e;
    });
    const mod = await boot('/?install=1');
    expect(window.__installPromptEvent).toBeUndefined();

    const late = installEvent(() => Promise.reject(notAllowed()));
    window.dispatchEvent(late);
    expect(mod.useInstallStore.getState().promptable).toBe(true);
    expect(window.__installPromptEvent).toBeNull();
  });

  it('does nothing at all when it is already the installed app', async () => {
    // jsdom has no matchMedia at all, which is why the module calls it
    // optionally; here it has to exist and answer yes.
    vi.stubGlobal('matchMedia', () => ({ matches: true }) as MediaQueryList);
    const mod = await boot('/?install=1');
    window.dispatchEvent(installEvent(() => Promise.reject(notAllowed())));
    expect(mod.useInstallStore.getState().open).toBe(false);
    // And the intent is forgotten, so a later visit in the browser is not
    // greeted by a card it never asked for.
    expect(sessionStorage.getItem('ba.install.intent')).toBeNull();
  });
});

describe('the zero-tap attempt', () => {
  it('is made once, and being refused keeps the event for the button', async () => {
    const mod = await boot('/?install=1');
    const event = installEvent(() => Promise.reject(notAllowed()));
    window.dispatchEvent(event);

    await vi.waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    // The refusal is the normal case, not an error: the event is untouched, so
    // the card offers the button that does have a gesture behind it.
    expect(mod.useInstallStore.getState().promptable).toBe(true);
    expect(mod.useInstallStore.getState().open).toBe(true);

    // Let the refusal settle first. Pressing the button inside that window
    // re-attaches to the attempt in flight rather than opening a second dialog
    // — correct, and unreachable in practice, since it closes a microtask after
    // the attempt and no finger is that fast.
    await flush();
    await expect(mod.promptInstall()).resolves.toBe('refused');
    expect(event.prompt).toHaveBeenCalledTimes(2);
  });

  it('is not repeated when a second event arrives', async () => {
    // Chrome re-fires `beforeinstallprompt` whenever installability is
    // re-evaluated. Re-attempting on each would be a second dialog attempt per
    // re-evaluation, and the guard is module scope so StrictMode's double mount
    // cannot reset it either.
    const mod = await boot('/?install=1');
    const first = installEvent(() => Promise.reject(notAllowed()));
    window.dispatchEvent(first);
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalledTimes(1));

    const second = installEvent(() => Promise.reject(notAllowed()));
    window.dispatchEvent(second);
    await Promise.resolve();
    expect(second.prompt).not.toHaveBeenCalled();
    expect(mod.useInstallStore.getState().promptable).toBe(true);
  });

  it('survives a prompt() that throws synchronously rather than rejecting', async () => {
    const mod = await boot('/?install=1');
    const event = installEvent(() => {
      throw notAllowed();
    });
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(event.prompt).toHaveBeenCalled());
    expect(mod.useInstallStore.getState().promptable).toBe(true);
  });
});

describe('answering the real dialog', () => {
  it('accepted: confirms, and spends the event', async () => {
    const mod = await boot('/?install=1');
    const event = installEvent(() => Promise.resolve({ outcome: 'accepted', platform: 'web' }));
    window.dispatchEvent(event);

    await vi.waitFor(() => expect(mod.useInstallStore.getState().installed).toBe(true));
    expect(mod.useInstallStore.getState().promptable).toBe(false);
    // Single-use: calling it again would throw InvalidStateError.
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('ba.install.intent')).toBeNull();
  });

  it('dismissed: closes the card instead of asking again', async () => {
    const mod = await boot('/?install=1');
    window.dispatchEvent(
      installEvent(() => Promise.resolve({ outcome: 'dismissed', platform: 'web' })),
    );
    await vi.waitFor(() => expect(mod.useInstallStore.getState().open).toBe(false));
    expect(sessionStorage.getItem('ba.install.intent')).toBeNull();
  });

  it('InvalidStateError retires the event instead of leaving a button that throws', async () => {
    const mod = await boot('/?install=1');
    window.dispatchEvent(installEvent(() => Promise.reject(invalidState())));
    await vi.waitFor(() => expect(mod.useInstallStore.getState().promptable).toBe(false));
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('a second call while one is in flight re-attaches instead of opening two', async () => {
    const mod = await boot('/?install=1');
    let settle: (c: Choice) => void = () => {};
    const event = installEvent(() => new Promise<Choice>((res) => (settle = res)));
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));

    // What a StrictMode remount does: ask again while the first dialog is open.
    const again = mod.promptInstall();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    settle({ outcome: 'accepted', platform: 'web' });
    await expect(again).resolves.toBe('accepted');
  });
});

describe('waiting for an event that may never come', () => {
  it('falls back to written instructions, then upgrades if one arrives late', async () => {
    vi.useFakeTimers();
    const mod = await boot('/?install=1');
    expect(mod.useInstallStore.getState().timedOut).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(mod.useInstallStore.getState().timedOut).toBe(true);
    expect(mod.useInstallStore.getState().promptable).toBe(false);

    // The subscription stays alive past the deadline on purpose: Chrome can
    // decide the app is installable seconds after load, once the service
    // worker has registered.
    const late = installEvent(() => Promise.reject(notAllowed()));
    window.dispatchEvent(late);
    expect(mod.useInstallStore.getState().promptable).toBe(true);
    expect(late.prompt).toHaveBeenCalledTimes(1);
  });
});
