/**
 * Where the PHP backend lives.
 *
 * Web build:    the SPA and api.php share an origin, mounted under Vite's
 *               `base` — so SERVER_ORIGIN is '' and API_BASE stays the
 *               root-relative '/assistant/api.php' it has always been.
 * Native build: `vite build --mode capacitor`. The WebView's own origin is
 *               capacitor://localhost (iOS) or https://localhost (Android),
 *               and BASE_URL is './', so both the origin and the mount path
 *               have to be baked in from .env.capacitor.
 */

const RAW_ORIGIN = import.meta.env.VITE_SERVER_ORIGIN ?? '';
/** Absolute backend origin ('https://host'), or '' on the web build. */
export const SERVER_ORIGIN = RAW_ORIGIN.replace(/\/+$/, '');

const RAW_PATH = import.meta.env.VITE_SERVER_BASE_PATH ?? import.meta.env.BASE_URL;
/** Path prefix api.php is mounted under ('/assistant'), without a trailing slash. */
export const SERVER_BASE_PATH = RAW_PATH.replace(/\/+$/, '');

export const API_BASE = `${SERVER_ORIGIN}${SERVER_BASE_PATH}/api.php`;

/**
 * Absolutize a root-relative URL the server handed back — api.php returns
 * media as `BASE_PATH . '/storage/audio/…'`, which resolves against
 * capacitor://localhost in the native WebView and 404s.
 *
 * A no-op on the web build (SERVER_ORIGIN is ''), and on URLs that are already
 * absolute or protocol-relative.
 */
export function serverUrl(url: string): string {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return url;
  return SERVER_ORIGIN + url;
}

/**
 * An absolute, publicly shareable URL for a route in this app.
 *
 * Not the same question as {@link serverUrl}, which absolutizes a path the
 * *backend* handed back. This one produces a link to give to another person, so
 * it must be the public address in **both** builds: on the web that is the
 * origin the app is being served from, and on native `window.location.origin`
 * is `capacitor://localhost`, which is meaningless to anyone else — there,
 * `SERVER_ORIGIN` (baked in from .env.capacitor) is the public site.
 */
export function publicAppUrl(path: string): string {
  const origin =
    SERVER_ORIGIN || (typeof window === 'undefined' ? '' : window.location.origin);
  return `${origin}${SERVER_BASE_PATH}${path}`;
}
