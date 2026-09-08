import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { PlaybackSettingsForm } from './PlaybackSettingsForm';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function PlaybackSettingsSheet({ open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('playbackSheet.title')}>
      <BottomSheetBody>
        <PlaybackSettingsForm />
      </BottomSheetBody>
    </BottomSheet>
  );
}
