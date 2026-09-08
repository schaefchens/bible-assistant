import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import de from './de.json';
import { useSettingsStore } from '@/store/settingsStore';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: useSettingsStore.getState().locale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

useSettingsStore.subscribe((state, prev) => {
  if (state.locale !== prev.locale) {
    void i18n.changeLanguage(state.locale);
  }
});

export default i18n;
