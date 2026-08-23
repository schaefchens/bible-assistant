import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getPassphrase } from '@/lib/passphrase';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { PassphraseWords } from '../PassphraseWords';
import { StepHeading } from './StepHeading';

/**
 * The sync opt-in, last in the wizard and off by default.
 *
 * Progressive disclosure on purpose: the recovery phrase only appears once the
 * user has asked for a backup. Showing 12 words to someone who hasn't opted
 * into anything yet is how the old first-run screen managed to make a
 * fully-offline app feel like it needed an account.
 */
export function SyncStep() {
  const { t } = useTranslation();
  const syncEnabled = useSettingsStore((s) => s.syncEnabled);
  const enableSync = useLibraryStore((s) => s.enableSync);
  const mnemonic = getPassphrase() ?? '';

  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTurnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableSync();
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('onboarding.wizard.sync.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <StepHeading
        title={t('onboarding.wizard.sync.title')}
        subtitle={t('onboarding.wizard.sync.subtitle')}
      />

      {syncEnabled ? (
        <div className="space-y-2">
          <p className="text-sm text-gold">✓ {t('onboarding.wizard.sync.on')}</p>
          <p className="text-xs text-cream-dim">{t('onboarding.wizard.sync.onHint')}</p>
        </div>
      ) : !revealed ? (
        <div className="space-y-4">
          <p className="text-sm text-cream-dim">{t('onboarding.wizard.sync.body')}</p>
          <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={() => setRevealed(true)}>
            {t('onboarding.wizard.sync.setUp')}
          </button>
          <p className="text-xs text-cream-dim/70">{t('onboarding.wizard.sync.later')}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <h3 className="text-sm font-serif text-gold mb-1">{t('onboarding.writeItDown')}</h3>
          <p className="text-xs text-cream-dim mb-4">{t('onboarding.writeItDownHint')}</p>

          <PassphraseWords mnemonic={mnemonic} />

          <label className="flex items-start gap-2 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">{t('onboarding.confirmedWrittenDown')}</span>
          </label>

          {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}

          <button
            type="button"
            className="btn-primary w-full py-3 mt-5 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!confirmed || busy}
            onClick={() => void onTurnOn()}
          >
            {busy ? t('onboarding.wizard.sync.working') : t('onboarding.wizard.sync.turnOn')}
          </button>
        </div>
      )}
    </div>
  );
}
