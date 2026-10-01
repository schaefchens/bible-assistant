import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore, type MicPosition } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useVoiceSelection } from '@/hooks/useSpeechVoice';
import { ROUTES } from '@/lib/appRoutes';
import { SYSTEM_DEVICE_ID, SYSTEM_ECHO_ID, findVoice, type VoiceRole } from '@/services/voices/voiceProfiles';
import { VoiceAvatar } from '@/components/voiceProfiles/VoiceAvatar';
import { LockIcon } from '@/components/common/icons';
import { getPassphrase } from '@/lib/passphrase';
import type { ThemeChoice } from '@/lib/theme';
import { ReadingAppearanceSheet } from '@/components/reader/ReadingAppearanceSheet';
import { PlaybackSettingsSheet } from '@/components/playback/PlaybackSettingsSheet';
import { SettingsGroup, SettingsField } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { TranslationPickerSheet } from '@/components/bible/TranslationPickerSheet';
import { StorageSection } from '@/components/settings/StorageSection';
import { UpdatesSection } from '@/components/settings/UpdatesSection';
import { CommunitySection } from '@/components/settings/CommunitySection';
import { SyncSection } from '@/components/settings/SyncSection';
import { DangerZone } from '@/components/settings/DangerZone';
import { ImprintFooter } from '@/components/settings/ImprintFooter';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import { copyText } from '@/lib/nativeBridge';

type GroupId = 'general' | 'reading' | 'speech' | 'mic' | 'community' | 'account' | 'app';

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const passphrase = getPassphrase() ?? '';
  const words = passphrase.split(' ');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [translationPickerOpen, setTranslationPickerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  // One category at a time, and none to start: collapsed, the whole screen is
  // six choices rather than a wall of controls. Transient on purpose — which
  // group you last had open is not a preference worth persisting.
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const groupProps = (id: GroupId) => ({
    open: openGroup === id,
    onToggle: () => setOpenGroup((cur) => (cur === id ? null : id)),
  });
  const currentTranslation = getTranslationInfo(settings.translation);

  const onCopy = async () => {
    if (!(await copyText(passphrase))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <h2 className="text-xl font-serif text-brand mb-1">{t('settings.title')}</h2>

      <SettingsGroup title={t('settings.groups.general')} {...groupProps('general')}>
        <SettingsField label={t('settings.language')}>
          <SegmentedControl
            value={settings.locale}
            options={[
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
            ]}
            onChange={(v) => settings.setLocale(v as 'en' | 'de')}
          />
        </SettingsField>
        <SettingsField label={t('settings.theme.title')}>
          <SegmentedControl
            cols={3}
            value={settings.theme}
            options={[
              { value: 'system', label: t('settings.theme.system') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
            ]}
            onChange={(v) => settings.setTheme(v as ThemeChoice)}
          />
        </SettingsField>
      </SettingsGroup>

      {/* The three groups that already had a sheet are rows that open it. The
          rest stays on the page: a sheet holding one checkbox is a worse place
          for it than the page is. */}
      <SettingsGroup title={t('settings.groups.reading')} {...groupProps('reading')}>
        <SettingsRow
          label={t('settings.groups.appearanceRow')}
          value={`${t(`read.appearance.papers.${settings.readingAppearance.paper}`)} \u00b7 ${settings.readingAppearance.fontSize}px`}
          onClick={() => setAppearanceOpen(true)}
        />
        <SettingsRow
          label={t('settings.translation')}
          ariaLabel={t('chat.bookPicker.changeTranslation') as string}
          value={
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-mono border border-brand/50 text-brand bg-brand/10">
                {currentTranslation.code}
              </span>
              <span className="truncate">{currentTranslation.name}</span>
            </span>
          }
          onClick={() => setTranslationPickerOpen(true)}
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.groups.speech')} {...groupProps('speech')}>
        <SettingsRow
          label={t('settings.groups.playback')}
          value={
            settings.ambient.enabled
              ? t('settings.groups.musicOn')
              : t('settings.groups.musicOff')
          }
          onClick={() => setPlaybackOpen(true)}
        />
        {/* Which voice reads and which one replies — each a row that opens the
            voices screen (/settings/voices), where voices are made, chosen and
            given their keys. The checkbox stays here: it is how the e2e
            harness quiets replies, by exactly this label. */}
        <VoiceRow role="narration" label={t('narrationVoices.rows.narration')} />
        <VoiceRow role="assistant" label={t('narrationVoices.rows.assistant')} />
        <SettingsField>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.speakAssistant}
              onChange={(e) => settings.setSpeakAssistant(e.target.checked)}
            />
            <span className="text-sm">{t('settings.speakAssistant')}</span>
          </label>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.groups.mic')} {...groupProps('mic')}>
        <SettingsField label={t('voice.mic.position')} hint={t('voice.mic.dragHint')}>
          <MicPositionPicker
            value={settings.micCorner}
            onChange={(v) => settings.setMicCorner(v)}
          />
        </SettingsField>
        <SettingsField>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.useWhisperFallback}
              onChange={(e) => settings.setUseWhisperFallback(e.target.checked)}
            />
            <span className="text-sm">{t('settings.whisperFallback')}</span>
          </label>
          <label className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={settings.micSoundEnabled}
              onChange={(e) => settings.setMicSoundEnabled(e.target.checked)}
            />
            <span className="text-sm">{t('settings.micSound')}</span>
          </label>
          <label className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={settings.thinkingSoundEnabled}
              onChange={(e) => settings.setThinkingSoundEnabled(e.target.checked)}
            />
            <span className="text-sm">{t('settings.thinkingSound')}</span>
          </label>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.groups.community')} {...groupProps('community')}>
        <SettingsField label={t('community.profile.title')}>
          <CommunitySection />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.groups.account')} {...groupProps('account')}>
        {/* The keys live with the voices they pay for, but the OpenAI one also
            pays for chat and transcription — so it is findable from here too. */}
        <SettingsRow
          label={t('narrationVoices.rows.keys')}
          onClick={() => navigate(`${ROUTES.voices}?focus=providers`)}
        />
        <SettingsField label={t('settings.sync.title')}>
          <SyncSection />
        </SettingsField>
        <SettingsField label={t('settings.identity')} hint={t('settings.identityHint')}>
          {!revealed ? (
            <button className="btn-ghost text-xs" onClick={() => setRevealed(true)}>
              {t('settings.reveal')}
            </button>
          ) : (
            <>
              <ol className="grid grid-cols-2 gap-x-3 gap-y-2 bg-surface-raised rounded-xl p-4">
                {words.map((w, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-sm font-mono">
                    <span className="text-brand-muted text-xs w-6 text-right tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="text-ink">{w}</span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2 mt-3">
                <button className="btn-ghost text-xs" onClick={onCopy}>
                  {copied ? '\u2713 ' + t('settings.copy') : t('settings.copy')}
                </button>
                <button className="btn-ghost text-xs" onClick={() => setRevealed(false)}>
                  {t('settings.hide')}
                </button>
              </div>
            </>
          )}
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.groups.app')} {...groupProps('app')}>
        <SettingsField label={t('settings.storage.title')}>
          <StorageSection />
        </SettingsField>
        <SettingsField label={t('settings.updates.title')}>
          <UpdatesSection />
        </SettingsField>
        {/* Beside the build stamp on purpose: both answer "what are you
            running, and how do you tell me about it". */}
        <SettingsField label={t('settings.feedback.title')} hint={t('settings.feedback.hint')}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.feedbackEnabled}
              onChange={(e) => settings.setFeedbackEnabled(e.target.checked)}
            />
            <span className="text-sm">{t('settings.feedback.show')}</span>
          </label>
        </SettingsField>
        <SettingsField label={t('settings.dangerZone.title')}>
          <DangerZone />
        </SettingsField>
      </SettingsGroup>

      <ImprintFooter />

      <TranslationPickerSheet
        open={translationPickerOpen}
        value={settings.translation}
        onChange={(code) => settings.setTranslation(code, true)}
        onClose={() => setTranslationPickerOpen(false)}
      />
      <ReadingAppearanceSheet
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
      />
      <PlaybackSettingsSheet open={playbackOpen} onClose={() => setPlaybackOpen(false)} />
    </div>
  );
}

/** A Settings row naming the voice a role speaks in, with its face, opening
 * the voices screen for that role. A lock says the chosen voice is waiting on
 * a key (it reads in its fallback meanwhile — the screen says which). */
function VoiceRow({ role, label }: { role: VoiceRole; label: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const voices = useLibraryStore((s) => s.voices);
  const { id, availability } = useVoiceSelection(role);
  const profile = findVoice(id, voices);
  const name =
    id === SYSTEM_DEVICE_ID
      ? t('narrationVoices.system.device')
      : id === SYSTEM_ECHO_ID || !profile
        ? t('narrationVoices.system.echo')
        : profile.name;
  return (
    <SettingsRow
      label={label}
      onClick={() => navigate(role === 'assistant' ? `${ROUTES.voices}?for=assistant` : ROUTES.voices)}
      value={
        <span className="inline-flex items-center gap-2 min-w-0 justify-end">
          {availability !== 'ok' && <LockIcon className="shrink-0 text-amber-400" />}
          <span className="truncate">{name}</span>
          <VoiceAvatar
            name={name}
            avatar={profile?.avatar}
            system={id === SYSTEM_DEVICE_ID ? 'device' : id === SYSTEM_ECHO_ID || !profile ? 'echo' : undefined}
            size={26}
          />
        </span>
      }
    />
  );
}

/** Four floating corners, plus the docked bar — which spans both columns,
 * because that is the shape of the thing it selects. */
function MicPositionPicker({
  value,
  onChange,
}: {
  value: MicPosition;
  onChange: (v: MicPosition) => void;
}) {
  const { t } = useTranslation();
  const positions: { value: MicPosition; label: string; wide?: boolean }[] = [
    { value: 'tl', label: t('voice.mic.tl') },
    { value: 'tr', label: t('voice.mic.tr') },
    { value: 'bl', label: t('voice.mic.bl') },
    { value: 'br', label: t('voice.mic.br') },
    { value: 'bar', label: t('voice.mic.bar'), wide: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {positions.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={
            'py-3 text-sm rounded-xl border transition-colors ' +
            (p.wide ? 'col-span-2 ' : '') +
            (value === p.value
              ? 'bg-brand/15 text-brand border-brand/60'
              : 'bg-surface-raised text-ink-muted border-surface-raised hover:text-ink')
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

