import type { TFunction } from 'i18next';
import {
  CHARS_PER_CHAPTER,
  type VoiceShareScope,
  type VoiceSharing,
} from '@/services/voices/voiceSharing';

/**
 * How a shared voice's terms are said: what it may read, and how much may be
 * spent. Takes `t` from the calling component, like voiceLabels.ts, and is a
 * `.ts` file for the same reason — a `.tsx` exports components only.
 */

/** What it may read, in a few words — `whose` names the author for a reader
 * ("…and Olivia's pieces"); the owner's own screens leave it out. */
export function scopeLabel(scope: VoiceShareScope, t: TFunction, whose?: string): string {
  switch (scope) {
    case 'scripture':
      return t('voiceSharing.scope.scripture');
    case 'pieces':
      return whose ? t('voiceSharing.scope.piecesOf', { author: whose }) : t('voiceSharing.scope.pieces');
    case 'anything':
      return t('voiceSharing.scope.anything');
  }
}

/** "50,000 a month · 7,000 a day each", "7,000 a day each", or "no limit". */
export function allowanceLabel(sharing: VoiceSharing, locale: string, t: TFunction): string {
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const parts: string[] = [];
  if (sharing.monthly !== undefined) parts.push(t('voiceSharing.allowance.monthly', { chars: n(sharing.monthly) }));
  if (sharing.dailyPerReader !== undefined) {
    parts.push(t('voiceSharing.allowance.daily', { chars: n(sharing.dailyPerReader) }));
  }
  return parts.length > 0 ? parts.join(' · ') : t('voiceSharing.allowance.none');
}

/** "about 14 chapters" — characters are not a unit anyone thinks in. */
export function chaptersHint(chars: number, t: TFunction): string {
  return t('voiceSharing.aboutChapters', { count: Math.max(1, Math.round(chars / CHARS_PER_CHAPTER)) });
}
