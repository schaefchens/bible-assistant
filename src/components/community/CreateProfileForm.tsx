import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CommunityTermsConsent } from '@/components/community/CommunityTerms';
import { COMMUNITY_TERMS_VERSION } from '@/lib/communityTerms';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The community opt-in: a name, the content standards, one button.
 *
 * Its own component because it is now wanted in two places — the Settings tile
 * and the shelves screen — and it is the *whole* of what the second one needed.
 * Sending someone from the shelves screen to Settings put them on a screen of
 * collapsed panes with no indication which one to open, having already decided
 * to do the thing.
 *
 * It holds its own state, so a caller is one line. `error` stays here rather
 * than being lifted: the Settings tile has two other failures of its own (the
 * avatar and leaving) and they are not this form's business.
 *
 * `SubscribePage` deliberately keeps a version of its own. Its button accepts,
 * creates *and* asks to read a shelf in one press, and its copy is about the
 * invitation the user is holding — a shared component parameterised into
 * saying either would be one component doing two jobs.
 */
export function CreateProfileForm() {
  const { t } = useTranslation();
  const busy = useCommunityStore((s) => s.busy);
  const enableCommunity = useCommunityStore((s) => s.enableCommunity);
  const acceptTerms = useSettingsStore((s) => s.acceptCommunityTerms);

  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    const displayName = name.trim();
    if (!displayName || !agreed || busy) return;
    setError(null);
    try {
      // Terms first: `enableCommunity` refuses without an accepted version.
      acceptTerms(COMMUNITY_TERMS_VERSION);
      await enableCommunity(displayName);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('community.errors.failed'));
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">{t('community.profile.hint')}</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('community.profile.displayName') as string}
        maxLength={120}
        className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60"
      />
      <CommunityTermsConsent checked={agreed} onChange={setAgreed} />
      <button
        type="button"
        onClick={() => void onCreate()}
        disabled={busy || !agreed || name.trim() === ''}
        className="btn-primary w-full disabled:opacity-50"
      >
        {t('community.profile.create')}
      </button>
      {/* Stated up front, not discovered afterwards: this is the moment an
          account starts holding shareable data. */}
      <p className="text-xs text-ink-muted">{t('community.profile.createHint')}</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
