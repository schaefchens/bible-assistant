import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PostEditor } from '@/components/community/PostEditor';
import { SpaceDetail } from '@/components/community/SpaceDetail';
import { SubscribeField } from '@/components/community/SubscribeField';
import { ROUTES } from '@/lib/appRoutes';
import { useGoBack } from '@/hooks/useGoBack';
import { spaceSourceKey } from '@/services/reading/readingSequence';
import { useCommunityStore } from '@/store/communityStore';
import { useReaderStore } from '@/store/readerStore';
import type { Post, Space, Subscription } from '@/types/domain';
import { spaceDisplayName } from '@/services/community/spaceName';

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
  const refresh = useCommunityStore((s) => s.refreshSubscriptions);

  // A post being written, held here rather than in the store so an abandoned
  // draft leaves nothing behind — the same reasoning as CardsPage's draftCard.
  const [draftPost, setDraftPost] = useState<Post | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const space = routeId ? spaces.find((s) => s.id === routeId) : undefined;

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
  const goBack = useGoBack(ROUTES.chat);
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
      <header className="px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur flex items-center gap-2">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back') as string}
          className="text-brand-muted hover:text-brand px-1"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-brand text-lg truncate">{t('community.title')}</h1>
          <p className="text-[11px] text-ink-muted truncate">{t('community.subtitle')}</p>
        </div>
        {hasProfile && (
          <button type="button" onClick={() => void create()} className="btn-primary text-sm">
            + {t('community.newSpace')}
          </button>
        )}
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
                    title={sub.spaceName}
                    detail={`${sub.ownerName} · ${status}`}
                    badge={unread > 0 ? String(unread) : undefined}
                    warn={state?.keyChanged}
                    onOpen={() => void openSpace({ code: sub.code })}
                    onRead={
                      posts.length > 0 ? () => void openSpace({ code: sub.code }) : undefined
                    }
                    trailing={<SubscriptionMenu code={sub.code} />}
                  />
                );
              })}
              <SubscribeField />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SubscriptionMenu({ code }: { code: string }) {
  const { t } = useTranslation();
  const unsubscribe = useCommunityStore((s) => s.unsubscribe);
  const setSource = useReaderStore((s) => s.setSource);
  const source = useReaderStore((s) => s.source);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // If the reader is currently walking this space, send it back to the
        // Bible before the space disappears from under it.
        if (source.kind === 'space' && spaceSourceKey(source) === `c:${code}`) {
          void setSource({ kind: 'bible' });
        }
        void unsubscribe(code);
      }}
      className="text-[11px] text-ink-muted hover:text-red-400 px-2"
    >
      {t('community.unsubscribe')}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] uppercase tracking-wider text-ink-muted">{children}</h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted py-2">{children}</p>;
}

function Row({
  emoji,
  title,
  detail,
  badge,
  warn,
  onOpen,
  onRead,
  trailing,
}: {
  emoji?: string;
  title: string;
  detail: string;
  badge?: string;
  warn?: boolean;
  onOpen: () => void;
  onRead?: () => void;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-xl px-3 py-2 bg-surface-raised',
        warn && 'ring-1 ring-red-500/40',
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          {emoji && <span aria-hidden>{emoji}</span>}
          <span className="text-ink truncate">{title}</span>
          {badge && (
            <span className="text-[10px] rounded-full bg-brand text-on-brand px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-[11px] text-ink-muted truncate">{detail}</span>
      </button>
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className="text-[11px] text-brand hover:underline px-1 shrink-0"
        >
          {t('community.read')}
        </button>
      )}
      {trailing}
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
