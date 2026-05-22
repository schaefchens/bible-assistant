import { useTranslation } from 'react-i18next';
import { useUpdateStore, applyUpdate } from '@/lib/pwaUpdate';

export function UpdateBanner() {
  const { t } = useTranslation();
  const needRefresh = useUpdateStore((s) => s.needRefresh);

  if (!needRefresh) return null;

  return (
    <button
      type="button"
      onClick={() => void applyUpdate()}
      className="w-full px-4 py-2 text-sm bg-gold/15 text-gold hover:bg-gold/25 transition-colors border-b border-gold/30 flex items-center justify-center gap-2"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-gold animate-pulse" />
      {t('updates.bannerAvailable')}
    </button>
  );
}
