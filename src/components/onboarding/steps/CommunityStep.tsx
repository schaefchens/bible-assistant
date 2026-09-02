import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';
import { StepHeading } from './StepHeading';

/**
 * The community opt-in, after sync and last in the wizard.
 *
 * Same progressive disclosure as `SyncStep`, and for the same reason: nothing
 * is created until the user asks for it, so someone who just wants to read
 * scripture never types a display name. Skipping is a first-class outcome —
 * the footer moves on and no profile exists.
 *
 * It comes after sync because it *implies* sync: `enableCommunity` turns it on,
 * since publishing and subscribing are inherently server-side. That is stated
 * on the screen rather than discovered afterwards, and it is why this step
 * cannot come first.
 */
export function CommunityStep() {
  const { t } = useTranslation();
  const profile = useCommunityStore((s) => s.profile);
  const busy = useCommunityStore((s) => s.busy);
  const enableCommunity = useCommunityStore((s) => s.enableCommunity);
  const syncEnabled = useSettingsStore((s) => s.syncEnabled);

  const [revealed, setRevealed] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    const displayName = name.trim();
    if (!displayName || busy) return;
    setError(null);
    try {
      await enableCommunity(displayName);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('onboarding.wizard.community.failed'));
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <StepHeading
        title={t('onboarding.wizard.community.title')}
        subtitle={t('onboarding.wizard.community.subtitle')}
      />

      {profile ? (
        <div className="space-y-2">
          <p className="text-sm text-brand">✓ {t('onboarding.wizard.community.on')}</p>
          <p className="text-xs text-ink-muted">{t('onboarding.wizard.community.onHint')}</p>
        </div>
      ) : !revealed ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">{t('onboarding.wizard.community.body')}</p>
          <button
            type="button"
            className="btn-ghost px-4 py-2 text-sm"
            onClick={() => setRevealed(true)}
          >
            {t('onboarding.wizard.community.setUp')}
          </button>
          <p className="text-xs text-ink-muted/70">{t('onboarding.wizard.community.later')}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <label className="text-sm mb-2" htmlFor="community-name">
            {t('onboarding.wizard.community.nameLabel')}
          </label>
          <input
            id="community-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
            placeholder={t('onboarding.wizard.community.namePlaceholder') as string}
            maxLength={120}
            autoFocus
            className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60"
          />
          <p className="text-xs text-ink-muted mt-2">
            {t('onboarding.wizard.community.nameHint')}
          </p>

          {/* Only worth saying while sync is still off — otherwise it describes
              something the previous step already did. */}
          {!syncEnabled && (
            <p className="text-xs text-brand-muted mt-3">
              {t('onboarding.wizard.community.syncNote')}
            </p>
          )}

          {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}

          <button
            type="button"
            className="btn-primary w-full py-3 mt-5 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={name.trim() === '' || busy}
            onClick={() => void onCreate()}
          >
            {busy
              ? t('onboarding.wizard.community.working')
              : t('onboarding.wizard.community.create')}
          </button>
        </div>
      )}
    </div>
  );
}
