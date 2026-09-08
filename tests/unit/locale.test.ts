import { describe, expect, it } from 'vitest';
import { localeOf } from '@/i18n/locale';

/**
 * The app ships two locales, so every language tag that arrives has to collapse
 * to one of them. This was written out fourteen times before it was a function
 * — and centralizing it *widened* the input domain, which is what earns the
 * test: each inline copy only ever saw `i18n.language` (always a set, non-empty
 * tag), while this one is also handed `navigator.language` and, through
 * `useLocale`, a possibly-empty i18next value during init.
 */

describe('localeOf', () => {
  it.each([
    ['de', 'de'],
    ['de-DE', 'de'],
    ['de-CH', 'de'],
    ['DE', 'de'],
    ['de-AT', 'de'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['fr', 'en'],
    ['nl', 'en'],
    ['', 'en'],
  ] as const)('%s -> %s', (tag, expected) => {
    expect(localeOf(tag)).toBe(expected);
  });

  it('answers English for an absent tag rather than throwing', () => {
    // i18next has no language until it has initialised, and `navigator` may be
    // absent entirely under SSR-ish conditions.
    expect(localeOf(undefined)).toBe('en');
    expect(localeOf(null)).toBe('en');
  });

  it('does not match a language that merely contains "de"', () => {
    // The rule is a *prefix* test. Swedish and Danish both have to stay English.
    expect(localeOf('sv')).toBe('en');
    expect(localeOf('da')).toBe('en');
    expect(localeOf('id')).toBe('en');
  });
});
