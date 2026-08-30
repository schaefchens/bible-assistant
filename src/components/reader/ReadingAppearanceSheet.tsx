import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { ReadingAppearanceForm } from '@/components/reader/ReadingAppearanceForm';

type Props = { open: boolean; onClose: () => void };

/**
 * The reader's "how should this look" sheet.
 *
 * It renders through `BottomSheet`'s portal, i.e. outside the reading surface's
 * `[data-theme]` subtree — so it always paints in the app palette, and stays
 * legible even when the contrast slider has been taken to zero.
 */
export function ReadingAppearanceSheet({ open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('read.appearance.title')}>
      <BottomSheetBody>
        <ReadingAppearanceForm />
      </BottomSheetBody>
    </BottomSheet>
  );
}
