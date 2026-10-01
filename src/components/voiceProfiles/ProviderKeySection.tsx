import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { KeyIcon } from '@/components/common/icons';
import { extractErrorDetail } from '@/lib/extractErrorDetail';

/**
 * One provider's API key: enter and validate it, see the masked form of the one
 * on file, remove it. OpenAI's and ElevenLabs' cards are this component twice
 * — two hand-written copies of a key form is how one of them grows a fix the
 * other never gets.
 *
 * The key itself never comes back: the server validates it, stores it, and
 * answers with a mask. `children` is the provider's own status underneath
 * (credits left, a session fallback).
 */
export function ProviderKeySection({
  title,
  hint,
  placeholder,
  hasKey,
  masked,
  onSave,
  onClear,
  invalidMessage,
  children,
}: {
  title: string;
  hint: React.ReactNode;
  placeholder: string;
  hasKey: boolean;
  masked: string | null;
  /** Validate + store; throws with the server's reason on refusal. */
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
  invalidMessage: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(key);
      setDraft('');
    } catch (e) {
      setError(extractErrorDetail(e) ?? invalidMessage);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      window.setTimeout(() => setConfirmingRemove(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onClear();
    } catch (e) {
      setError(extractErrorDetail(e) ?? 'failed');
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  };

  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-surface-raised/70 bg-surface-raised/30 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 rounded-full bg-brand/15 text-brand flex items-center justify-center shrink-0">
          <KeyIcon />
        </span>
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-ink truncate">{title}</h3>
        <span
          className={clsx(
            'shrink-0 px-2 py-0.5 rounded-full text-[11px]',
            hasKey ? 'bg-brand/15 text-brand' : 'bg-surface-raised text-ink-muted',
          )}
        >
          {hasKey ? t('narrationVoices.keys.connected') : t('narrationVoices.keys.notConnected')}
        </span>
      </div>
      <div className="text-xs text-ink-muted leading-relaxed">{hint}</div>
      {hasKey ? (
        <div className="flex items-center justify-between gap-2 bg-surface rounded-xl px-3 py-2">
          <span className="font-mono text-sm text-ink truncate">{masked ?? '••••••'}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className={clsx(
              'text-xs px-2.5 py-1 rounded-lg shrink-0',
              confirmingRemove ? 'text-red-400 border border-red-500/40' : 'btn-ghost',
            )}
          >
            {confirmingRemove ? t('narrationVoices.keys.confirmRemove') : t('narrationVoices.keys.remove')}
          </button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={title}
            className="flex-1 min-w-0 bg-surface text-ink rounded-xl px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="btn-primary text-xs px-3 disabled:opacity-50"
          >
            {busy ? t('narrationVoices.keys.checking') : t('narrationVoices.keys.save')}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {children}
    </section>
  );
}
