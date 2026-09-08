import { useSettingsStore } from '@/store/settingsStore';

/**
 * The content standards a user accepts before the community is switched on.
 *
 * The text lives in `src/i18n/*.json` under `community.terms.*` — this module
 * owns only the *version* and the two questions the rest of the app asks about
 * it, so that "has this user agreed" has exactly one answer everywhere.
 *
 * **Bump this when the rules change in substance**, not when the wording is
 * tidied: every user is asked again, which is the point of a version and also
 * the cost of one. Nothing backfills it, so an install that enabled the
 * community before the standards existed reads as not-accepted and is gated on
 * the community screens until it accepts.
 */
export const COMMUNITY_TERMS_VERSION = 1;

/** Read outside React (store guards) — the chokepoint form. */
export function communityTermsAccepted(): boolean {
  return useSettingsStore.getState().communityTermsVersion >= COMMUNITY_TERMS_VERSION;
}

/** The same question for a component, so it re-renders on acceptance. */
export function useCommunityTermsAccepted(): boolean {
  return useSettingsStore((s) => s.communityTermsVersion >= COMMUNITY_TERMS_VERSION);
}
