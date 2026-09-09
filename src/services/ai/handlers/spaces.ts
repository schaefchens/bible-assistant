import { openSelectionInReader, playSpaceInReader, releaseReader } from '@/lib/spacePlayback';
import { todayPosts, unseenPosts } from '@/services/community/spaceReading';
import { spaceDisplayName } from '@/services/community/spaceName';
import { resolveSpaceByName } from '@/services/community/spaceNameMatch';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import i18n from '@/i18n';
import type { Post, Space } from '@/types/domain';
import type { ToolArgs } from '../tools';
import type { ToolDispatchResult } from '../toolResult';

/**
 * The shelf tools: the whole life of a shelf, plus reading somebody's writing
 * aloud. The tools are named `_shelf` and everything in here is still a
 * `Space` — see `tools/spaces.ts` for where that line is drawn and why.
 *
 * **Almost every handler is a name resolver in front of a store action**, and
 * the resolvers are the part worth reading. The model is handed whatever the
 * user said out loud, so each one has the same three answers: found it, found
 * none — *and here is what there is*, so the model's next turn can offer real
 * names — or found several, which is a question rather than a guess. Naming
 * the candidates in the failure is what stopped the model reaching for
 * `read_verses` when a shelf name did not resolve, and the same reasoning
 * applies to every other kind of thing a user can name.
 *
 * `read_shelf` and `read_new` open the **reader**, not the chat — chat has no
 * representation for a piece. A tool cannot navigate, so they report
 * `opensReader` and `useCommandPipeline` does the routing.
 */

export function handleListShelves(): ToolDispatchResult {
  const state = useCommunityStore.getState();
  if (!state.profile) {
    return { ok: false, error: NO_PROFILE };
  }
  return {
    ok: true,
    data: {
      mine: state.spaces.map((sp) => ({
        name: spaceDisplayName(sp),
        // The user's own name, because their own spaces are named after them
        // too — "read my Today" and "read Christoph's Today" are the same ask
        // when the user is Christoph, and `read_shelf` resolves both.
        author: state.profile?.displayName ?? '',
        expiresAfterHours: sp.ephemeralHours ?? null,
        pieces: state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt > 0).length,
        drafts: state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt === 0).length,
        shared: sp.shareCode !== undefined,
        approval: sp.approval,
        // Titles, not just counts: publish_piece, delete_piece and
        // remove_from_shelf all take a name, and this is where the model
        // learns which names exist. Capped, because a prolific shelf would
        // otherwise dominate the reply.
        draftTitles: titlesOf(state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt === 0)),
        publishedTitles: titlesOf(
          state.posts.filter((p) => p.spaceId === sp.id && p.publishedAt > 0),
        ),
        // Who is waiting to be let in — the author's half of the feature, and
        // the thing they open the app to check.
        readersWaiting: state.memberships
          .filter((m) => m.spaceId === sp.id && m.status === 'pending')
          .map((m) => m.displayName),
        readers: state.memberships.filter((m) => m.spaceId === sp.id && m.status === 'accepted')
          .length,
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
export async function handleWritePiece(args: ToolArgs['write_piece']): Promise<ToolDispatchResult> {
  const state = useCommunityStore.getState();
  if (!state.profile) {
    return { ok: false, error: NO_PROFILE };
  }
  const text = args.text.trim();
  if (text === '') return { ok: false, error: 'no text to write' };

  let spaceId: string | undefined;
  if (args.shelf) {
    const lookup = resolveSpaceByName(args.shelf);
    if (!lookup.ok) return { ok: false, error: lookup.error };
    if (!lookup.key.spaceId) {
      return { ok: false, error: `"${lookup.label}" is someone else's shelf — you can only write in your own` };
    }
    spaceId = lookup.key.spaceId;
  } else {
    spaceId = state.spaces.find((sp) => sp.kind === 'today')?.id;
  }
  if (!spaceId) return { ok: false, error: 'no shelf to write in' };

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

export async function handleReadShelf(args: ToolArgs['read_shelf']): Promise<ToolDispatchResult> {
  const lookup = resolveSpaceByName(args.shelf);
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
    return { ok: false, error: NO_PROFILE };
  }
  const today = args.scope === 'today';
  const chosen = today ? todayPosts() : unseenPosts();
  if (chosen.length === 0) {
    return {
      ok: false,
      error: today
        ? 'nobody the user follows has posted in their Today shelf'
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



/** At most this many titles per shelf in a `list_shelves` reply. */
const MAX_TITLES = 12;

function titlesOf(posts: { title: string }[]): string[] {
  return posts.slice(0, MAX_TITLES).map((p) => p.title);
}

/**
 * The shape every resolver below returns: found it, or a sentence for the
 * model saying what there is instead.
 */
type Found<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Match a thing the user named against a list of things that have names.
 *
 * Exact first, then a unique substring, and **several matches is a question
 * rather than a guess** — the same three tiers `resolveSpaceByName` uses, and
 * for the same reason: acting on the wrong plan is worse than asking which.
 * A miss names everything there is, because the model's next turn is only as
 * good as what the failure told it.
 */
function byName<T>(named: string, things: T[], nameOf: (t: T) => string, kind: string): Found<T> {
  if (things.length === 0) return { ok: false, error: `the user has no ${kind}` };
  const wanted = named.trim().toLowerCase();
  const all = () => things.map(nameOf).filter(Boolean).join(', ');
  const exact = things.filter((t) => nameOf(t).toLowerCase() === wanted);
  const hits =
    exact.length > 0 ? exact : things.filter((t) => nameOf(t).toLowerCase().includes(wanted));
  if (hits.length === 0) {
    return { ok: false, error: `no ${kind} called "${named}". They have: ${all()}` };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      error: `"${named}" matches several ${kind}: ${hits.map(nameOf).join(', ')} — ask which`,
    };
  }
  return { ok: true, value: hits[0] };
}

const NO_PROFILE = 'the user has not created a community profile yet';

function requireProfile(): string | null {
  return useCommunityStore.getState().profile ? null : NO_PROFILE;
}

/**
 * Resolve one of the user's **own** shelves by name.
 *
 * Deliberately narrower than `resolveSpaceByName`, which also matches the
 * shelves the user follows: you cannot publish into somebody else's shelf, so
 * offering their names as candidates would only produce a confident wrong
 * answer. With exactly one shelf the name is optional — there is nothing to
 * disambiguate.
 */
function ownShelfByName(name: string | undefined): Found<Space> {
  const state = useCommunityStore.getState();
  if (!state.profile) return { ok: false, error: NO_PROFILE };
  const spaces = state.spaces;
  if (spaces.length === 0) return { ok: false, error: 'the user has no shelves yet' };
  if (!name) {
    if (spaces.length === 1) return { ok: true, value: spaces[0] };
    return {
      ok: false,
      error: `ask which shelf: ${spaces.map((sp) => spaceDisplayName(sp)).join(', ')}`,
    };
  }
  return byName(name, spaces, spaceDisplayName, 'shelves');
}

/** One of the user's own pieces, draft or published, by title. */
function ownPieceByTitle(title: string): Found<Post> {
  const gate = requireProfile();
  if (gate) return { ok: false, error: gate };
  return byName(title, useCommunityStore.getState().posts, (p) => p.title, 'pieces');
}

/** Exactly one of the alternatives, or a sentence saying so. */
function exactlyOne(named: Record<string, string | undefined>): Found<[string, string]> {
  const given = Object.entries(named).filter(([, v]) => v?.trim());
  if (given.length === 0) {
    return { ok: false, error: `say which: ${Object.keys(named).join(' or ')}` };
  }
  if (given.length > 1) {
    return {
      ok: false,
      error: `only one at a time: ${given.map(([k]) => k).join(' and ')} were both given`,
    };
  }
  return { ok: true, value: [given[0][0], given[0][1] as string] };
}

export async function handleCreateShelf(
  args: ToolArgs['create_shelf'],
): Promise<ToolDispatchResult> {
  const gate = requireProfile();
  if (gate) return { ok: false, error: gate };
  const name = args.name.trim();
  if (name === '') return { ok: false, error: 'a shelf needs a name' };

  const store = useCommunityStore.getState();
  // Two shelves with one name is an ambiguity every resolver above would then
  // have to report forever, so it is refused at the one place a name is
  // chosen rather than tolerated everywhere a name is read.
  if (store.spaces.some((sp) => spaceDisplayName(sp).toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `the user already has a shelf called "${name}"` };
  }
  const space = await store.createSpace(name);
  if (!space) return { ok: false, error: 'could not make the shelf' };
  const description = args.description?.trim();
  if (description) await useCommunityStore.getState().saveSpace({ ...space, description });
  return { ok: true, data: { created: name, shared: false } };
}

export async function handleUpdateShelf(
  args: ToolArgs['update_shelf'],
): Promise<ToolDispatchResult> {
  const found = ownShelfByName(args.shelf);
  if (!found.ok) return { ok: false, error: found.error };
  const space = found.value;
  // Today is created with the profile, and every resolver in the app assumes
  // it is there under that name.
  if (space.kind === 'today' && args.name !== undefined) {
    return { ok: false, error: 'the Today shelf cannot be renamed' };
  }
  const name = args.name?.trim();
  if (args.name !== undefined && !name) return { ok: false, error: 'a shelf needs a name' };

  await useCommunityStore.getState().saveSpace({
    ...space,
    name: name ?? space.name,
    description: args.description?.trim() ?? space.description,
    approval: args.approval ?? space.approval,
  });
  return {
    ok: true,
    data: { shelf: name ?? spaceDisplayName(space), approval: args.approval ?? space.approval },
  };
}

export async function handleDeleteShelf(
  args: ToolArgs['delete_shelf'],
): Promise<ToolDispatchResult> {
  const found = ownShelfByName(args.shelf);
  if (!found.ok) return { ok: false, error: found.error };
  if (found.value.kind === 'today') {
    return { ok: false, error: 'the Today shelf cannot be deleted' };
  }
  const name = spaceDisplayName(found.value);
  await useCommunityStore.getState().deleteSpace(found.value.id);
  return { ok: true, data: { deleted: name } };
}

/**
 * Mint or fetch a shelf's share code.
 *
 * It returns the code, but the tool's description tells the model to say it
 * exists rather than read it out: eighteen characters of base32 spoken aloud
 * is not something anybody can write down, and the shelf screen sends it as a
 * link. The *minting* is what matters here — a shelf with no code cannot be
 * passed on at all.
 */
export async function handleShareShelf(
  args: ToolArgs['share_shelf'],
): Promise<ToolDispatchResult> {
  const found = ownShelfByName(args.shelf);
  if (!found.ok) return { ok: false, error: found.error };
  const code = await useCommunityStore.getState().shareSpace(found.value.id);
  if (!code) return { ok: false, error: 'could not make a share code — the user may be offline' };
  return {
    ok: true,
    data: { shelf: spaceDisplayName(found.value), code, approval: found.value.approval },
  };
}

export async function handleDecideReader(
  args: ToolArgs['decide_reader'],
): Promise<ToolDispatchResult> {
  const gate = requireProfile();
  if (gate) return { ok: false, error: gate };
  const state = useCommunityStore.getState();

  let pending = state.memberships.filter((m) => m.status === 'pending');
  if (args.shelf) {
    const shelf = ownShelfByName(args.shelf);
    if (!shelf.ok) return { ok: false, error: shelf.error };
    pending = pending.filter((m) => m.spaceId === shelf.value.id);
  }
  if (pending.length === 0) return { ok: false, error: 'nobody is waiting to be let in' };

  const found = byName(args.reader, pending, (m) => m.displayName, 'people waiting');
  if (!found.ok) return { ok: false, error: found.error };

  const accepted = args.decision === 'accept';
  await useCommunityStore
    .getState()
    .decideMember(found.value.userId, found.value.spaceId, accepted ? 'accepted' : 'blocked');
  const shelf = state.spaces.find((sp) => sp.id === found.value.spaceId);
  return {
    ok: true,
    data: {
      reader: found.value.displayName,
      decision: args.decision,
      shelf: shelf ? spaceDisplayName(shelf) : '',
    },
  };
}

export async function handlePublishPiece(
  args: ToolArgs['publish_piece'],
): Promise<ToolDispatchResult> {
  const found = ownPieceByTitle(args.piece);
  if (!found.ok) return { ok: false, error: found.error };
  if (found.value.publishedAt > 0) {
    return { ok: false, error: `"${found.value.title}" is already published` };
  }
  try {
    await useCommunityStore.getState().publishPost(found.value.id);
  } catch (e) {
    return { ok: false, error: refusalOf(e) };
  }
  return { ok: true, data: { published: found.value.title } };
}

export async function handleDeletePiece(
  args: ToolArgs['delete_piece'],
): Promise<ToolDispatchResult> {
  const found = ownPieceByTitle(args.piece);
  if (!found.ok) return { ok: false, error: found.error };
  await useCommunityStore.getState().deletePost(found.value.id);
  return { ok: true, data: { deleted: found.value.title } };
}

export async function handleAddToShelf(
  args: ToolArgs['add_to_shelf'],
): Promise<ToolDispatchResult> {
  const which = exactlyOne({ plan: args.plan, board: args.board });
  if (!which.ok) return { ok: false, error: which.error };
  const [kind, named] = which.value;

  const shelf = ownShelfByName(args.shelf);
  if (!shelf.ok) return { ok: false, error: shelf.error };

  const lib = useLibraryStore.getState();
  try {
    if (kind === 'plan') {
      const found = byName(named, lib.readingLists, (l) => l.name, 'reading lists');
      if (!found.ok) return { ok: false, error: found.error };
      await useCommunityStore.getState().shareList(found.value.id, shelf.value.id);
      return {
        ok: true,
        data: { added: found.value.name, to: spaceDisplayName(shelf.value), snapshot: true },
      };
    }
    const found = byName(named, lib.boards, (b) => b.name, 'boards');
    if (!found.ok) return { ok: false, error: found.error };
    await useCommunityStore.getState().shareBoard(found.value.id, shelf.value.id);
    return {
      ok: true,
      data: {
        added: found.value.name,
        cards: found.value.cardIds.length,
        to: spaceDisplayName(shelf.value),
        snapshot: true,
      },
    };
  } catch (e) {
    return { ok: false, error: refusalOf(e) };
  }
}

/**
 * Take a plan, a board or a piece off a shelf.
 *
 * The two halves are genuinely different acts, and the app already draws the
 * line: a shared plan or board is a *snapshot* of something that lives in the
 * library, so removing it is `deleteItem` and the source is untouched; a piece
 * lives only on the device, so removing it is `unpublishPost` and the draft
 * survives. `delete_piece` is the destructive one, and it is its own tool.
 */
export async function handleRemoveFromShelf(
  args: ToolArgs['remove_from_shelf'],
): Promise<ToolDispatchResult> {
  const which = exactlyOne({ plan: args.plan, board: args.board, piece: args.piece });
  if (!which.ok) return { ok: false, error: which.error };
  const [kind, named] = which.value;

  if (kind === 'piece') {
    const found = ownPieceByTitle(named);
    if (!found.ok) return { ok: false, error: found.error };
    if (found.value.publishedAt === 0) {
      return { ok: false, error: `"${found.value.title}" is a draft — nobody can see it yet` };
    }
    await useCommunityStore.getState().unpublishPost(found.value.id);
    return { ok: true, data: { removed: found.value.title, keptAsDraft: true } };
  }

  const state = useCommunityStore.getState();
  // Only what is *currently* on a shelf: an item whose claim has gone is a row
  // nothing would show, and offering it as a candidate would name something
  // the user cannot see.
  let onShelves = state.items.filter((i) => i.kind === kind && state.sharedClaims[i.id]);
  if (args.shelf) {
    const shelf = ownShelfByName(args.shelf);
    if (!shelf.ok) return { ok: false, error: shelf.error };
    onShelves = onShelves.filter((i) => i.spaceId === shelf.value.id);
  }
  if (onShelves.length === 0) {
    return { ok: false, error: `no ${kind}s are on the user's shelves` };
  }
  const found = byName(named, onShelves, (i) => i.title, `${kind}s on a shelf`);
  if (!found.ok) return { ok: false, error: found.error };

  await useCommunityStore.getState().deleteItem(found.value.id);
  const shelf = state.spaces.find((sp) => sp.id === found.value.spaceId);
  return {
    ok: true,
    data: {
      removed: found.value.title,
      from: shelf ? spaceDisplayName(shelf) : '',
      stillInLibrary: true,
    },
  };
}

export async function handleUnfollowShelf(
  args: ToolArgs['unfollow_shelf'],
): Promise<ToolDispatchResult> {
  const lookup = resolveSpaceByName(args.shelf);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  if (!lookup.key.code) {
    return {
      ok: false,
      error: `"${lookup.label}" is the user's own shelf — they are not following it`,
    };
  }
  // Before unsubscribing, not after: the reader may be walking that shelf, and
  // a source that no longer resolves leaves it on a screen with nothing on it.
  releaseReader([lookup.key.code]);
  await useCommunityStore.getState().unsubscribe(lookup.key.code);
  return { ok: true, data: { unfollowed: lookup.label } };
}

export async function handleCopyFromShelf(
  args: ToolArgs['copy_from_shelf'],
): Promise<ToolDispatchResult> {
  const which = exactlyOne({ plan: args.plan, board: args.board });
  if (!which.ok) return { ok: false, error: which.error };
  const [kind, named] = which.value;
  const state = useCommunityStore.getState();

  if (kind === 'plan') {
    const found = byName(named, state.mirroredLists, (m) => m.list.name, 'shared reading lists');
    if (!found.ok) return { ok: false, error: found.error };
    const id = await useCommunityStore.getState().copySharedList(found.value.list.id);
    if (!id) return { ok: false, error: 'could not copy it' };
    return { ok: true, data: { copied: found.value.list.name, from: found.value.author } };
  }
  const found = byName(named, state.mirroredBoards, (m) => m.board.name, 'shared boards');
  if (!found.ok) return { ok: false, error: found.error };
  const id = await useCommunityStore.getState().copySharedBoard(found.value.board.id);
  if (!id) return { ok: false, error: 'could not copy it' };
  return {
    ok: true,
    data: {
      copied: found.value.board.name,
      cards: found.value.cards.length,
      from: found.value.author,
    },
  };
}

/** The moderator's refusal is the one failure worth reporting in the reply. */
function refusalOf(e: unknown): string {
  if (e instanceof Error && e.message === 'content_refused') {
    const reason = (e as Error & { reason?: string }).reason;
    return reason?.trim() || 'the content standards refused it';
  }
  return 'could not do it — the user may be offline';
}
