import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setPassphrase, validatePassphrase } from '@/lib/passphrase';
import { useLibraryStore } from '@/store/libraryStore';
import { extractErrorDetail } from '@/lib/extractErrorDetail';

/**
 * Restore an existing library by entering its recovery phrase.
 *
 * Entering a phrase *is* asking for the server copy, so this turns sync on and
 * pulls in the same breath — offering it as a separate later step would leave
 * the user staring at an empty library wondering where everything went.
 */
export function RecoverPassphrase({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const enableSync = useLibraryStore((s) => s.enableSync);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onActivate = async () => {
    if (!validatePassphrase(value)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Await the write before going on: the app can be killed in the gap, and
      // this is the value the user cannot reproduce.
      await setPassphrase(value);
      // Goes straight to pullFromServer, so it doesn't matter that
      // libraryStore.init() already ran under the freshly-minted identity.
      await enableSync();
      onDone();
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('onboarding.wizard.sync.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-cream-dim self-start mb-4 hover:text-cream"
      >
        ← {t('common.back')}
      </button>
      <h2 className="text-xl font-serif text-gold mb-2">{t('onboarding.recoverTitle')}</h2>
      <p className="text-sm text-cream-dim mb-5">{t('onboarding.recoverHint')}</p>

      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (invalid) setInvalid(false);
        }}
        autoFocus
        rows={4}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-gold/60"
        placeholder="word word word…"
      />

      {invalid && (
        <p className="text-sm text-rose-400 mt-2">{t('onboarding.invalidPassphrase')}</p>
      )}
      {error && <p className="text-sm text-rose-400 mt-2">{error}</p>}

      <button
        type="button"
        className="btn-primary w-full py-3 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={value.trim().length === 0 || busy}
        onClick={() => void onActivate()}
      >
        {busy ? t('onboarding.wizard.sync.working') : t('onboarding.activate')}
      </button>
    </div>
  );
}
