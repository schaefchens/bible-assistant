import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { NarrationDownloadButton } from '@/components/reader/NarrationDownloadButton';
import { postParagraphs } from '@/services/community/postUnits';
import { useCommunityStore } from '@/store/communityStore';
import type { Post, Space } from '@/types/domain';
import { spaceDisplayName } from '@/services/community/spaceName';

type Props = {
  post: Post;
  space: Space;
  onClose: () => void;
};

/**
 * Write one piece.
 *
 * **Buffered**, unlike the space editor: every field is local state and nothing
 * is written until Save. A post is a document — `ReadingListDetail`'s
 * write-through model would queue a sync op per keystroke and, once the piece
 * is shared, re-sign and re-upload it on every letter.
 *
 * Plain text, and the hint says so. That is not a limitation to apologise for:
 * `WordHighlighter` re-splits the exact stored string to build the word index
 * the audio alignment addresses, so rendered text and spoken text have to be
 * the same string. Markdown would be stripped for TTS and the highlight would
 * drift off the words.
 */
export function PostEditor({ post, space, onClose }: Props) {
  const { t } = useTranslation();

  const savePost = useCommunityStore((s) => s.savePost);
  const publishPost = useCommunityStore((s) => s.publishPost);
  const unpublishPost = useCommunityStore((s) => s.unpublishPost);
  const deletePost = useCommunityStore((s) => s.deletePost);
  const isShared = useCommunityStore((s) => s.shared[post.id] === true);

  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [language, setLanguage] = useState(post.language);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Why the content check refused this piece — kept in view while the
   * author edits, since it is the only thing that can clear it. */
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const draft: Post = { ...post, title: title.trim(), body, language };
  const paragraphs = postParagraphs(body);
  const empty = draft.title === '' && paragraphs.length === 0;

  const save = async () => {
    if (busy || empty) return;
    setBusy(true);
    try {
      await savePost(draft);
      setSaved(true);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (busy || empty) return;
    setBusy(true);
    setRefusal(null);
    try {
      // Save first: publishPost signs whatever is in the store, and the
      // signature covers the title and body.
      await savePost(draft);
      await publishPost(post.id);
      onClose();
    } catch (e) {
      // The one error worth keeping the editor open for: the piece was judged
      // against the content standards and refused, and the author is the only
      // person who can do anything about it. The draft is already saved, so
      // nothing is lost while they edit.
      if (e instanceof Error && e.message === 'content_refused') {
        const reason = (e as Error & { reason?: string }).reason;
        setRefusal(reason?.trim() || t('community.moderation.refusedGeneric'));
      } else {
        throw e;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-brand-muted hover:text-brand px-1"
          aria-label={t('common.back') as string}
        >
          ‹
        </button>
        <span className="flex-1 min-w-0 truncate text-[11px] uppercase tracking-wider text-ink-muted">
          {spaceDisplayName(space)}
        </span>
        {isShared && (
          <NarrationDownloadButton
            subject={{ kind: 'post', spaceId: space.id, postId: post.id }}
          />
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || empty}
          className="px-2.5 py-1 rounded-lg text-xs bg-surface-raised text-ink disabled:opacity-50"
        >
          {saved ? '✓' : t('common.save', { defaultValue: 'Save' })}
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy || empty}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {/* "Publish" is the act; once it is out there the same button
              pushes the edit, and saying "Publish" again reads as if it were
              not already published. */}
          {t(isShared ? 'community.republish' : 'community.publish')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 space-y-4">
        {refusal && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
            <p className="text-xs uppercase tracking-wider text-red-400">
              {t('community.moderation.refusedTitle')}
            </p>
            <p className="text-sm text-ink">{refusal}</p>
            <p className="text-xs text-ink-muted">{t('community.moderation.refusedHint')}</p>
          </div>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('community.postTitle') as string}
          maxLength={200}
          className="w-full bg-transparent font-serif text-xl text-ink outline-none placeholder:text-ink-muted/60"
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('community.postBody') as string}
          rows={14}
          className="w-full bg-surface-raised rounded-xl px-3 py-2 font-serif text-ink outline-none focus:ring-2 focus:ring-brand/60 leading-relaxed"
        />
        <p className="text-xs text-ink-muted">{t('community.postBodyHint')}</p>
        {/* The paragraph count is the honest preview of what narration will do:
            one block per paragraph, each independently highlighted. */}
        {paragraphs.length > 0 && (
          <p className="text-xs text-brand-muted">
            {t('community.pieces', { count: paragraphs.length })}
          </p>
        )}

        <div className="flex gap-2">
          {(['en', 'de'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs uppercase tracking-wider transition-colors',
                language === l
                  ? 'bg-brand/15 text-ink ring-1 ring-brand/40'
                  : 'bg-surface-raised text-ink-muted',
              )}
            >
              {l}
            </button>
          ))}
          <span className="text-xs text-ink-muted self-center">
            {t('community.postLanguage')}
          </span>
        </div>

        {isShared && (
          <button
            type="button"
            onClick={() => void unpublishPost(post.id).then(onClose)}
            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-sm text-ink-muted text-left"
          >
            <span className="block">{t('community.unpublish')}</span>
            <span className="block text-xs text-ink-muted/80">
              {t('community.unpublishHint')}
            </span>
          </button>
        )}

        {post.createdAt !== post.updatedAt || isShared ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('community.deletePostConfirm', { title: draft.title }))) {
                void deletePost(post.id).then(onClose);
              }
            }}
            className="w-full px-3 py-2 rounded-xl bg-surface-raised text-sm text-red-400"
          >
            {t('community.deletePost')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
