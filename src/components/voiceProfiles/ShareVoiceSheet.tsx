import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { ROUTES } from '@/lib/appRoutes';
import { useLocale } from '@/hooks/useLocale';
import { spaceDisplayName } from '@/services/community/spaceName';
import {
  DEFAULT_VOICE_SHARING,
  needsMonthlyPool,
  type VoiceSharing,
} from '@/services/voices/voiceSharing';
import { useCommunityStore } from '@/store/communityStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { VoiceSharingForm } from './VoiceSharingForm';
import { allowanceLabel, scopeLabel } from './voiceSharingLabels';

/**
 * Lend one of the user's voices to their shelves — the voice editor's way in.
 *
 * The terms come first, because they are the decision: what the voice may
 * read for the shelf's readers, and how much of the user's key they may spend.
 * Then every shelf, with what is true of it — lent here, on which terms, or
 * not — and the one action that changes that. "Update" re-publishes with the
 * terms above, and with the voice as it is now.
 *
 * A Today shelf is not offered: its items expire after a day, and a voice that
 * vanished from readers overnight would look like a fault.
 */
export function ShareVoiceSheet({
  voiceId,
  open,
  onClose,
}: {
  voiceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const profile = useCommunityStore((s) => s.profile);
  const spaces = useCommunityStore((s) => s.spaces);
  const items = useCommunityStore((s) => s.items);
  const sharedClaims = useCommunityStore((s) => s.sharedClaims);
  const itemSources = useCommunityStore((s) => s.itemSources);
  const voiceTerms = useCommunityStore((s) => s.voiceTerms);
  const shareVoice = useCommunityStore((s) => s.shareVoice);
  const deleteItem = useCommunityStore((s) => s.deleteItem);
  const voice = useLibraryStore((s) => s.voices.find((v) => v.id === voiceId));
  const keyMissing = useSettingsStore((s) =>
    voice?.config.provider === 'elevenlabs' ? !s.hasUserElevenLabsKey : !s.hasUserOpenAiKey,
  );

  /** Where this voice is lent, by shelf. */
  const placed = useMemo(() => {
    const by = new Map<string, { itemId: string; stale: boolean; terms?: VoiceSharing }>();
    for (const item of items) {
      if (item.kind !== 'voice' || sharedClaims[item.id] !== true) continue;
      const src = itemSources[item.id];
      if (!src || src.sourceId !== voiceId) continue;
      by.set(item.spaceId, {
        itemId: item.id,
        stale: !!voice && src.sourceUpdatedAt !== voice.updatedAt,
        terms: voiceTerms[item.id],
      });
    }
    return by;
  }, [items, sharedClaims, itemSources, voiceTerms, voiceId, voice]);

  // Starts from the terms it is already lent on, if any — a second shelf is
  // usually meant to be like the first.
  const [sharing, setSharing] = useState<VoiceSharing>(
    () => [...placed.values()].find((p) => p.terms)?.terms ?? DEFAULT_VOICE_SHARING,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const shelves = spaces.filter((s) => s.kind !== 'today');

  const run = async (spaceId: string, fn: () => Promise<void>) => {
    setBusy(spaceId);
    setRefused(null);
    try {
      await fn();
    } catch (e) {
      // The only failure worth showing, as ShareToRoomSheet says: the
      // moderator said no, and the owner needs to know why at the tap.
      setRefused(
        e instanceof Error && e.message === 'content_refused'
          ? ((e as Error & { reason?: string }).reason?.trim() ||
            (t('community.moderation.refusedGeneric') as string))
          : (t('community.shareFailed') as string),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('voiceSharing.sheetTitle', { name: voice?.name ?? '' }) as string}>
      <BottomSheetBody>
        {!profile ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-ink-muted">{t('voiceSharing.needsCommunity')}</p>
            <button type="button" className="btn-primary text-sm" onClick={() => navigate(ROUTES.spaces)}>
              {t('voiceSharing.openShelves')}
            </button>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            <p className="text-xs text-ink-muted leading-relaxed">{t('voiceSharing.intro')}</p>
            {keyMissing && (
              <button
                type="button"
                onClick={() => navigate(`${ROUTES.voices}?focus=providers`)}
                className="w-full rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-xs text-ink"
              >
                {voice?.config.provider === 'elevenlabs'
                  ? t('voiceSharing.needsElevenLabsKey')
                  : t('voiceSharing.needsOpenAiKey')}
              </button>
            )}

            <VoiceSharingForm value={sharing} onChange={setSharing} />

            <section className="space-y-2">
              <h3 className="text-[11px] uppercase tracking-wider text-ink-muted">{t('voiceSharing.shelves')}</h3>
              {shelves.length === 0 && <p className="text-sm text-ink-muted">{t('voiceSharing.noShelves')}</p>}
              <ul className="space-y-2">
                {shelves.map((space) => {
                  const here = placed.get(space.id);
                  const working = busy === space.id;
                  // This shelf lets anyone in: the terms above need a pool here.
                  const blocked = needsMonthlyPool(space.approval, sharing);
                  return (
                    <li key={space.id} className="rounded-xl bg-surface-raised px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink truncate">
                            {space.emoji ? `${space.emoji} ` : ''}
                            {spaceDisplayName(space)}
                          </span>
                          <span className="block text-[11px] text-ink-muted truncate">
                            {here
                              ? here.terms
                                ? `${t('voiceSharing.lentHere')} · ${scopeLabel(here.terms.scope, t)} · ${allowanceLabel(here.terms, locale, t)}`
                                : t('voiceSharing.lentHere')
                              : t('voiceSharing.notLentHere')}
                          </span>
                        </span>
                        {here ? (
                          <>
                            <button
                              type="button"
                              disabled={working || blocked}
                              onClick={() => void run(space.id, () => shareVoice(voiceId, space.id, sharing))}
                              className="px-2.5 py-1 rounded-lg text-xs bg-surface text-brand disabled:opacity-50 shrink-0"
                            >
                              {t('voiceSharing.update')}
                            </button>
                            <button
                              type="button"
                              disabled={working}
                              onClick={() => void run(space.id, () => deleteItem(here.itemId))}
                              className="px-2.5 py-1 rounded-lg text-xs bg-surface text-ink-muted shrink-0"
                            >
                              {t('community.removeFromShelf')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={working || blocked}
                            onClick={() => void run(space.id, () => shareVoice(voiceId, space.id, sharing))}
                            className="px-2.5 py-1 rounded-lg text-xs bg-brand text-on-brand disabled:opacity-50 shrink-0"
                          >
                            {t('voiceSharing.lendHere')}
                          </button>
                        )}
                      </div>
                      {here?.stale && <p className="text-[11px] text-ink-muted">{t('voiceSharing.stale')}</p>}
                      {blocked && <p className="text-[11px] text-amber-400">{t('voiceSharing.form.poolRequired')}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>

            {refused && (
              <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">{refused}</p>
            )}
            <p className="text-[11px] text-ink-muted leading-relaxed">{t('voiceSharing.footnote')}</p>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
