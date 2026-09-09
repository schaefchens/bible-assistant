import { openSelectionInReader, playSpaceInReader } from '@/lib/spacePlayback';
import { todayPosts, unseenPosts } from '@/services/community/spaceReading';
import { spaceDisplayName } from '@/services/community/spaceName';
import { resolveSpaceByName } from '@/services/community/spaceNameMatch';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
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
        // What else the room holds, so the model can answer "what have I
        // shared with them?" without a second call.
        plans: state.items.filter(
          (i) => i.spaceId === sp.id && i.kind === 'plan' && state.sharedClaims[i.id],
        ).length,
        boards: state.items.filter(
          (i) => i.spaceId === sp.id && i.kind === 'board' && state.sharedClaims[i.id],
        ).length,
      })),
      following: state.subscriptions.map((sub) => ({
        name: spaceDisplayName({ kind: sub.spaceKind ?? 'custom', name: sub.spaceName }),
        author: sub.ownerName,
        status: sub.status,
        pieces: (state.feed[sub.code] ?? []).length,
        plans: state.mirroredLists.filter((m) => m.code === sub.code).length,
        boards: state.mirroredBoards.filter((m) => m.code === sub.code).length,
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


/**
 * Resolve one of the user's **own** spaces by name, for the share tools.
 *
 * Deliberately narrower than `resolveSpaceByName`, which also matches the
 * spaces the user follows: you cannot publish into somebody else's room, so
 * offering their names as candidates would only produce a confident wrong
 * answer. With exactly one space the name is optional — there is nothing to
 * disambiguate.
 */
function ownSpaceByName(name: string | undefined): { ok: true; id: string } | { ok: false; error: string } {
  const state = useCommunityStore.getState();
  if (!state.profile) return { ok: false, error: 'the user has not created a community profile yet' };
  const spaces = state.spaces;
  if (spaces.length === 0) return { ok: false, error: 'the user has no spaces to share into yet' };
  if (!name) {
    if (spaces.length === 1) return { ok: true, id: spaces[0].id };
    return {
      ok: false,
      error: `ask which space: ${spaces.map((s) => spaceDisplayName(s)).join(', ')}`,
    };
  }
  const wanted = name.trim().toLowerCase();
  const hit =
    spaces.find((s) => spaceDisplayName(s).toLowerCase() === wanted) ??
    spaces.find((s) => spaceDisplayName(s).toLowerCase().includes(wanted));
  if (!hit) {
    return {
      ok: false,
      error: `no space of the user's called "${name}". They have: ${spaces
        .map((s) => spaceDisplayName(s))
        .join(', ')}`,
    };
  }
  return { ok: true, id: hit.id };
}

/** Publish one of the user's reading plans into one of their own spaces. */
export async function handleSharePlan(
  args: ToolArgs['share_plan'],
): Promise<ToolDispatchResult> {
  const space = ownSpaceByName(args.space);
  if (!space.ok) return { ok: false, error: space.error };

  const wanted = args.list.trim().toLowerCase();
  const lists = useLibraryStore.getState().readingLists;
  const list =
    lists.find((l) => l.name.toLowerCase() === wanted) ??
    lists.find((l) => l.name.toLowerCase().includes(wanted));
  if (!list) {
    return {
      ok: false,
      error: `no reading list called "${args.list}". They have: ${
        lists.map((l) => l.name).join(', ') || 'none'
      }`,
    };
  }

  try {
    await useCommunityStore.getState().shareList(list.id, space.id);
  } catch (e) {
    return { ok: false, error: refusalOf(e) };
  }
  return { ok: true, data: { shared: list.name, snapshot: true } };
}

/** Publish one of the user's boards, cards and all. */
export async function handleShareBoard(
  args: ToolArgs['share_board'],
): Promise<ToolDispatchResult> {
  const space = ownSpaceByName(args.space);
  if (!space.ok) return { ok: false, error: space.error };

  const wanted = args.board.trim().toLowerCase();
  const boards = useLibraryStore.getState().boards;
  const board =
    boards.find((b) => b.name.toLowerCase() === wanted) ??
    boards.find((b) => b.name.toLowerCase().includes(wanted));
  if (!board) {
    return {
      ok: false,
      error: `no board called "${args.board}". They have: ${
        boards.map((b) => b.name).join(', ') || 'none'
      }`,
    };
  }

  try {
    await useCommunityStore.getState().shareBoard(board.id, space.id);
  } catch (e) {
    return { ok: false, error: refusalOf(e) };
  }
  return { ok: true, data: { shared: board.name, cards: board.cardIds.length, snapshot: true } };
}

/** The moderator's refusal is the one failure worth reporting in the reply. */
function refusalOf(e: unknown): string {
  if (e instanceof Error && e.message === 'content_refused') {
    const reason = (e as Error & { reason?: string }).reason;
    return reason?.trim() || 'the content standards refused it';
  }
  return 'could not share it — the user may be offline';
}
