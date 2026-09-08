import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '@/store/communityStore';
import { useReaderStore } from '@/store/readerStore';
import type { Post, Space } from '@/types/domain';
import type { Translation } from '@/services/bible/bibleApi';
import {
  spaceSequence,
  type ReaderSource,
  type SegmentRef,
} from '@/services/reading/readingSequence';
import { groupSubscriptionsByAuthor, type ResolvedSpace } from '@/services/community/spaceReading';
import { spaceDisplayName, spaceLabel } from '@/services/community/spaceName';
import { useNewPieceSelections } from '@/hooks/useNewPieceSelections';
import { PassageRow } from '@/components/reading/PassageRow';
import { NarrationDownloadButton } from '@/components/reader/NarrationDownloadButton';
import { NarrationGroupButton } from '@/components/reader/NarrationGroupButton';
import { subjectsForSegments } from '@/lib/narrationGroup';
import { AuthorGroup, PickerBody, PickerEmpty, SourceRow } from './pickerRows';

/**
 * Picking somebody's writing: the index of spaces, and one space's pieces.
 * `{ kind: 'space' }` and `{ kind: 'selection' }`'s half of the picker.
 *
 * These read the community store directly rather than being handed six slices
 * by the shell: they are the only views that care about it, and every selector
 * here takes a primitive or a store-owned array, so a feed refresh re-renders
 * this and nothing else.
 */

/**
 * The pieces in the selected space, in place of the book columns — exactly as a
 * selected reading list shows its passages.
 *
 * No progress bar and no day pager: a space has neither, and unread is a dot
 * rather than a tick (per-post completion is local, not synced).
 */
export function SpacePieces({
  space,
  translation,
  onPick,
}: {
  space: ResolvedSpace;
  translation: Translation;
  onPick: (ref: SegmentRef) => void;
}) {
  const { t } = useTranslation();
  // A primitive out of the reader store: `position` is rewritten ~60×/s while
  // audio plays, and subscribing to the object would re-render this list at
  // frame rate.
  const currentPostId = useReaderStore((s) => s.position?.postId);
  const seen = useCommunityStore((s) => s.seen);
  const segments = useMemo(
    () => spaceSequence(space.spaceId, space.posts, translation).all() ?? [],
    [space.spaceId, space.posts, translation],
  );

  if (segments.length === 0) {
    return (
      <PickerBody>
        <PickerEmpty>{t('community.empty')}</PickerEmpty>
      </PickerBody>
    );
  }

  return (
    <PickerBody>
      {/* Same place and the same rule as a reading list's: it covers what the
          sheet is showing, which for a room is all of it — a room has no
          pager. */}
      <div className="flex justify-end pt-2">
        <NarrationGroupButton
          subjects={subjectsForSegments(segments)}
          label={t('read.narration.downloadPieces') as string}
        />
      </div>
      <ul className="py-2 space-y-1">
        {segments.map((seg) => (
          <li key={seg.postId}>
            <PassageRow
              text={seg.postTitle || (t('community.untitledPost') as string)}
              done={false}
              showDone={false}
              current={currentPostId === seg.postId}
              onOpen={() => onPick(seg)}
              trailing={
                <span className="flex items-center gap-1.5 shrink-0">
                  {seg.postId && !seen[seg.postId] && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full bg-brand inline-block"
                    />
                  )}
                  {seg.spaceId && seg.postId && (
                    <NarrationDownloadButton
                      subject={{ kind: 'post', spaceId: seg.spaceId, postId: seg.postId }}
                    />
                  )}
                </span>
              }
            />
          </li>
        ))}
      </ul>
    </PickerBody>
  );
}

/**
 * Pick a space to read from — or one of the two cross-space selections.
 *
 * The selections come first, because reading across everyone is usually why
 * this was opened. They are rows like any other source rather than pills above
 * the list, since that is what they are: pick one and the reader is reading it.
 */
export function SpacesView({
  onSelect,
  onClose,
  onManage,
}: {
  onSelect: (source: ReaderSource) => void;
  onClose: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const profile = useCommunityStore((s) => s.profile);
  const ownSpaces = useCommunityStore((s) => s.spaces);
  const ownPosts = useCommunityStore((s) => s.posts);
  const subscriptions = useCommunityStore((s) => s.subscriptions);
  const feed = useCommunityStore((s) => s.feed);
  const { hasSubscriptions, allNew, today } = useNewPieceSelections(onClose);
  const authorGroups = useMemo(() => groupSubscriptionsByAuthor(subscriptions), [subscriptions]);
  const pieces = (count: number) => t('community.pieces', { count }) as string;

  /**
   * "Everything new" is shown wherever the community is on at all, *not* only
   * where it has something to offer: gated on following somebody it was simply
   * absent for anyone whose install is their own writing, who then had no way
   * to learn the feature exists. The row says why it is empty instead.
   *
   * "Today" is the exception and still hides — it needs an ephemeral space to
   * mean anything, and there is nothing to explain about not having one.
   */
  const allNewDetail = !hasSubscriptions
    ? (t('community.newNeedsSubscriptions') as string)
    : allNew.posts.length === 0
      ? (t('community.nothingNew') as string)
      : pieces(allNew.posts.length);

  return (
    <PickerBody>
      <ul className="py-2 space-y-1">
        {profile && (
          <>
            <li>
              <SourceRow
                label={allNew.name}
                emoji="✨"
                disabled={allNew.posts.length === 0}
                detail={allNewDetail}
                onSelect={allNew.open}
                trailing={
                  allNew.posts.length > 0 ? (
                    <NarrationGroupButton
                      compact
                      subjects={allNew.subjects}
                      label={t('read.narration.downloadSelection', { name: allNew.name }) as string}
                    />
                  ) : undefined
                }
              />
            </li>
            {today.posts.length > 0 && (
              <li>
                <SourceRow
                  label={today.name}
                  emoji="🌅"
                  detail={pieces(today.posts.length)}
                  onSelect={today.open}
                  trailing={
                    <NarrationGroupButton
                      compact
                      subjects={today.subjects}
                      label={t('read.narration.downloadSelection', { name: today.name }) as string}
                    />
                  }
                />
              </li>
            )}
            {/* The selections read across every space; what follows is one
                space at a time. A rule is the whole of that distinction — a
                heading over two rows would be more furniture than list. */}
            <li aria-hidden className="pt-1 pb-1">
              <span className="block border-t border-surface-raised/60" />
            </li>
          </>
        )}

        <OwnSpaces
          spaces={ownSpaces}
          posts={ownPosts}
          authorName={profile?.displayName ?? ''}
          onSelect={onSelect}
        />

        {/* Grouped by author, but only where grouping earns its tap: one space
            from someone is a row, several are a collapsible. Follow a few
            prolific people and the flat list was mostly the same name over and
            over. */}
        {authorGroups.map((group) => {
          const rows = group.subs.map((sub) => {
            const space = { kind: sub.spaceKind ?? 'custom', name: sub.spaceName };
            return (
              <li key={sub.code}>
                <SourceRow
                  // Inside a group the author is the heading, so the row is the
                  // space alone; ungrouped it still names both.
                  label={
                    group.subs.length > 1
                      ? spaceDisplayName(space)
                      : spaceLabel(sub.ownerName, space)
                  }
                  emoji={sub.spaceEmoji}
                  detail={
                    sub.status === 'accepted'
                      ? pieces((feed[sub.code] ?? []).length)
                      : (t(
                          sub.status === 'pending' ? 'community.pending' : 'community.revoked',
                        ) as string)
                  }
                  onSelect={() => onSelect({ kind: 'space', code: sub.code })}
                />
              </li>
            );
          });
          if (group.subs.length === 1) return rows;
          const count = group.subs.reduce((n, sub) => n + (feed[sub.code] ?? []).length, 0);
          return (
            <AuthorGroup
              key={group.authorKey}
              ownerName={group.ownerName}
              detail={`${t('community.spacesCount', { count: group.subs.length })} · ${pieces(count)}`}
            >
              {rows}
            </AuthorGroup>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onManage}
        className="w-full py-3 text-center text-xs text-brand-muted hover:text-brand"
      >
        {t('community.addByCode')}
      </button>
    </PickerBody>
  );
}

/**
 * The user's own spaces, grouped by the same rule as anybody else's — four rows
 * all beginning with your own name is the same noise, and the same unbounded
 * list.
 *
 * Its heading is "your spaces" rather than your display name: it is the one
 * group you can write in, and nobody thinks of their own writing as belonging
 * to their own name.
 */
function OwnSpaces({
  spaces,
  posts,
  authorName,
  onSelect,
}: {
  spaces: Space[];
  posts: Post[];
  authorName: string;
  onSelect: (source: ReaderSource) => void;
}) {
  const { t } = useTranslation();
  const grouped = spaces.length > 1;
  const published = (spaceId: string) =>
    posts.filter((p) => p.spaceId === spaceId && p.publishedAt > 0).length;

  const rows = spaces.map((space) => (
    <li key={space.id}>
      <SourceRow
        label={grouped ? spaceDisplayName(space) : spaceLabel(authorName, space)}
        emoji={space.emoji}
        detail={t('community.pieces', { count: published(space.id) })}
        onSelect={() => onSelect({ kind: 'space', spaceId: space.id })}
      />
    </li>
  ));
  if (!grouped) return rows;

  const total = posts.filter((p) => p.publishedAt > 0).length;
  return (
    <AuthorGroup
      ownerName={t('community.yourSpaces')}
      detail={`${t('community.spacesCount', { count: spaces.length })} · ${t('community.pieces', { count: total })}`}
    >
      {rows}
    </AuthorGroup>
  );
}
