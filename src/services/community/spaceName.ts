import i18n from '@/i18n';
import type { Space } from '@/types/domain';

/**
 * What to call a space on screen.
 *
 * The "Today" space is created with the literal name `'Today'` — it has to have
 * *some* stored name, and storing a localized one would freeze whatever
 * language the profile happened to be created in, then travel to subscribers in
 * that language. So its name is localized at the point of display instead, and
 * this is the one place that rule lives: it was written out at five call sites,
 * and the reader header (the one that read `space.name` straight) showed
 * "TODAY" while every other screen said "Heute".
 */
export function spaceDisplayName(space: Pick<Space, 'kind' | 'name'>): string {
  return space.kind === 'today' ? i18n.t('community.todayName') : space.name;
}

/** How an author is credited. Just their display name — see {@link spaceLabel}. */
export function authorName(displayName: string): string {
  return displayName.trim();
}

/**
 * How a space is identified wherever whose space it is isn't already obvious:
 * `Christoph / Heute`.
 *
 * Reads as a path, which is what a space is — one person's, with a name. Used
 * in the reader header, the picker, and the list of spaces you follow; *not*
 * inside your own space, where the owner is you and the prefix would be noise.
 *
 * Deliberately **no `@` prefix**. `Profile` has only a `displayName`, which is
 * neither unique nor claimed — two people can both be "Christoph". An `@` would
 * promise an identity guarantee that nothing here provides, and the thing that
 * actually identifies an author is their signing key (its fingerprint is shown
 * in Settings). Give a handle a real field first, and this is the one place that
 * would then change — as would `lib/spaceCode.ts`, if named codes key on it.
 */
export function spaceLabel(author: string, space: Pick<Space, 'kind' | 'name'>): string {
  const name = authorName(author);
  const space_ = spaceDisplayName(space);
  return name === '' ? space_ : `${name} / ${space_}`;
}

/**
 * A piece's publication time, in the reader's locale.
 *
 * Date *and* time, because the Today space turns over daily — "1 Sept" alone
 * would not distinguish this morning's piece from last night's.
 */
export function formatPostDate(publishedAt: number, lang: 'en' | 'de'): string {
  if (!publishedAt) return '';
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(publishedAt),
  );
}
