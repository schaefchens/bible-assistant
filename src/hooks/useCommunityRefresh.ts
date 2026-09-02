import { useEffect } from 'react';
import { useCommunityStore } from '@/store/communityStore';

/**
 * Keep the community screens current while they are open.
 *
 * Sharing is the one part of this app where two people wait on each other, and
 * there is no push channel: `members.list` was only ever pulled at boot and the
 * feeds only on mount, so an author sat looking at a request list from whenever
 * they last loaded, and a subscriber who had just been accepted still read
 * "waiting for approval" until they reloaded. Both needed a reload to see
 * something that had already happened.
 *
 * So: poll, but only where and when it is worth it.
 *
 * - **Only while a community screen is mounted.** This hook is not global.
 * - **Only while the tab is visible.** A backgrounded app polling a shared
 *   server for nothing is what makes polling rude, and the refresh on becoming
 *   visible again covers everything missed.
 * - **`members.list` every tick** — one small file, and it is what the author is
 *   waiting on.
 * - **Feeds only while something is `pending`.** A feed refresh is one
 *   `space.feed` per subscription, each of which prunes and returns posts, so it
 *   is reserved for the case that has to feel live: a subscriber waiting to be
 *   let in. Otherwise feeds refresh on mount and whenever the app comes back to
 *   the foreground, which is when someone would notice a new piece anyway.
 *
 * An earlier version also refreshed feeds on a slower counter, which added a
 * tick counter and a modulo to save a round trip nobody was waiting for. Not
 * worth the moving parts.
 */
const TICK_MS = 15_000;

export function useCommunityRefresh(): void {
  const refreshMembers = useCommunityStore((s) => s.refreshMembers);
  const refreshSubscriptions = useCommunityStore((s) => s.refreshSubscriptions);

  useEffect(() => {
    let stopped = false;
    const visible = () => !stopped && document.visibilityState === 'visible';

    const poll = () => {
      if (!visible()) return;
      void refreshMembers();
      // Someone waiting on an answer is the one case that has to feel live.
      const pending = useCommunityStore
        .getState()
        .subscriptions.some((s) => s.status === 'pending');
      if (pending) void refreshSubscriptions();
    };

    const full = () => {
      if (!visible()) return;
      void refreshMembers();
      void refreshSubscriptions();
    };

    // Arriving, or coming back, is the moment most likely to have news waiting.
    full();
    const id = window.setInterval(poll, TICK_MS);
    document.addEventListener('visibilitychange', full);
    window.addEventListener('online', full);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', full);
      window.removeEventListener('online', full);
    };
  }, [refreshMembers, refreshSubscriptions]);
}
