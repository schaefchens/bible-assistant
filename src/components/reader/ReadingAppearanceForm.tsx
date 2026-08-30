import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { RangeSlider } from '@/components/common/RangeSlider';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { ReadingSurface } from '@/components/reader/ReadingSurface';
import {
  basePaperInk,
  CONTRAST_MAX,
  CONTRAST_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  hueTrackGradient,
  INK_TINT_CHROMA,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MEASURE_MAX,
  MEASURE_MIN,
  PAPER_TINT_CHROMA,
  paperSwatch,
  READING_PAPER_IDS,
  resolveReadingPalette,
  type ReadingFontFamily,
  type ReadingPaperId,
} from '@/lib/readingAppearance';
import { useDocumentThemeMode } from '@/hooks/useDocumentThemeMode';
import { useSettingsStore } from '@/store/settingsStore';
import type { ThemeMode } from '@/lib/theme';

/** Anything below this fails WCAG AA for body text. Shown, never enforced —
 *  a barely-visible page is a thing people ask for, at night, on purpose. */
const AA_RATIO = 4.5;

/**
 * The reading-appearance controls, mounted both in the reader's sheet and in
 * Settings — the same dual-mount arrangement `PlaybackSettingsForm` uses.
 *
 * Every control writes straight to the store rather than to local state, so the
 * page behind the sheet re-paints as the slider moves. The preview above the
 * controls exists because a sheet covers most of the reader; it is a real
 * `ReadingSurface`, not a mock-up, so what it shows is what the page does.
 */
export function ReadingAppearanceForm() {
  const { t } = useTranslation();
  const a = useSettingsStore((s) => s.readingAppearance);
  const set = useSettingsStore((s) => s.setReadingAppearance);
  const reset = useSettingsStore((s) => s.resetReadingAppearance);

  const appMode = useDocumentThemeMode();
  const base = basePaperInk(a, appMode);
  const palette = resolveReadingPalette(a, appMode);
  const belowAa = palette.ratio < AA_RATIO;

  return (
    <div className="space-y-6">
      <Preview />

      <Field label={t('read.appearance.paper')}>
        <div className="flex items-center justify-between gap-2">
          {READING_PAPER_IDS.map((id) => (
            <PaperChip
              key={id}
              id={id}
              appMode={appMode}
              selected={a.paper === id}
              label={t(`read.appearance.papers.${id}`)}
              // Picking a paper drops the tints with it: they are adjustments
              // *to* a preset, and carrying a previous paper's hue onto a new
              // one makes choosing "Sepia" not produce sepia.
              onSelect={() => set({ paper: id, paperHue: null, inkHue: null })}
            />
          ))}
        </div>
      </Field>

      <RangeSlider
        label={t('read.appearance.paperTint')}
        value={a.paperHue ?? base.paper.h}
        min={0}
        max={360}
        step={1}
        onChange={(paperHue) => set({ paperHue })}
        track={hueTrackGradient(base.paper, PAPER_TINT_CHROMA)}
      />

      <RangeSlider
        label={t('read.appearance.inkTint')}
        value={a.inkHue ?? base.ink.h}
        min={0}
        max={360}
        step={1}
        onChange={(inkHue) => set({ inkHue })}
        track={hueTrackGradient(base.ink, INK_TINT_CHROMA)}
      />

      <RangeSlider
        label={t('read.appearance.contrast')}
        value={a.contrast}
        min={CONTRAST_MIN}
        max={CONTRAST_MAX}
        step={0.01}
        onChange={(contrast) => set({ contrast })}
        format={() => (
          <span className={belowAa ? 'text-brand-bright' : undefined}>
            {palette.ratio.toFixed(1)}:1
            {belowAa && ` · ${t('read.appearance.belowAa')}`}
          </span>
        )}
        hint={t('read.appearance.contrastHint')}
      />

      <RangeSlider
        label={t('read.appearance.textSize')}
        value={a.fontSize}
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        step={1}
        onChange={(fontSize) => set({ fontSize })}
        format={(v) => `${v}px`}
      />

      <RangeSlider
        label={t('read.appearance.lineSpacing')}
        value={a.lineHeight}
        min={LINE_HEIGHT_MIN}
        max={LINE_HEIGHT_MAX}
        step={0.02}
        onChange={(lineHeight) => set({ lineHeight })}
        format={(v) => v.toFixed(2)}
      />

      <RangeSlider
        label={t('read.appearance.margins')}
        value={a.measure}
        min={MEASURE_MIN}
        max={MEASURE_MAX}
        step={1}
        onChange={(measure) => set({ measure })}
        format={(v) =>
          v >= MEASURE_MAX
            ? t('read.appearance.marginsFull')
            : t('read.appearance.marginsChars', { n: v })
        }
      />

      <Field label={t('read.appearance.typeface')}>
        <SegmentedControl
          value={a.fontFamily}
          options={[
            { value: 'serif', label: t('read.appearance.serif') },
            { value: 'sans', label: t('read.appearance.sans') },
          ]}
          onChange={(fontFamily) => set({ fontFamily: fontFamily as ReadingFontFamily })}
        />
      </Field>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={a.dualColumn}
          onChange={(e) => set({ dualColumn: e.target.checked })}
        />
        <span className="text-sm">
          {t('read.appearance.dualColumn')}
          <span className="block text-xs text-ink-muted mt-0.5">
            {t('read.appearance.dualColumnHint')}
          </span>
        </span>
      </label>

      <button type="button" onClick={reset} className="btn-ghost w-full">
        {t('read.appearance.reset')}
      </button>
    </div>
  );
}

/** A real reading surface, one verse wide, with the "currently reading" tint on
 *  so the brand colour and the highlight are part of what's being previewed. */
function Preview() {
  const { t } = useTranslation();
  return (
    <ReadingSurface className="rounded-xl border border-brand/25 bg-surface px-4 py-3 overflow-hidden">
      <p className="chapter-heading text-[0.8em] mb-1">
        {t('read.appearance.sampleReference')}
      </p>
      <p className="text-ink/95">
        <span className="verse-inline verse-current">
          <sup className="text-brand-muted text-[0.65em] font-sans mr-0.5 select-none">1</sup>
          {t('read.appearance.sampleText')}
        </span>
      </p>
    </ReadingSurface>
  );
}

function PaperChip({
  id,
  appMode,
  label,
  selected,
  onSelect,
}: {
  id: ReadingPaperId;
  appMode: ThemeMode;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const swatch = paperSwatch(id, appMode);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={label}
      className="flex flex-col items-center gap-1 min-w-0 flex-1"
    >
      <span
        className={clsx(
          'h-9 w-9 rounded-full flex items-center justify-center font-serif text-sm',
          'border transition-all',
          selected ? 'border-brand ring-2 ring-brand/40 scale-105' : 'border-ink/20',
        )}
        style={{ background: swatch.paper, color: swatch.ink }}
      >
        Aa
      </span>
      <span
        className={clsx(
          'text-[10px] truncate max-w-full',
          selected ? 'text-brand' : 'text-ink-muted',
        )}
      >
        {label}
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-muted mb-1.5">{label}</p>
      {children}
    </div>
  );
}
