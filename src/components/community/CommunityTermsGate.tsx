import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COMMUNITY_TERMS_VERSION } from '@/lib/communityTerms';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';
import { CommunityTerms } from './CommunityTerms';

/**
 * Shown *instead of* the community screens to a profile that has never
 * accepted the content standards.
 *
 * It exists because nothing backfills the acceptance: an install that switched
 * the community on before the standards were written has not agreed to them,
 * and quietly treating that as consent is the one thing a content policy cannot
 * do. New profiles never see this — they accept at the opt-in.
 *
 * Leaving is offered next to accepting, because a gate with one exit is a
 * demand. `disableCommunity` keeps the user's own writing on the device, which
 * is what the copy promises.
 */
export function CommunityTermsGate() {
  const { t } = useTranslation();
  const accept = useSettingsStore((s) => s.acceptCommunityTerms);
  const disableCommunity = useCommunityStore((s) => s.disableCommunity);
  const busy = useCommunityStore((s) => s.busy);
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 space-y-5">
      <div className="space-y-1">
        <h1 className="font-serif text-brand text-lg">{t('community.terms.gateTitle')}</h1>
        <p className="text-xs text-ink-muted">{t('community.terms.gateBody')}</p>
      </div>

      <CommunityTerms />

      <button
        type="button"
        onClick={() => accept(COMMUNITY_TERMS_VERSION)}
        className="btn-primary w-full py-3"
      >
        {t('community.terms.acceptAction')}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!leaving) {
            setLeaving(true);
            return;
          }
          void disableCommunity();
        }}
        className="w-full px-3 py-2 rounded-xl text-sm bg-surface-raised text-ink-muted disabled:opacity-50"
      >
        {leaving ? t('community.profile.leaveConfirm') : t('community.profile.leave')}
      </button>
    </div>
  );
}
