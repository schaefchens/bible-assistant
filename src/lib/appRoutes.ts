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
  cards: '/cards',
  boards: '/boards',
  settings: '/settings',
} as const;

/** Routes that show scripture and therefore want the reading affordances
 * (auto-play + follow-the-verse toggles on the floating playback bar). */
export function isReadingRoute(pathname: string): boolean {
  return pathname === ROUTES.chat || pathname === ROUTES.read;
}

export function isReaderRoute(pathname: string): boolean {
  return pathname === ROUTES.read;
}
