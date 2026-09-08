import { useEffect, type RefObject } from 'react';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';

export function useAutoScrollActiveVerse(
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const groupId = usePlaybackStore((s) => s.current?.groupId ?? null);
  const verseIndex = usePlaybackStore((s) => s.current?.verseIndex ?? -1);
  const enabled = useSettingsStore((s) => s.autoScrollReader);

  useEffect(() => {
    if (!enabled) return;
    if (!groupId || verseIndex < 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(
      `[data-verse-key="${CSS.escape(groupId)}:${verseIndex}"]`,
    );
    if (el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [groupId, verseIndex, enabled, scrollRef]);
}
