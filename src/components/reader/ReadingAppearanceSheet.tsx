import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import {
  ReadingAppearanceForm,
  ReadingAppearancePreview,
} from '@/components/reader/ReadingAppearanceForm';

type Props = { open: boolean; onClose: () => void };

/**
 * The reader's "how should this look" sheet.
 *
 * It renders through `BottomSheet`'s portal, i.e. outside the reading surface's
 * `[data-theme]` subtree — so it always paints in the app palette, and stays
 * legible even when the contrast slider has been taken to zero.
 *
 * The preview is pinned; only the controls scroll.
 */
export function ReadingAppearanceSheet({ open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('read.appearance.title')}>
      {/* Pinned above the scroll, not inside it. The sheet covers most of the
          reader, so the preview is the only view of what a control does — and a
          preview that scrolls away is worse than none, because the sliders it
          explains are exactly the ones far enough down to push it off screen.
          BottomSheet puts children straight into its flex column for this. */}
      <div className="shrink-0 px-5 pb-4 border-b border-brand/15">
        <ReadingAppearancePreview />
      </div>
      <BottomSheetBody>
        <ReadingAppearanceForm />
      </BottomSheetBody>
    </BottomSheet>
  );
}
