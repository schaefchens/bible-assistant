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
