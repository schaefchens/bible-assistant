import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ROUTES } from '@/lib/appRoutes';
import { copyText, shareText } from '@/lib/nativeBridge';
import { formatSpaceCode } from '@/lib/spaceCode';
import { webInviteUrl } from '@/lib/spaceInvite';
import { useGoBack } from '@/hooks/useGoBack';
import { useCommunityStore } from '@/store/communityStore';
import { useReaderStore } from '@/store/readerStore';
import type { Post, Space } from '@/types/domain';
import { spaceDisplayName } from '@/services/community/spaceName';

type Props = {
  space: Space;
  onNewPost: (draft: Post) => void;
  onEditPost: (post: Post) => void;
};

/**
 * One of the user's own spaces: its pieces, its share code, and who may read it.
 *
 * Write-through rather than buffered, like `ReadingListDetail`: the fields here
 * are a name and a switch, and there is nothing to cancel. The *post* editor is
 * buffered, because a piece of writing is a document.
 */
export function SpaceDetail({ space, onNewPost, onEditPost }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const goBack = useGoBack(ROUTES.spaces);

  const posts = useCommunityStore((s) => s.posts);
  const shared = useCommunityStore((s) => s.shared);
  const memberships = useCommunityStore((s) => s.memberships);
  const saveSpace = useCommunityStore((s) => s.saveSpace);
  const deleteSpace = useCommunityStore((s) => s.deleteSpace);
  const shareSpace = useCommunityStore((s) => s.shareSpace);
  const decideMember = useCommunityStore((s) => s.decideMember);
  const setSource = useReaderStore((s) => s.setSource);

  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!confirmingRotate) return;
    const id = window.setTimeout(() => setConfirmingRotate(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmingRotate]);

  const mine = useMemo(
    () =>
      posts
        .filter((p) => p.spaceId === space.id)
        .sort((a, b) => (b.publishedAt || Infinity) - (a.publishedAt || Infinity)),
    [posts, space.id],
  );
  const members = memberships.filter((m) => m.spaceId === space.id);
  const pending = members.filter((m) => m.status === 'pending');
  const readers = members.filter((m) => m.status === 'accepted');

  const isToday = space.kind === 'today';
  const title = spaceDisplayName(space);

  const newPost = () => {
    const now = Date.now();
    onNewPost({
      id: crypto.randomUUID(),
      spaceId: space.id,
      title: '',
      body: '',
      language: (i18n.language || 'en').startsWith('de') ? 'de' : 'en',
      publishedAt: 0,
      createdAt: now,
      updatedAt: now,
    });
  };

  const onShare = async () => {
    const code = await shareSpace(space.id);
    if (!code) return;
    await shareText(webInviteUrl(code));
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
        <h1 className="font-serif text-brand text-lg truncate flex-1 min-w-0">{title}</h1>
        {mine.some((p) => p.publishedAt > 0) && (
          <button
            type="button"
            onClick={() => {
              void setSource({ kind: 'space', spaceId: space.id }).then(() =>
                navigate(ROUTES.read),
              );
            }}
            className="text-xs text-brand hover:underline px-1"
          >
            {t('community.read')}
          </button>
        )}
        <button type="button" onClick={newPost} className="btn-primary text-sm">
          + {t('community.newPost')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        {isToday && <p className="text-xs text-brand-muted">{t('community.todayHint')}</p>}

        <section className="space-y-2">
          <SectionTitle>{t('community.share')}</SectionTitle>
          {space.shareCode ? (
            <>
              <p className="font-mono text-base text-brand tracking-wide">
                {formatSpaceCode(space.shareCode)}
              </p>
              <div className="flex gap-2 flex-wrap">
                <SmallButton
                  onClick={() => {
                    void copyText(formatSpaceCode(space.shareCode!)).then((ok) => {
                      if (ok) {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      }
                    });
                  }}
                >
                  {copied ? '✓' : t('community.shareCopy')}
                </SmallButton>
                <SmallButton onClick={() => void onShare()}>
                  {t('community.shareSend')}
                </SmallButton>
                <SmallButton
                  danger={confirmingRotate}
                  onClick={() => {
                    if (!confirmingRotate) {
                      setConfirmingRotate(true);
                      return;
                    }
                    setConfirmingRotate(false);
                    void shareSpace(space.id, true);
                  }}
                >
                  {confirmingRotate
                    ? t('community.shareRotateConfirm')
                    : t('community.shareRotate')}
                </SmallButton>
              </div>
            </>
          ) : (
            <SmallButton onClick={() => void onShare()}>
              {t('community.shareCreate')}
            </SmallButton>
          )}
          <p className="text-xs text-ink-muted">{t('community.shareHint')}</p>
        </section>

        <section className="space-y-2">
          <SectionTitle>{t('community.approval')}</SectionTitle>
          {/* Two radio-ish rows rather than a checkbox: "auto" and "manual" are
              not the presence and absence of a thing, they are two policies. */}
          {(['manual', 'auto'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void saveSpace({ ...space, approval: mode })}
              className={clsx(
                'w-full text-left px-3 py-2 rounded-xl text-sm transition-colors',
                space.approval === mode
                  ? 'bg-brand/15 text-ink ring-1 ring-brand/40'
                  : 'bg-surface-raised text-ink-muted',
              )}
            >
              {t(mode === 'auto' ? 'community.approvalAuto' : 'community.approvalManual')}
            </button>
          ))}
        </section>

        {!isToday && (
          <section className="space-y-2">
            <Field label={t('community.spaceName')}>
              <Draft
                value={space.name}
                onCommit={(v) => void saveSpace({ ...space, name: v || t('community.untitledSpace') })}
                maxLength={120}
              />
            </Field>
            <Field label={t('community.spaceDescription')}>
              <Draft
                value={space.description ?? ''}
                onCommit={(v) => void saveSpace({ ...space, description: v || undefined })}
                maxLength={500}
                multiline
              />
            </Field>
          </section>
        )}

        {pending.length > 0 && (
          <section className="space-y-2">
            <SectionTitle>{t('community.requests', { count: pending.length })}</SectionTitle>
            {pending.map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised"
              >
                <Avatar name={m.displayName} url={m.avatarUrl} />
                <span className="flex-1 min-w-0 truncate text-sm text-ink">{m.displayName}</span>
                <SmallButton onClick={() => void decideMember(m.userId, space.id, 'accepted')}>
                  {t('community.accept')}
                </SmallButton>
                <SmallButton danger onClick={() => void decideMember(m.userId, space.id, 'blocked')}>
                  {t('community.block')}
                </SmallButton>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <SectionTitle>{t('community.readers')}</SectionTitle>
          {readers.length === 0 && (
            <p className="text-sm text-ink-muted">{t('community.noReaders')}</p>
          )}
          {readers.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised"
            >
              <Avatar name={m.displayName} url={m.avatarUrl} />
              <span className="flex-1 min-w-0 truncate text-sm text-ink">{m.displayName}</span>
              <SmallButton danger onClick={() => void decideMember(m.userId, space.id, 'blocked')}>
                {t('community.block')}
              </SmallButton>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <SectionTitle>{t('community.pieces', { count: mine.length })}</SectionTitle>
          {mine.length === 0 && <p className="text-sm text-ink-muted">{t('community.empty')}</p>}
          {mine.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => onEditPost(post)}
              className="w-full text-left px-3 py-2 rounded-xl bg-surface-raised"
            >
              <span className="flex items-center gap-2">
                <span className="text-ink truncate flex-1 min-w-0">
                  {post.title || t('community.untitledPost')}
                </span>
                <span
                  className={clsx(
                    'text-[10px] uppercase tracking-wider',
                    shared[post.id] ? 'text-brand' : 'text-ink-muted',
                  )}
                >
                  {t(shared[post.id] ? 'community.published' : 'community.draft')}
                </span>
              </span>
            </button>
          ))}
        </section>

        {!isToday && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('community.deleteSpaceConfirm', { name: title }))) {
                void deleteSpace(space.id).then(goBack);
              }
            }}
            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-sm text-red-400"
          >
            {t('community.deleteSpace')}
          </button>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string }) {
  return (
    <span className="h-7 w-7 rounded-full overflow-hidden bg-surface flex items-center justify-center text-brand text-xs shrink-0">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        (name.slice(0, 1).toUpperCase() || '?')
      )}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] uppercase tracking-wider text-ink-muted">{children}</h2>;
}

function SmallButton({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 rounded-lg text-xs transition-colors shrink-0',
        danger ? 'bg-red-500/15 text-red-400' : 'bg-surface text-brand',
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/** Commits on blur or Enter — see CommunitySection's DraftField for why. */
function Draft({
  value,
  onCommit,
  maxLength,
  multiline = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [adopted, setAdopted] = useState(value);
  if (!focused && value !== adopted) {
    setAdopted(value);
    setDraft(value);
  }
  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  const cls =
    'w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60';
  const shared = {
    value: draft,
    maxLength,
    onFocus: () => setFocused(true),
    onBlur: commit,
    className: cls,
  };
  return multiline ? (
    <textarea rows={2} {...shared} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input
      {...shared}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
