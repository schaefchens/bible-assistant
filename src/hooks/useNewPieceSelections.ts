import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '@/lib/appRoutes';
import { openSelectionInReader } from '@/lib/spacePlayback';
import { todayPosts, unseenPosts, type LocatedPost } from '@/services/community/spaceReading';
import { useCommunityStore } from '@/store/communityStore';
import type { NarrationSubject } from '@/store/narrationStore';

/**
 * The two cross-space readings: everything you have not seen, and today's
 * pieces from everyone you follow.
 *
 * Both are *selections* — a fixed set of pieces, snapshotted when opened — not
 * saved views. Opening one again later gives a fresh one, which is what makes
 * "everything new" empty out as you work through it. They cover subscribed
 * spaces only: the user's own writing is not new to them.
 *
 * A hook rather than logic inside `NewPiecesBar`, because the two selections
 * are offered in two shapes now — pills on `/spaces`, and rows among the
 * spaces in the picker, where they are the first two things you can pick. One
 * copy of "what is new" for both, or they would drift into disagreeing about
 * what "today" means.
 */
export type PieceSelection = {
  id: 'allNew' | 'today';
  /** Localized name; also the label the reading carries in the reader. */
  name: string;
  posts: LocatedPost[];
  /** The same pieces as narration subjects, for a group download. */
  subjects: NarrationSubject[];
  /** Snapshot it into the reader and go there. */
  open: () => void;
};

export function useNewPieceSelections(onOpened?: () => void): {
  /** False when the user follows nobody — there is nothing either row could offer. */
  hasSubscriptions: boolean;
  allNew: PieceSelection;
  today: PieceSelection;
} {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Subscribed to rather than read once: publishing, a feed refresh, or reading
  // a piece all change what these offer.
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);
  const seen = useCommunityStore((s) => s.seen);

  const { unseen, today } = useMemo(
    () => ({ unseen: unseenPosts(), today: todayPosts() }),
    // The selectors read the store directly; these are what change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscriptions, feed, seen],
  );

  const open = useCallback(
    (name: string, posts: LocatedPost[]) => {
      void openSelectionInReader(
        name,
        posts.map((p) => p.post.id),
        false,
      ).then((ok) => {
        if (!ok) return;
        onOpened?.();
        navigate(ROUTES.read);
      });
    },
    [navigate, onOpened],
  );

  const selection = (
    id: PieceSelection['id'],
    name: string,
    posts: LocatedPost[],
  ): PieceSelection => ({
    id,
    name,
    posts,
    subjects: posts.map(({ spaceId, post }) => ({
      kind: 'post',
      spaceId,
      postId: post.id,
    })),
    open: () => open(name, posts),
  });

  return {
    hasSubscriptions: subscriptions.length > 0,
    allNew: selection('allNew', t('community.allNew') as string, unseen),
    today: selection('today', t('community.todayAll') as string, today),
  };
}
