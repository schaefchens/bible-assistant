import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CommunityTermsGate } from '@/components/community/CommunityTermsGate';
import { Empty, Row, SectionTitle } from '@/components/community/spaceRows';
import { ChevronIcon } from '@/components/common/icons';
import { useCommunityRefresh } from '@/hooks/useCommunityRefresh';
import { useGoBack } from '@/hooks/useGoBack';
import { useLocale } from '@/hooks/useLocale';
import { ROUTES } from '@/lib/appRoutes';
import { communityTermsAccepted } from '@/lib/communityTerms';
import { inviteTarget } from '@/lib/spaceInvite';
import { formatPostDate, spaceLabel } from '@/services/community/spaceName';
import { progressStats } from '@/services/reading/readingProgress';
import { listChapterCount } from '@/services/reading/readingEntries';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

/**
 * A room somebody else owns, seen from the reader's side.
 *
 * There was no such screen before: a subscription row went straight to the
 * reader, which was the whole of a room when a room held only pieces. Now it
 * can hold plans and boards too, and those need somewhere to be listed, chosen
 * from and copied — and an invite link pointing at one needs somewhere to land.
 *
 * **`/rooms/:code`, not `/spaces/:code`.** `SpacesPage` resolves its param
 * against the user's own space *ids*, so overloading it would need a
 * discriminator; distinct params are how this codebase already tells
 * `/cards/:cardId` from `/boards/:boardId` apart. A code is also the only way a
 * room somebody else owns is ever named, on the wire and here.
 *
 * The owner's view of their own room stays `SpaceDetail` — it is a different
 * screen because it is a different job: approving readers and managing what is
 * shared, rather than reading it.
 */
export function RoomPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { t } = useTranslation();
  const lang = useLocale();
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.spaces);
  useCommunityRefresh();

  const profile = useCommunityStore((s) => s.profile);
  const subscription = useCommunityStore((s) => s.subscriptions.find((x) => x.code === code));
  const posts = useCommunityStore((s) => s.feed[code]);
  const seen = useCommunityStore((s) => s.seen);
  const feedState = useCommunityStore((s) => s.feedState[code]);
  const mirroredLists = useCommunityStore((s) => s.mirroredLists);
  const mirroredBoards = useCommunityStore((s) => s.mirroredBoards);
  const readingProgress = useLibraryStore((s) => s.readingProgress);
  const setSource = useReaderStore((s) => s.setSource);

  const plans = useMemo(() => mirroredLists.filter((m) => m.code === code), [mirroredLists, code]);
  const boards = useMemo(
    () => mirroredBoards.filter((m) => m.code === code),
    [mirroredBoards, code],
  );

  /**
   * Finish an invitation that named one thing: `/rooms/:code?piece=<id>`.
   *
   * The link may well arrive before there is anything to open — the request is
   * still pending, or the feed has not been fetched — so this waits rather than
   * failing, which is the whole reason the invite lands here instead of staying
   * on `SubscribePage`: this screen polls and that one does not.
   *
   * It fires **once**, and strips the parameter as it goes, so Back returns to
   * the room rather than bouncing straight out of it again.
   */
  const location = useLocation();
  const target = inviteTarget(location.search);
  const openedTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!target || openedTarget.current === target) return;
    const board = mirroredBoards.find((m) => m.code === code && m.itemId === target);
    const plan = mirroredLists.find((m) => m.code === code && m.itemId === target);
    const post = (posts ?? []).find((p) => p.id === target);
    if (!board && !plan && !post) return;

    openedTarget.current = target;
    navigate(`${ROUTES.rooms}/${code}`, { replace: true });
    if (board) navigate(`${ROUTES.cards}/shared/${board.itemId}`);
    else if (plan) void setSource({ kind: 'list', listId: plan.list.id, code }).then(() => navigate(ROUTES.read));
    else void setSource({ kind: 'space', code }).then(() => navigate(ROUTES.read));
  }, [target, code, mirroredBoards, mirroredLists, posts, navigate, setSource]);

  // The standards gate sits above every community screen, and this is one —
  // an invitation that lands here must not skip it.
  if (profile && !communityTermsAccepted()) return <CommunityTermsGate />;
  if (!subscription) return <MissingRoom onBack={goBack} />;

  const title = spaceLabel(subscription.ownerName, {
    kind: subscription.spaceKind ?? 'custom',
    name: subscription.spaceName,
  });

  const openPieces = async () => {
    await setSource({ kind: 'space', code });
    navigate(ROUTES.read);
  };

  const openPlan = async (listId: string) => {
    await setSource({ kind: 'list', listId, code });
    navigate(ROUTES.read);
  };

  const pending = subscription.status === 'pending' || feedState?.status === 'pending';
  const blocked = subscription.status === 'revoked' || feedState?.keyChanged;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back') as string}
          className="text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <ChevronIcon dir="left" size={20} />
        </button>
        <h1 className="flex-1 min-w-0 font-serif text-brand text-lg truncate">
          {subscription.spaceEmoji ? `${subscription.spaceEmoji} ` : ''}
          {title}
        </h1>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        {/* Waiting, revoked or a changed key: the header plus the reason, and
            no sections — there is nothing to list. Deliberately not a bounce to
            /subscribe, whose job is to *create* a request the user already has;
            `useCommunityRefresh` is mounted here and polls every 15s while
            anything is pending, so this screen fills itself in the moment the
            author accepts. */}
        {blocked ? (
          <Empty>
            {t(feedState?.keyChanged ? 'community.keyChanged' : 'community.revoked')}
          </Empty>
        ) : pending ? (
          <Empty>{t('community.pending')}</Empty>
        ) : (
          <>
            <section className="space-y-2">
              <SectionTitle>{t('community.roomPieces')}</SectionTitle>
              {(posts ?? []).length === 0 && <Empty>{t('community.empty')}</Empty>}
              {(posts ?? []).map((post) => (
                <Row
                  key={post.id}
                  title={post.title || (t('community.untitledPost') as string)}
                  detail={formatPostDate(post.publishedAt, lang)}
                  badge={seen[post.id] ? undefined : '•'}
                  onOpen={() => void openPieces()}
                />
              ))}
            </section>

            {plans.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>{t('community.sharedPlans')}</SectionTitle>
                {plans.map((m) => {
                  // The reader's *own* progress on somebody else's plan: a
                  // `readingProgress` row is keyed by list id and lives in this
                  // user's account.
                  const stats = progressStats(m.list, readingProgress[m.list.id]);
                  return (
                    <Row
                      key={m.itemId}
                      emoji={m.list.emoji}
                      title={m.list.name || (t('lists.untitled') as string)}
                      detail={`${t('lists.chapters', { count: listChapterCount(m.list) })} · ${t(
                        'lists.progress',
                        { done: stats.done, total: stats.total },
                      )}`}
                      onOpen={() => navigate(`${ROUTES.lists}/${m.list.id}`)}
                      onRead={() => void openPlan(m.list.id)}
                    />
                  );
                })}
              </section>
            )}

            {boards.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>{t('community.sharedBoards')}</SectionTitle>
                {boards.map((m) => (
                  <Row
                    key={m.itemId}
                    emoji={m.board.emoji}
                    title={m.board.name || (t('boards.title') as string)}
                    detail={t('boards.cardCount', { count: m.cards.length }) as string}
                    // Into the card library's tab strip, not a screen of its
                    // own: a board belongs where boards are, and one renderer
                    // beats two that have to be kept saying the same thing.
                    onOpen={() => navigate(`${ROUTES.cards}/shared/${m.itemId}`)}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MissingRoom({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-ink-muted">{t('community.empty')}</p>
      <button type="button" onClick={onBack} className="btn-primary">
        {t('common.back')}
      </button>
    </div>
  );
}
