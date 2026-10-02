import { beforeEach, describe, expect, it } from 'vitest';

/**
 * A translation withdrawn from the picker (translationCatalog `offered`) must
 * not stay selected on an install that chose it before. The rule lives in the
 * settings store's `merge`, so it runs on every hydration rather than once.
 *
 * Integration, because it is localStorage → persist → the store.
 */

const { useSettingsStore } = await import('@/store/settingsStore');

function seed(fields: Record<string, unknown>) {
  localStorage.setItem(
    'ba.settings',
    JSON.stringify({ state: { theme: 'dark', ...fields }, version: 18 }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('hydrating a translation the app no longer offers', () => {
  it('falls back to the locale default and forgets it was chosen', async () => {
    seed({ locale: 'en', translation: 'ESV', translationOverridden: true });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().translation).toBe('KJV');
    // Not overridden any more, so a later language switch re-defaults it.
    expect(useSettingsStore.getState().translationOverridden).toBe(false);

    seed({ locale: 'de', translation: 'HFA', translationOverridden: true });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().translation).toBe('LUT');
  });

  it('keeps an offered choice exactly as it was', async () => {
    seed({ locale: 'en', translation: 'S00', translationOverridden: true });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().translation).toBe('S00');
    expect(useSettingsStore.getState().translationOverridden).toBe(true);
  });
});
