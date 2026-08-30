import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/common/BottomSheet';
import { TranslationList } from './TranslationList';
import type { Translation } from '@/services/bible/bibleApi';

type Props = {
  open: boolean;
  value: Translation;
  onChange: (code: Translation) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet wrapper around <TranslationList />. Mirrors the chat book
 * picker's "translations" sub-view chrome so the Settings translation
 * picker presents the same way users already learnt there. Auto-closes
 * after a selection via the same onChange handler.
 *
 * No BottomSheetBody: TranslationList is its own scroll container.
 */
export function TranslationPickerSheet({ open, value, onChange, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('chat.bookPicker.translations')}
    >
      <TranslationList
        value={value}
        onChange={(code) => {
          onChange(code);
          onClose();
        }}
        className="flex-1 min-h-0 overflow-y-auto pb-safe"
      />
    </BottomSheet>
  );
}
