import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PostEditor } from '@/components/community/PostEditor';
import { SpaceDetail } from '@/components/community/SpaceDetail';
import { ShareSpaceButton, ShareSpaceSheet } from '@/components/community/ShareSpaceSheet';
import { SubscribeField } from '@/components/community/SubscribeField';
import { QuillIcon, ShareIcon, TrashIcon, UnlinkIcon } from '@/components/common/icons';
import { useLocale } from '@/hooks/useLocale';
import { ROUTES } from '@/lib/appRoutes';
import { releaseReader } from '@/lib/spacePlayback';
import clsx from 'clsx';
import { Empty, Row } from '@/components/community/spaceRows';
import { SubscriptionMenu } from '@/components/community/SubscriptionMenu';
import { useCommunityStore } from '@/store/communityStore';
import { useReaderStore } from '@/store/readerStore';
import type { Post, Space, Subscription } from '@/types/domain';
import { spaceDisplayName, spaceLabel } from '@/services/community/spaceName';
import { NewPiecesBar } from '@/components/community/NewPiecesBar';
import { CommunityTermsGate } from '@/components/community/CommunityTermsGate';
import { useCommunityTermsAccepted } from '@/lib/communityTerms';
import { useCommunityRefresh } from '@/hooks/useCommunityRefresh';

/**
 * `/spaces` and `/spaces/:id` — the index of the user's own spaces and the
 * spaces they read, plus the editor for one space.
 *
 * Index and editor share one component, mirroring `CardsPage`: one route pair,
 * and the editor is a full-screen swap rather than a modal. A post editor is a
 * third swap *inside* the space editor, so writing a piece never leaves the
 * space it belongs to.
 */
export function SpacesPage() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();

  const profile = useCommunityStore((s) => s.profile);
  const spaces = useCommunityStore((s) => s.spaces);
  const subscriptions = useCommunityStore((s) => s.subscriptions);

  // A post being written, held here rather than in the store so an abandoned
  // draft leaves nothing behind — the same reasoning as CardsPage's draftCard.
  const [draftPost, setDraftPost] = useState<Post | null>(null);

  // Both sides of a share are waiting on each other here: the author for a
  // request to arrive, the subscriber for it to be accepted.
  useCommunityRefresh();

  const termsAccepted = useCommunityTermsAccepted();

  const space = routeId ? spaces.find((s) => s.id === routeId) : undefined;
  // The editor follows the **draft**, not the route. Resolving its shelf from
  // `:id` quietly meant a piece could only be started from a shelf's own
  // screen; the draft has carried its `spaceId` all along, so the index can
  // start one too.
  const draftSpace = draftPost ? spaces.find((s) => s.id === draftPost.spaceId) : undefined;

  // A profile that predates the content standards has not agreed to them, and
  // this is the one screen every community path goes through — including the
  // space editor and the post editor beneath it. New profiles accept at the
  // opt-in and never see this.
  if (profile && !termsAccepted) return <CommunityTermsGate />;

  if (draftPost && draftSpace) {
    return (
      <PostEditor
        post={draftPost}
        space={draftSpace}
        onClose={() => setDraftPost(null)}
      />
    );
  }

  if (routeId) {
    if (!space) return <MissingSpace onBack={() => navigate(ROUTES.spaces)} />;
    return <SpaceDetail space={space} onNewPost={setDraftPost} onEditPost={setDraftPost} />;
  }

  return (
    <SpacesIndex
      hasProfile={profile !== null}
      spaces={spaces}
      subscriptions={subscriptions}
      onOpenSettings={() => navigate(ROUTES.settings)}
      onNewPost={setDraftPost}
    />
  );
}

function SpacesIndex({
  hasProfile,
  spaces,
  subscriptions,
  onOpenSettings,
  onNewPost,
}: {
  hasProfile: boolean;
  spaces: Space[];
  subscriptions: Subscription[];
  onOpenSettings: () => void;
  onNewPost: (draft: Post) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createSpace = useCommunityStore((s) => s.createSpace);
  const posts = useCommunityStore((s) => s.posts);
  const feed = useCommunityStore((s) => s.feed);
  const feedState = useCommunityStore((s) => s.feedState);
  const seen = useCommunityStore((s) => s.seen);
  const memberships = useCommunityStore((s) => s.memberships);
  const setSource = useReaderStore((s) => s.setSource);

  /**
   * Which of the two lists is showing.
   *
   * Always your own first: every profile has a "Today" shelf that cannot be
   * deleted, so "you have none of your own" is not a state a profiled user can
   * be in, and there is nothing for a cleverer default to fix.
   */
  const [tab, setTab] = useState<'mine' | 'following'>('mine');

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of posts) {
      if (p.publishedAt > 0) out[p.spaceId] = (out[p.spaceId] ?? 0) + 1;
    }
    return out;
  }, [posts]);

  /** New pieces across every shelf you read — what the hidden tab would show. */
  const unreadFollowing = useMemo(
    () =>
      subscriptions.reduce(
        (n, sub) => n + (feed[sub.code] ?? []).filter((p) => !seen[p.id]).length,
        0,
      ),
    [subscriptions, feed, seen],
  );

  const create = async () => {
    const space = await createSpace(t('community.newSpace'));
    if (space) navigate(`${ROUTES.spaces}/${space.id}`);
  };

  const openSpace = async (key: { spaceId?: string; code?: string }) => {
    await setSource({ kind: 'space', ...key });
    navigate(ROUTES.read);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* No back button: this is a nav tab now, and the tab bar is how you
          leave it. `/spaces/:id` keeps its own — its fallback is this index. */}
      {/* Just the title now. Both of the things that used to sit beside it —
          "new shelf" and the code field — are in the body, under the sentence
          that explains them. Neither shrinks, so up here they squeezed the
          title column (`min-w-0 flex-1`) to nothing on a narrow phone: the
          heading and its subtitle were the only things that could. */}
      <header className="px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <h1 className="font-serif text-brand text-lg truncate">{t('community.title')}</h1>
        <p className="text-[11px] text-ink-muted truncate">{t('community.subtitle')}</p>
      </header>

      {/* A column rather than one long scroller: only one of the two lists
          shows at a time, and it takes the whole remaining height and scrolls
          on its own. Stacked, a long list of your own pushed the ones you read
          off the bottom of a phone entirely. */}
      <div className="flex-1 min-h-0 flex flex-col px-4 py-4">
        {!hasProfile ? (
          // Without a profile there is nothing to show and nothing to do here,
          // so point at the one place that fixes it rather than rendering two
          // empty lists.
          <div className="space-y-2 pb-28">
            <p className="text-sm text-ink-muted">{t('community.profile.hint')}</p>
            <button type="button" onClick={onOpenSettings} className="btn-primary">
              {t('community.profile.create')}
            </button>
          </div>
        ) : (
          <>
            {/* What a shelf is *for*, and the way to get one — as a pair,
                because the sentence is what makes the button worth pressing.
                Above the list of them, so the screen reads as an explanation,
                the action it implies, and then what you already have. */}
            <div className="shrink-0 space-y-3">
              {/* `whitespace-pre-line`, because the string carries a newline:
                  the two ways onto this screen — make one, or add one somebody
                  shared — are two sentences and read as two lines. */}
              <p className="text-xs leading-relaxed text-ink-muted whitespace-pre-line">
                {t('community.indexHint')}
              </p>
              {/* The two ways in, side by side and in the order the sentence
                  above puts them. */}
              {/* `items-start`, because the field grows downward when it has
                  something to say and the button should stay put. */}
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => void create()}
                  className="btn-primary text-sm shrink-0 whitespace-nowrap"
                >
                  + {t('community.newSpace')}
                </button>
                <SubscribeField onSubscribed={() => setTab('following')} />
              </div>
            </div>

            {/* `aria-pressed` buttons rather than ARIA tabs, matching the two
                switches this app already has — the /cards strip and the share
                sheet's piece/shelf toggle. The counts are on the labels because
                with one list hidden they are the only thing that says whether
                there is anything behind it, and the dot is there for the same
                reason: new pieces used to be visible without a tap. */}
            <div className="mt-5 mb-3 shrink-0 flex gap-1 rounded-xl bg-surface-raised p-1">
              <IndexTab
                label={t('community.mine')}
                count={spaces.length}
                active={tab === 'mine'}
                onClick={() => setTab('mine')}
              />
              <IndexTab
                label={t('community.following')}
                count={subscriptions.length}
                unread={unreadFollowing}
                active={tab === 'following'}
                onClick={() => setTab('following')}
              />
            </div>

            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pb-28">
              {tab === 'mine' ? (
                <>
                  {spaces.length === 0 && <Empty>{t('community.empty')}</Empty>}
                  {spaces.map((space) => {
                    const pending = memberships.filter(
                      (m) => m.spaceId === space.id && m.status === 'pending',
                    ).length;
                    return (
                      <Row
                        key={space.id}
                        emoji={space.emoji}
                        title={spaceDisplayName(space)}
                        detail={t('community.pieces', { count: counts[space.id] ?? 0 })}
                        badge={pending > 0 ? String(pending) : undefined}
                        onOpen={() => navigate(`${ROUTES.spaces}/${space.id}`)}
                        onRead={
                          (counts[space.id] ?? 0) > 0
                            ? () => void openSpace({ spaceId: space.id })
                            : undefined
                        }
                        trailing={<OwnSpaceActions space={space} onNewPost={onNewPost} />}
                      />
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Above the list, because reading across everyone is the more
                      common intent than picking one person. */}
                  <NewPiecesBar />
                  {subscriptions.length === 0 && <Empty>{t('community.emptyFollowing')}</Empty>}
                  {subscriptions.map((sub) => {
                    const posts = feed[sub.code] ?? [];
                    const state = feedState[sub.code];
                    const unread = posts.filter((p) => !seen[p.id]).length;
                    const status =
                      state?.keyChanged || sub.status === 'revoked'
                        ? t(state?.keyChanged ? 'community.keyChanged' : 'community.revoked')
                        : sub.status === 'pending'
                          ? t('community.pending')
                          : t('community.pieces', { count: posts.length });
                    return (
                      <Row
                        key={sub.code}
                        emoji={sub.spaceEmoji}
                        // Whose space it is belongs in the name, not in a detail
                        // line — it is half of what identifies it.
                        title={spaceLabel(sub.ownerName, { kind: sub.spaceKind ?? 'custom', name: sub.spaceName })}
                        detail={status as string}
                        badge={unread > 0 ? String(unread) : undefined}
                        warn={state?.keyChanged}
                        // These two were the *same* function until a room could
                        // hold plans and boards; the row now opens the room and the
                        // ▶ keeps starting the reading, which is what the own-space
                        // rows above have always meant. A room with no pieces is
                        // still worth opening — it may hold a plan.
                        onOpen={() => navigate(`${ROUTES.rooms}/${sub.code}`)}
                        onRead={
                          posts.length > 0 ? () => void openSpace({ code: sub.code }) : undefined
                        }
                        trailing={
                          <span className="flex shrink-0 items-center">
                            <FollowedSpaceActions
                              sub={sub}
                              title={spaceLabel(sub.ownerName, {
                                kind: sub.spaceKind ?? 'custom',
                                name: sub.spaceName,
                              })}
                            />
                            <SubscriptionMenu
                              code={sub.code}
                              authorKey={sub.pinnedKey}
                              ownerName={sub.ownerName}
                              spaceLabel={spaceLabel(sub.ownerName, {
                                kind: sub.spaceKind ?? 'custom',
                                name: sub.spaceName,
                              })}
                            />
                          </span>
                        }
                      />
                    );
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What you can do to one of your own shelves without opening it: put something
 * on it, pass it on, throw it away.
 *
 * Icons rather than the `⋮` the shelves-you-read rows carry, because these
 * three are the shelf's whole point and none of them is a complaint — that menu
 * exists to hold *report* and *block* away from a mis-tap, and there is nothing
 * of that kind here.
 *
 * Delete goes through the same `window.confirm` as the one on the shelf's own
 * screen: it is the same irreversible act, and it should ask the same question
 * wherever it is offered. "Today" has none — `deleteSpace` refuses it, so
 * offering a button that cannot work would be the worst of both.
 */
function OwnSpaceActions({
  space,
  onNewPost,
}: {
  space: Space;
  onNewPost: (draft: Post) => void;
}) {
  const { t } = useTranslation();
  const lang = useLocale();
  const deleteSpace = useCommunityStore((s) => s.deleteSpace);
  const title = spaceDisplayName(space);

  const write = () => {
    const now = Date.now();
    onNewPost({
      id: crypto.randomUUID(),
      spaceId: space.id,
      title: '',
      body: '',
      language: lang,
      publishedAt: 0,
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={write}
        aria-label={`${t('community.newPost')} — ${title}`}
        title={t('community.newPost') as string}
        className={ROW_ACTION}
      >
        <QuillIcon size={15} />
      </button>
      <ShareSpaceButton
        spaceId={space.id}
        label={`${t('community.shareSpace.action')} — ${title}`}
        className={ROW_ACTION}
      />
      {space.kind !== 'today' && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('community.deleteSpaceConfirm', { name: title }))) {
              void deleteSpace(space.id);
            }
          }}
          aria-label={`${t('community.deleteSpace')} — ${title}`}
          title={t('community.deleteSpace') as string}
          className={clsx(ROW_ACTION, 'hover:text-red-400')}
        >
          <TrashIcon size={15} />
        </button>
      )}
    </span>
  );
}

/**
 * The same idea for a shelf you only read: pass it on, or let it go.
 *
 * No quill — it is not yours to write in — and no trash, because nothing is
 * destroyed: you stop reading, and the code would let you back in. Hence a
 * broken link rather than a bin, and hence the question being "stop reading?"
 * rather than "delete?".
 *
 * `⋮` stays beside these holding *report* and *block*. Those two are complaints
 * about a person, and a menu is what keeps them a deliberate act rather than a
 * mis-tap — which is exactly why the two harmless ones came out of it.
 */
function FollowedSpaceActions({ sub, title }: { sub: Subscription; title: string }) {
  const { t } = useTranslation();
  const unsubscribe = useCommunityStore((s) => s.unsubscribe);
  const [sharing, setSharing] = useState(false);

  return (
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setSharing(true)}
        aria-label={`${t('community.shareSpace.action')} — ${title}`}
        title={t('community.shareSpace.action') as string}
        className={ROW_ACTION}
      >
        <ShareIcon />
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('community.unsubscribeConfirm', { name: title }))) {
            // Before the unsubscribe, not after: the reader may be walking this
            // very shelf, and it has to be sent home rather than left on one
            // that no longer resolves.
            releaseReader([sub.code]);
            void unsubscribe(sub.code);
          }
        }}
        aria-label={`${t('community.unsubscribe')} — ${title}`}
        title={t('community.unsubscribe') as string}
        className={clsx(ROW_ACTION, 'hover:text-red-400')}
      >
        <UnlinkIcon size={15} />
      </button>
      <ShareSpaceSheet
        code={sub.code}
        title={title}
        open={sharing}
        onClose={() => setSharing(false)}
      />
    </span>
  );
}

/** One shape for all three, so they read as a set rather than three controls. */
const ROW_ACTION =
  'h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-ink-muted ' +
  'hover:text-brand active:scale-95 transition-all disabled:opacity-40';

/**
 * One of the index's two lists, as a switch.
 *
 * The unread dot carries an accessible name rather than being decoration only:
 * a dot is the whole signal that the other list has something new in it, and a
 * screen reader would otherwise hear the two tabs as identical but for a count.
 */
function IndexTab({
  label,
  count,
  unread = 0,
  active,
  onClick,
}: {
  label: string;
  count: number;
  unread?: number;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors',
        active ? 'bg-brand text-on-brand' : 'text-ink-muted hover:text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 opacity-60">{count}</span>
      {unread > 0 && (
        <span
          aria-label={t('community.unread', { count: unread }) as string}
          className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-on-brand' : 'bg-brand')}
        />
      )}
    </button>
  );
}

function MissingSpace({ onBack }: { onBack: () => void }) {
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
