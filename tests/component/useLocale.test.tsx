import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useLocale } from '@/hooks/useLocale';

/**
 * `useLocale` replaced fourteen inline copies of
 * `(i18n.language || 'en').startsWith('de') ? 'de' : 'en'`. The narrowing
 * itself is pinned in `tests/unit/locale.test.ts`; what needs a render is the
 * part a pure function cannot show — that a component using it **re-renders
 * when the language changes**.
 *
 * That is the whole reason the hook is built on `useTranslation()` rather than
 * reading `i18n.language` directly, and it is exactly what a hand-rolled
 * version would get wrong: the value would be right on first render and then
 * silently stale for the rest of the session.
 */

function Probe() {
  return <span>{useLocale()}</span>;
}

const shownLocale = () => screen.getByText(/^(en|de)$/).textContent;

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('useLocale', () => {
  it('reports the current language', () => {
    render(<Probe />);
    expect(shownLocale()).toBe('en');
  });

  it('re-renders the component when the language changes', async () => {
    render(<Probe />);
    expect(shownLocale()).toBe('en');

    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(shownLocale()).toBe('de');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(shownLocale()).toBe('en');
  });

  it('narrows a regional tag, so de-CH is still German', async () => {
    render(<Probe />);
    await act(async () => {
      await i18n.changeLanguage('de-CH');
    });
    expect(shownLocale()).toBe('de');
  });

  it('falls back to English for a language the app does not ship', async () => {
    render(<Probe />);
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(shownLocale()).toBe('en');
  });
});
