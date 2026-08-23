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
      className="w-full px-4 py-2 text-sm bg-brand/15 text-brand hover:bg-brand/25 transition-colors border-b border-brand/30 flex items-center justify-center gap-2"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-brand animate-pulse" />
      {t('updates.bannerAvailable')}
    </button>
  );
}
