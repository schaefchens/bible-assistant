import { apiGetJson, apiPostForm, apiPostJson } from './client';
import { serverUrl } from './origin';
import type { Membership, Post, Profile, Space, Subscription } from '@/types/domain';

/**
 * HTTP for community spaces.
 *
 * A dedicated module rather than inline `apiPostJson` calls (the convention
 * `libraryStore` uses for cards) because there are seventeen actions and two
 * of them — `space.request` and `space.feed` — read across accounts and return
 * a *projection* rather than a stored record. Giving those their own named
 * response types is what keeps the difference visible at the call site.
 */

export type PublicProfile = {
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** The key a subscriber pins. Checked against the share code's fingerprint. */
  authorKey: string;
};

export type PublicSpace = {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  /** `'today'` marks the author's built-in ephemeral space. */
  kind: 'today' | 'custom';
  ephemeralHours: number | null;
};

export type MembershipStatus = Membership['status'];

export type SpaceRequestResponse = {
  status: MembershipStatus;
  space: PublicSpace;
  owner: PublicProfile;
};

export type SpaceFeedResponse = SpaceRequestResponse & {
  /** Empty unless `status === 'accepted'`. Signatures arrive intact. */
  posts: Post[];
};

/* ---- the user's own data ---- */

export function getProfile(): Promise<{ profile: Profile | null }> {
  return apiGetJson<{ profile: Profile | null }>('profile.get');
}

export function setProfile(profile: Profile): Promise<{ profile: Profile }> {
  return apiPostJson<{ profile: Profile }>('profile.set', { profile });
}

/** Leaving the community: drops the server copies, keeps the account. */
export function deleteProfile(): Promise<{ deleted: boolean }> {
  return apiPostJson<{ deleted: boolean }>('profile.delete', {});
}

export async function uploadAvatar(file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append('avatar', file, filename);
  const res = await apiPostForm<{ avatarUrl: string }>('profile.avatar.upload', form);
  // Root-relative from PHP; the native WebView's origin is capacitor://localhost.
  return serverUrl(res.avatarUrl);
}

export function listSpaces(): Promise<{ spaces: Space[] }> {
  return apiGetJson<{ spaces: Space[] }>('spaces.list');
}

export function upsertSpace(space: Space): Promise<{ spaces: Space[] }> {
  return apiPostJson<{ spaces: Space[] }>('spaces.upsert', { space });
}

export function deleteSpace(id: string): Promise<{ spaces: Space[] }> {
  return apiPostJson<{ spaces: Space[] }>('spaces.delete', { id });
}

/**
 * Publish a share code for a space, retiring its previous one.
 *
 * The code is minted on this device — it embeds a fingerprint of the author's
 * public key, which the server has no way to compute. Rotating revokes every
 * existing subscriber, which is the point.
 */
export function setSpaceCode(spaceId: string, code: string): Promise<{ spaces: Space[] }> {
  return apiPostJson<{ spaces: Space[] }>('spaces.code.set', { spaceId, code });
}

export function listPosts(spaceId: string): Promise<{ posts: Post[] }> {
  return apiPostJson<{ posts: Post[] }>('posts.list', { spaceId });
}

export function upsertPost(post: Post): Promise<{ posts: Post[] }> {
  return apiPostJson<{ posts: Post[] }>('posts.upsert', { post });
}

export function deletePost(id: string, spaceId: string): Promise<{ posts: Post[] }> {
  return apiPostJson<{ posts: Post[] }>('posts.delete', { id, spaceId });
}

export function listMembers(): Promise<{ members: Membership[] }> {
  return apiGetJson<{ members: Membership[] }>('members.list');
}

export function decideMember(
  userId: string,
  spaceId: string,
  status: 'accepted' | 'blocked',
): Promise<{ members: Membership[] }> {
  return apiPostJson<{ members: Membership[] }>('members.decide', { userId, spaceId, status });
}

export function listSubscriptions(): Promise<{ subscriptions: Subscription[] }> {
  return apiGetJson<{ subscriptions: Subscription[] }>('subscriptions.list');
}

export function upsertSubscription(
  subscription: Subscription,
): Promise<{ subscriptions: Subscription[] }> {
  return apiPostJson<{ subscriptions: Subscription[] }>('subscriptions.upsert', { subscription });
}

export function deleteSubscription(code: string): Promise<{ subscriptions: Subscription[] }> {
  return apiPostJson<{ subscriptions: Subscription[] }>('subscriptions.delete', { code });
}

/* ---- across accounts ---- */

/**
 * Ask to read a space.
 *
 * Returns the owner's `authorKey`, which the caller MUST check against the
 * fingerprint carried in the pasted code before pinning it
 * (`lib/spaceCode.ts#codeMatchesKey`). Skipping that check reduces this to
 * trust-on-first-use with the server as the introducer.
 */
export function requestSpace(code: string): Promise<SpaceRequestResponse> {
  return apiPostJson<SpaceRequestResponse>('space.request', { code });
}

/**
 * Fetch a subscribed space's posts. Every post must be verified against the
 * pinned key before it is stored or shown — this response is not trusted.
 */
export function getSpaceFeed(code: string): Promise<SpaceFeedResponse> {
  return apiPostJson<SpaceFeedResponse>('space.feed', { code });
}
