import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '@/store/communityStore';

/**
 * Add a space from a code someone gave you.
 *
 * Deliberately the plainest possible input, following `RecoverPassphrase`'s
 * pattern for the other pasted secret in this app: monospace, no autocorrect,
 * no capitalisation, and normalisation on submit rather than as you type.
 *
 * The error cases are worth reading. `key_mismatch` means the key the server
 * returned does not match the fingerprint carried in the code — so either the
 * code was altered on its way here or the server is offering a different
 * author. There is no benign reading of that, so it is a hard failure with a
 * plain-language message, never a warning to click through.
 */
export function SubscribeField() {
  const { t } = useTranslation();
  const subscribe = useCommunityStore((s) => s.subscribe);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    if (busy || code.trim() === '') return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await subscribe(code);
      setCode('');
      setStatus(result === 'accepted' ? null : t('community.pending'));
    } catch (e) {
      const key = e instanceof Error ? e.message : 'failed';
      const known = ['invalid_code', 'key_mismatch', 'profile_required'].includes(key);
      setError(t(`community.errors.${known ? key : 'failed'}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-2 space-y-2">
      <label className="block text-[11px] uppercase tracking-wider text-ink-muted">
        {t('community.addByCode')}
      </label>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder={t('community.addByCodePlaceholder') as string}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={32}
          className="flex-1 min-w-0 bg-surface-raised rounded-xl px-3 py-2 font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || code.trim() === ''}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {t('community.addByCodeAction')}
        </button>
      </div>
      {status && <p className="text-xs text-brand-muted">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
