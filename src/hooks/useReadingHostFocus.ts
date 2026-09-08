import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { readingHosts } from '@/lib/readingHosts';
import { isReaderRoute } from '@/lib/appRoutes';

/**
 * Tells the host registry which screen the user is looking at, so "Play" with
 * nothing queued starts the right thing — the chapter on the reader page rather
 * than the last chat reading, or vice versa.
 *
 * Mounted once in AppShell, deliberately: if each page registered its own focus
 * on mount/unmount, the two would race on navigation and whoever unmounted last
 * would win.
 */
export function useReadingHostFocus(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    readingHosts.focus(isReaderRoute(pathname) ? 'reader' : 'chat');
  }, [pathname]);
}
