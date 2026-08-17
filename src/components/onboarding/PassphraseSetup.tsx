import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  generatePassphrase,
  setPassphrase,
  validatePassphrase,
} from '@/lib/passphrase';
import { copyText } from '@/lib/nativeBridge';

type View = 'choice' | 'create' | 'recover';

export function PassphraseSetup({ onDone }: { onDone: () => void }) {
  const [view, setView] = useState<View>('choice');

  return (
    <div className="flex flex-col h-full pt-safe pb-safe px-safe bg-navy text-cream">
      <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col">
        {view === 'choice' && <ChoiceView onCreate={() => setView('create')} onRecover={() => setView('recover')} />}
        {view === 'create' && <CreateView onDone={onDone} onBack={() => setView('choice')} />}
        {view === 'recover' && <RecoverView onDone={onDone} onBack={() => setView('choice')} />}
      </div>
    </div>
  );
}

function ChoiceView({ onCreate, onRecover }: { onCreate: () => void; onRecover: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
      <h1 className="text-3xl font-serif text-gold mb-2 text-center">{t('app.title')}</h1>
      <p className="text-cream-dim text-center mb-10">{t('onboarding.welcomeSubtitle')}</p>
      <div className="flex flex-col gap-3">
        <button type="button" className="btn-primary w-full py-3" onClick={onCreate}>
          {t('onboarding.createNew')}
        </button>
        <button type="button" className="btn-ghost w-full py-3" onClick={onRecover}>
          {t('onboarding.haveExisting')}
        </button>
      </div>
    </div>
  );
}

function CreateView({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const mnemonic = useMemo(() => generatePassphrase(), []);
  const words = mnemonic.split(' ');
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    // Only flash "copied" if it actually landed — this is the one string the
    // user cannot recover if it's lost.
    if (!(await copyText(mnemonic))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Await the write before advancing: the user has just been told this phrase
  // is saved, and it's the one value they cannot recover if the app dies here.
  const onContinue = async () => {
    await setPassphrase(mnemonic);
    onDone();
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <button type="button" onClick={onBack} className="text-xs text-cream-dim self-start mb-4 hover:text-cream">
        ← {t('common.back')}
      </button>
      <h2 className="text-xl font-serif text-gold mb-2">{t('onboarding.writeItDown')}</h2>
      <p className="text-sm text-cream-dim mb-5">{t('onboarding.writeItDownHint')}</p>

      <WordGrid words={words} />

      <button type="button" className="btn-ghost mt-4 self-start text-xs" onClick={onCopy}>
        {copied ? '✓ ' + t('settings.copy') : t('settings.copy')}
      </button>

      <label className="flex items-start gap-2 mt-6 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm">{t('onboarding.confirmedWrittenDown')}</span>
      </label>

      <button
        type="button"
        className="btn-primary w-full py-3 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!confirmed}
        onClick={() => void onContinue()}
      >
        {t('onboarding.continue')}
      </button>
    </div>
  );
}

function RecoverView({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const onActivate = async () => {
    if (!validatePassphrase(value)) {
      setError(true);
      return;
    }
    await setPassphrase(value);
    onDone();
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <button type="button" onClick={onBack} className="text-xs text-cream-dim self-start mb-4 hover:text-cream">
        ← {t('common.back')}
      </button>
      <h2 className="text-xl font-serif text-gold mb-2">{t('onboarding.recoverTitle')}</h2>
      <p className="text-sm text-cream-dim mb-5">{t('onboarding.recoverHint')}</p>

      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(false);
        }}
        autoFocus
        rows={4}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-gold/60"
        placeholder="word word word…"
      />

      {error && (
        <p className="text-sm text-rose-400 mt-2">{t('onboarding.invalidPassphrase')}</p>
      )}

      <button
        type="button"
        className="btn-primary w-full py-3 mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={value.trim().length === 0}
        onClick={() => void onActivate()}
      >
        {t('onboarding.activate')}
      </button>
    </div>
  );
}

function WordGrid({ words }: { words: string[] }) {
  return (
    <ol className="grid grid-cols-2 gap-x-3 gap-y-2 bg-navy-soft rounded-xl p-4">
      {words.map((w, i) => (
        <li key={i} className="flex items-baseline gap-2 text-sm font-mono">
          <span className="text-gold-dim text-xs w-6 text-right tabular-nums">{i + 1}.</span>
          <span className="text-cream">{w}</span>
        </li>
      ))}
    </ol>
  );
}
