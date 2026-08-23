import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/lib/nativeBridge';

/**
 * The 12-word recovery phrase, with a copy button.
 *
 * Shown only where the phrase actually matters — the sync opt-in and Settings.
 * It is minted silently on first run (see lib/bootIdentity), because until the
 * user asks for a server backup there is nothing for it to recover.
 */
export function PassphraseWords({ mnemonic }: { mnemonic: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(' ');

  const onCopy = async () => {
    // Only flash "copied" if it actually landed — this is the one string the
    // user cannot recover if it's lost.
    if (!(await copyText(mnemonic))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <ol className="grid grid-cols-2 gap-x-3 gap-y-2 bg-surface-raised rounded-xl p-4">
        {words.map((w, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm font-mono">
            <span className="text-brand-muted text-xs w-6 text-right tabular-nums">{i + 1}.</span>
            <span className="text-ink">{w}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn-ghost mt-3 self-start text-xs" onClick={() => void onCopy()}>
        {copied ? '✓ ' + t('settings.copy') : t('settings.copy')}
      </button>
    </>
  );
}
