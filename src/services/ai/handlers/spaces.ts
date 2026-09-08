import { openSelectionInReader, playSpaceInReader } from '@/lib/spacePlayback';
import { todayPosts, unseenPosts } from '@/services/community/spaceReading';
import { spaceDisplayName } from '@/services/community/spaceName';
import { resolveSpaceByName } from '@/services/community/spaceNameMatch';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';
import i18n from '@/i18n';
import type { ToolArgs } from '../tools';
import type { ToolDispatchResult } from '../toolResult';

/**
 * The community tools: listing spaces, writing a piece, and reading somebody's
 * writing aloud.
 *
 * `read_space` and `read_new` open the **reader**, not the chat — chat has no
 * representation for a post. A tool cannot navigate, so they report
 * `opensReader` and `useCommandPipeline` does the routing.
 */

export function handleListSpaces(): ToolDispatchResult {
  const state = useCommunityStore.getState();
  if (!state.profile) {
    return { ok: false, error: 'the user has not created a community profile yet' };
  }
  return {
    ok: true,
    data: {
      mine: state.spaces.map((sp) => ({
        name: spaceDisplayName(sp),
        // The user's own name, because their own spaces are named after them
        // too — "read my Today" and "read Christoph's Today" are the same ask
        // when the user is Christoph, and `read_space` resolves both.
        author: state.profile?.displayName ?? '',
        expiresAfterHours: sp.ephemeralHours ?? null,
        pieces: state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt > 0).length,
        drafts: state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt === 0).length,
        shared: sp.shareCode !== undefined,
      })),
      following: state.subscriptions.map((sub) => ({
        name: spaceDisplayName({ kind: sub.spaceKind ?? 'custom', name: sub.spaceName }),
        author: sub.ownerName,
        status: sub.status,
        pieces: (state.feed[sub.code] ?? []).length,
      })),
    },
  };
}

/**
 * Save dictated text as a draft.
 *
 * Deliberately a *draft*: publishing signs the piece with the user's key and
 * makes it readable by their subscribers, and neither is something to do on a
 * voice command's behalf. The tool description says so too, so the model does
 * not report the piece as shared.
 */
export async function handleWritePost(args: ToolArgs['write_post']): Promise<ToolDispatchResult> {
  const state = useCommunityStore.getState();
  if (!state.profile) {
    return { ok: false, error: 'the user has not created a community profile yet' };
  }
  const text = args.text.trim();
  if (text === '') return { ok: false, error: 'no text to write' };

  let spaceId: string | undefined;
  if (args.space) {
    const lookup = resolveSpaceByName(args.space);
    if (!lookup.ok) return { ok: false, error: lookup.error };
    if (!lookup.key.spaceId) {
      return { ok: false, error: `"${lookup.label}" is someone else's space — you can only write in your own` };
    }
    spaceId = lookup.key.spaceId;
  } else {
    spaceId = state.spaces.find((sp) => sp.kind === 'today')?.id;
  }
  if (!spaceId) return { ok: false, error: 'no space to write in' };

  const now = Date.now();
  const title = args.title?.trim() || firstLineAsTitle(text);
  await useCommunityStore.getState().savePost({
    id: crypto.randomUUID(),
    spaceId,
    title,
    body: text,
    language: args.language ?? useSettingsStore.getState().locale,
    publishedAt: 0,
    createdAt: now,
    updatedAt: now,
  });
  const space = useCommunityStore.getState().spaces.find((sp) => sp.id === spaceId);
  return {
    ok: true,
    data: {
      saved: 'draft',
      title,
      space: space ? spaceDisplayName(space) : '',
      shared: false,
    },
  };
}

/** A title from the opening words, so a dictated piece is findable. */
function firstLineAsTitle(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

export async function handleReadSpace(args: ToolArgs['read_space']): Promise<ToolDispatchResult> {
  const lookup = resolveSpaceByName(args.space);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  // A subscription the author has not accepted has no feed to read, and saying
  // so is the whole answer — "nothing to read yet" would send the user looking
  // for pieces that are there but not theirs to see.
  if (lookup.status && lookup.status !== 'accepted') {
    return {
      ok: false,
      error:
        lookup.status === 'pending'
          ? `"${lookup.label}" has not accepted the user's request to read it yet`
          : `the user's access to "${lookup.label}" has been withdrawn`,
    };
  }

  const started = await playSpaceInReader(lookup.key);
  if (!started) {
    return { ok: false, error: `"${lookup.label}" has nothing to read yet` };
  }
  return { ok: true, opensReader: true, data: { reading: lookup.label, alreadyRead: true } };
}

/**
 * Read across every space the user follows.
 *
 * The selection is snapshotted here, the same way the buttons do it — see
 * `ReaderSource`'s `'selection'` variant for why a filter would reshuffle the
 * reading as pieces get marked seen.
 */
export async function handleReadNew(args: ToolArgs['read_new']): Promise<ToolDispatchResult> {
  const state = useCommunityStore.getState();
  if (!state.profile) {
    return { ok: false, error: 'the user has not created a community profile yet' };
  }
  const today = args.scope === 'today';
  const chosen = today ? todayPosts() : unseenPosts();
  if (chosen.length === 0) {
    return {
      ok: false,
      error: today
        ? 'nobody the user follows has posted in their Today space'
        : 'there is nothing new to read',
    };
  }
  const label = i18n.t(today ? 'community.todayAll' : 'community.allNew');
  const started = await openSelectionInReader(
    label,
    chosen.map((p) => p.post.id),
    true,
  );
  if (!started) return { ok: false, error: 'could not start reading' };
  return {
    ok: true,
    opensReader: true,
    data: { reading: label, pieces: chosen.length, alreadyRead: true },
  };
}
