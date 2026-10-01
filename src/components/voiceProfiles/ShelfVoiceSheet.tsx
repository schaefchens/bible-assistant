import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import {
  DEFAULT_VOICE_SHARING,
  needsMonthlyPool,
  type VoiceSharing,
} from '@/services/voices/voiceSharing';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { Space } from '@/types/domain';
import { VoiceAvatar } from './VoiceAvatar';
import { VoiceSharingForm } from './VoiceSharingForm';
import { voiceSubtitle } from './voiceLabels';

/**
 * Lend a voice to *this* shelf, or change the terms of one already lent here —
 * the shelf screen's way in, where `ShareVoiceSheet` is the voice editor's.
 *
 * With `itemId` it edits that item's terms; without, it first asks which of
 * the user's voices (those not lent here yet), then the terms.
 */
export function ShelfVoiceSheet({
  space,
  itemId,
  open,
  onClose,
}: {
  space: Space;
  itemId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const voices = useLibraryStore((s) => s.voices);
  const items = useCommunityStore((s) => s.items);
  const sharedClaims = useCommunityStore((s) => s.sharedClaims);
  const itemSources = useCommunityStore((s) => s.itemSources);
  const voiceTerms = useCommunityStore((s) => s.voiceTerms);
  const shareVoice = useCommunityStore((s) => s.shareVoice);

  /** The voices already lent to this shelf, by source voice id. */
  const lentHere = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.spaceId !== space.id || item.kind !== 'voice' || sharedClaims[item.id] !== true) continue;
      const src = itemSources[item.id];
      if (src) ids.add(src.sourceId);
    }
    return ids;
  }, [items, sharedClaims, itemSources, space.id]);

  const editing = itemId ? itemSources[itemId]?.sourceId : undefined;
  const [picked, setPicked] = useState<string | null>(editing ?? null);
  const [sharing, setSharing] = useState<VoiceSharing>(
    () => (itemId ? voiceTerms[itemId] : undefined) ?? DEFAULT_VOICE_SHARING,
  );
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const voice = picked ? voices.find((v) => v.id === picked) : undefined;
  const requirePool = space.approval === 'auto';
  const blocked = needsMonthlyPool(space.approval, sharing);

  const lend = async () => {
    if (!voice) return;
    setBusy(true);
    setRefused(null);
    try {
      await shareVoice(voice.id, space.id, sharing);
      onClose();
    } catch (e) {
      setRefused(
        e instanceof Error && e.message === 'content_refused'
          ? ((e as Error & { reason?: string }).reason?.trim() ||
            (t('community.moderation.refusedGeneric') as string))
          : (t('community.shareFailed') as string),
      );
    } finally {
      setBusy(false);
    }
  };

  const offer = voices.filter((v) => !lentHere.has(v.id));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      onBack={!itemId && picked ? () => setPicked(null) : undefined}
      title={(itemId ? t('voiceSharing.termsTitle') : t('voiceSharing.lendTitle')) as string}
    >
      <BottomSheetBody>
        {!itemId && !voice ? (
          <div className="space-y-3 pb-4">
            <p className="text-xs text-ink-muted leading-relaxed">{t('voiceSharing.intro')}</p>
            {offer.length === 0 ? (
              <p className="text-sm text-ink-muted py-2">
                {voices.length === 0 ? t('voiceSharing.noVoices') : t('voiceSharing.allLent')}
              </p>
            ) : (
              <ul className="space-y-2">
                {offer.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(v.id)}
                      className="w-full flex items-center gap-3 rounded-xl bg-surface-raised px-3 py-2 text-left"
                    >
                      <VoiceAvatar name={v.name} avatar={v.avatar} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-ink truncate">{v.name}</span>
                        <span className="block text-[11px] text-ink-muted truncate">
                          {voiceSubtitle(v.config, v.sourceName, t)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : !voice ? (
          // The item's source voice is not on this device — another device
          // shared it, or it has been deleted since. Its terms cannot be
          // re-published without it; taking it off the shelf still works.
          <p className="text-sm text-ink-muted py-2 pb-4">{t('voiceSharing.sourceMissing')}</p>
        ) : (
          <div className="space-y-5 pb-4">
            <div className="flex items-center gap-3">
              <VoiceAvatar name={voice.name} avatar={voice.avatar} size={44} />
              <span className="min-w-0">
                <span className="block font-serif text-lg text-ink truncate">{voice.name}</span>
                <span className="block text-[11px] text-ink-muted truncate">
                  {voiceSubtitle(voice.config, voice.sourceName, t)}
                </span>
              </span>
            </div>
            <VoiceSharingForm value={sharing} onChange={setSharing} requirePool={requirePool} />
            {refused && (
              <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">{refused}</p>
            )}
            <button
              type="button"
              disabled={busy || blocked}
              onClick={() => void lend()}
              className="btn-primary w-full disabled:opacity-50"
            >
              {itemId ? t('voiceSharing.saveTerms') : t('voiceSharing.lendHere')}
            </button>
            <p className="text-[11px] text-ink-muted leading-relaxed">{t('voiceSharing.footnote')}</p>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
