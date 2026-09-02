import { publicAppUrl } from '@/services/api/origin';
import { formatSpaceCode } from './spaceCode';

/**
 * The two shapes an invitation to a space can take, and the text that carries
 * them.
 *
 * A share code is the invitation; these are just ways of delivering it. Both
 * point at the same route, `/subscribe/<code>`, so whichever one arrives ends
 * up in the same place — and the code itself remains a perfectly good thing to
 * paste, since `parseSpaceCodeInput` accepts all three.
 */

/**
 * The custom scheme that opens the installed app.
 *
 * **Reverse-DNS, matching `appId`, on purpose.** Custom URL schemes are not
 * registered or reserved anywhere: any app may claim `bibleassistant://`, and
 * if two installed apps declare the same scheme iOS picks one *undefined*ly
 * while Android shows a disambiguation chooser. Deriving it from a domain we
 * control makes a collision effectively impossible. Ugly in a URL, but nobody
 * types this — it is fired programmatically from the web interstitial.
 *
 * It is still only a stopgap. App Links (Android) and Universal Links (iOS) are
 * keyed to a domain whose ownership is *proven*, so collisions are impossible
 * by construction; once either is configured, the https link opens the app
 * directly and the interstitial stops being reached on that platform.
 */
export const APP_SCHEME = 'de.schaefchens.apps.bibleassistant';

/** The route both link shapes land on. */
export const SUBSCRIBE_PATH = '/subscribe';

/** The https link — works everywhere, and is the graceful fallback for anyone
 * without the app installed. */
export function webInviteUrl(code: string): string {
  return publicAppUrl(`${SUBSCRIBE_PATH}/${formatSpaceCode(code)}`);
}

/** The link that opens the installed app. Fired from the interstitial, never
 * shared directly — a messenger will not linkify it, and it is a dead end for
 * anyone who does not have the app. */
export function appInviteUrl(code: string): string {
  return `${APP_SCHEME}://subscribe/${formatSpaceCode(code)}`;
}

/**
 * What the share sheet sends: the space, the link, and the bare code.
 *
 * The code is included as well as the link because in-app browsers (WhatsApp,
 * Instagram) sometimes mangle or intercept links, and pasting a code into the
 * app always works.
 */
export function inviteShareText(spaceLabel: string, code: string): string {
  return `${spaceLabel}\n${webInviteUrl(code)}\n${formatSpaceCode(code)}`;
}
