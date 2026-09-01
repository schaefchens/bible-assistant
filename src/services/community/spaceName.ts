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

/**
 * How an author is credited: `@Christoph`.
 *
 * There is no separate handle on `Profile` yet — only `displayName` — so the
 * `@` is a prefix on that, not a unique identifier. If named share codes
 * arrive (`lib/spaceCode.ts`), a real handle is the natural thing to key them
 * on, and this is the one place that would change.
 */
export function authorHandle(displayName: string): string {
  const name = displayName.trim();
  return name === '' ? '' : `@${name}`;
}

/**
 * How a space is identified wherever whose space it is isn't already obvious:
 * `@Christoph / Heute`.
 *
 * Reads as a path, which is what a space is — one person's, with a name. Used
 * in the reader header, the picker, and the list of spaces you follow; *not*
 * inside your own space, where the owner is you and the prefix would be noise.
 */
export function spaceLabel(author: string, space: Pick<Space, 'kind' | 'name'>): string {
  const handle = authorHandle(author);
  const name = spaceDisplayName(space);
  return handle === '' ? name : `${handle} / ${name}`;
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
