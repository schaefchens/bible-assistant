import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { factoryReset } from '@/lib/factoryReset';

/** Settings tile for the destructive "wipe everything" action. Requires a
 * second tap to confirm (the confirm state auto-resets after 4s). */
export function DangerZone() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const onClick = () => {
    if (wiping) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setWiping(true);
    void factoryReset();
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-cream-dim">{t('settings.dangerZone.hint')}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={wiping}
        className="text-sm text-red-400 hover:bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 transition-colors disabled:opacity-60"
      >
        {wiping
          ? t('settings.dangerZone.wiping')
          : confirming
            ? t('settings.dangerZone.confirm')
            : t('settings.dangerZone.wipe')}
      </button>
    </div>
  );
}
