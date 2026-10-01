/**
 * Route paths as constants, so the several floaters that special-case a route
 * stop repeating string literals.
 *
 * These are the same under both routers: native uses `HashRouter`, so `/read`
 * lives at `#/read`, but `useLocation().pathname` still reads `/read`.
 */
export const ROUTES = {
  chat: '/',
  read: '/read',
  lists: '/lists',
  spaces: '/spaces',
  /** A room somebody else owns, addressed by its share code. See RoomPage. */
  rooms: '/rooms',
  subscribe: '/subscribe',
  cards: '/cards',
  settings: '/settings',
  /** Narration voices: the gallery, and `/settings/voices/:id` (or `new`) the
   * editor. Under Settings, so the Settings tab stays lit. */
  voices: '/settings/voices',
} as const;

/** Routes that show scripture and therefore want the reading affordances
 * (auto-play + follow-the-verse toggles in the mic dock's transport arm). */
export function isReadingRoute(pathname: string): boolean {
  return pathname === ROUTES.chat || pathname === ROUTES.read;
}

export function isReaderRoute(pathname: string): boolean {
  return pathname === ROUTES.read;
}
