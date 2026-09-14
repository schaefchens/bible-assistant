import { describe, expect, it } from 'vitest';
import { installPlatform, urlWithoutInstallParam } from '@/lib/pwaInstall';

/**
 * The two rules of `?install=1` that are pure functions, tested at the lowest
 * layer that can see them. The event lifecycle needs a `window` and lives in
 * `tests/int/pwaInstall.test.ts`.
 */

describe('stripping ?install=1', () => {
  /**
   * The rule is that the strip is *surgical*. A blanket
   * `replaceState(null, '', location.pathname)` is the obvious way to write
   * this and it eats every other parameter — which in this app means
   * `?piece=<uuid>`, the thing an invitation was pointing at.
   */
  it.each([
    ['?install=1', '', '/', '/'],
    ['?other=x&install=1', '', '/', '/?other=x'],
    ['?install=1&other=x', '', '/', '/?other=x'],
    ['?piece=abc&install=1&web=1', '', '/subscribe/CODE', '/subscribe/CODE?piece=abc&web=1'],
    // Not asked for, but the caller passes whatever is in the bar: leave the
    // rest of it exactly as found.
    ['?other=x', '', '/read', '/read?other=x'],
    ['', '', '/read', '/read'],
    // The fragment survives — a link may carry one, and the native build
    // routes entirely through it.
    ['?install=1&other=x', '#/read', '/', '/?other=x#/read'],
  ])('%s + %s at %s → %s', (search, hash, pathname, expected) => {
    expect(urlWithoutInstallParam(search, hash, pathname)).toBe(expected);
  });
});

describe('which written instructions to show', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  /** iPadOS 13+ reports a *desktop Mac* UA; only the touch screen separates it. */
  const IPADOS =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const MAC_SAFARI = IPADOS;
  const MAC_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

  it.each([
    ['iPhone', IPHONE, 0, 'ios'],
    ['iPad (old UA)', 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) Safari/604.1', 5, 'ios'],
    ['iPadOS, desktop UA + touch', IPADOS, 5, 'ios'],
    ['a real Mac, same UA, no touch', MAC_SAFARI, 0, 'safari'],
    ['Firefox on Android', 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0', 5, 'firefox'],
    ['Firefox on the desktop', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/130.0 Firefox/130.0', 0, 'firefox'],
    // Every Chromium browser carries "Safari" in its UA, so desktop Safari can
    // only be identified by what is *absent*.
    ['Chrome on macOS', MAC_CHROME, 0, 'other'],
    ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 0, 'other'],
    ['Chrome on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36', 5, 'other'],
    ['nothing at all', '', 0, 'other'],
  ])('%s → %s', (_name, ua, touchPoints, expected) => {
    expect(installPlatform(ua, touchPoints)).toBe(expected);
  });
});
