import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PostEditor } from '@/components/community/PostEditor';
import { SpaceDetail } from '@/components/community/SpaceDetail';
import { SubscribeField } from '@/components/community/SubscribeField';
import { ROUTES } from '@/lib/appRoutes';
import {  } from '@/services/reading/readingSequence';
import { Empty, Row, SectionTitle } from '@/components/community/spaceRows';
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
  const { t } = useTranslation();
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

  // A profile that predates the content standards has not agreed to them, and
  // this is the one screen every community path goes through — including the
  // space editor and the post editor beneath it. New profiles accept at the
  // opt-in and never see this.
  if (profile && !termsAccepted) return <CommunityTermsGate />;

  if (draftPost && space) {
    return (
      <PostEditor
        post={draftPost}
        space={space}
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
      emptyLabel={t('community.empty')}
    />
  );
}

function SpacesIndex({
  hasProfile,
  spaces,
  subscriptions,
  onOpenSettings,
}: {
  hasProfile: boolean;
  spaces: Space[];
  subscriptions: Subscription[];
  onOpenSettings: () => void;
  emptyLabel: string;
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

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of posts) {
      if (p.publishedAt > 0) out[p.spaceId] = (out[p.spaceId] ?? 0) + 1;
    }
    return out;
  }, [posts]);

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
      {/* `relative` so the code field's hint can hang under it without
          changing the header's height as you type. */}
      <header className="relative px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-brand text-lg truncate">{t('community.title')}</h1>
          <p className="text-[11px] text-ink-muted truncate">{t('community.subtitle')}</p>
        </div>
        {/* Being sent a code is the commonest reason to be on this screen, so
            the field stays up here — and it is now the only thing competing
            with the title. "New shelf" used to sit beside it, which on a narrow
            phone squeezed the title column (`min-w-0 flex-1`) to nothing: the
            two of them do not shrink, so the heading and its subtitle were the
            only things that could. */}
        {hasProfile && <SubscribeField />}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        {!hasProfile ? (
          // Without a profile there is nothing to show and nothing to do here,
          // so point at the one place that fixes it rather than rendering two
          // empty lists.
          <div className="space-y-2">
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
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-ink-muted">
                {t('community.indexHint')}
              </p>
              <button type="button" onClick={() => void create()} className="btn-primary text-sm">
                + {t('community.newSpace')}
              </button>
            </div>

            <section className="space-y-2">
              <SectionTitle>{t('community.mine')}</SectionTitle>
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
                  />
                );
              })}
            </section>

            <section className="space-y-2">
              <SectionTitle>{t('community.following')}</SectionTitle>
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
                      <SubscriptionMenu
                        code={sub.code}
                        authorKey={sub.pinnedKey}
                        ownerName={sub.ownerName}
                        spaceLabel={spaceLabel(sub.ownerName, {
                          kind: sub.spaceKind ?? 'custom',
                          name: sub.spaceName,
                        })}
                      />
                    }
                  />
                );
              })}
            </section>
          </>
        )}
      </div>
    </div>
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
