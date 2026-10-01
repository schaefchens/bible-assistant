# Theming

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

Colour tokens are named by **role, not hue** — `surface` / `surface-raised` /
`surface-sunken`, `ink` / `ink-muted`, `brand` / `brand-muted` / `brand-bright`. The
old `navy` / `cream` / `gold` names stopped being true the moment a light theme
existed. Two extra roles exist because one name was doing two jobs:

| token | meaning |
| --- | --- |
| `on-brand` | foreground on a **brand** fill — inverts with the theme (dark text on light gold, light text on dark brown) |
| `on-fill` | foreground on a **pastel ribbon or card** fill — fixed dark in every theme, because those fills are light in every theme |

`ribbon-*` and `card-*` are user-chosen *content* colours and deliberately do not
follow the theme. The two exceptions are `card-none-*`, which is chrome.

Three constraints, each of which breaks something quietly if ignored:

- **Values are space-separated RGB channels, not hex.** Tailwind alpha modifiers
  compile to `rgb(var(--token) / .4)`, and this codebase has ~173 of them. A hex
  makes every one of them invalid.
- **Palettes are declared on `[data-theme]`, not just `:root`.** An attribute
  selector applies at any depth, which is what lets a subtree (a sepia reader)
  carry its own palette without touching `lib/theme.ts`.
- **Colour lives in `src/index.css`, not in TS.** `lib/theme.ts` decides *which*
  palette is active and syncs what CSS can't reach (the `theme-color` meta tag,
  `SystemBars.setStyle()`). It reads values back out of the cascade rather than
  keeping a copy. `setPaletteVars()` is the seam for palettes that can't exist at
  build time — a user contrast preset — and `THEME_TOKENS` is their contract.

The light palette is **not** an inversion of the dark one: the dark theme's gold is
2.1:1 on paper, a hard fail, so `brand` carries its own values chosen to mirror the
dark theme's contrast ratios. Check a ratio before changing any of them.

`--verse-tint-alpha` is the "currently reading" highlight's opacity, a number
rather than a colour so the tint follows `brand` automatically and a contrast
control has one knob. The inline (reader) variant adds 0.02, since with no inset
bar the tint is the only cue.

**Native chrome.** Android resources split into `values/` (light) and
`values-night/` (dark), so system-bar *backgrounds* follow the device.
`SystemBars.setStyle()` sets bar *icon* contrast at runtime — it has no background
counterpart, so an in-app override that disagrees with the device (light theme on
a dark phone) leaves the bars dark. Closing that needs a small native shim.

Existing installs migrate to an explicit `'dark'`, not `'system'`: the app was
dark-only before this, so following the OS would restyle people who never asked.

## Reading appearance — the user's own paper and ink

`settings.readingAppearance` (`lib/readingAppearance.ts`, edited through the
reader's `Aa` sheet and a mirrored section in `/settings`) governs **the Bible
text only**: the reader column and chat verse panels. App chrome — headers,
footers, nav, and the sheet itself — deliberately stays on the app theme, because
the contrast control can be taken to zero on purpose and the button that undoes
that has to remain visible. `BottomSheet` portals to `document.body`, so the sheet
is outside the surface's subtree for free.

Colour is **derived, not stored**, and it derives from **one colour per chip**.
A chip supplies the *lightness pair* — which end is paper, which is ink, how far
apart — and the colour picked for it supplies hue and saturation. One brown gives
a cream page with brown-black text on the light chips and a dark-brown page with
cream text on the dark ones, so a chip keeps its character and the colour is what
changes. Per chip rather than shared, so recolouring Night can't turn Sepia blue.
The contrast slider then slides the ink toward the paper and past it —
`ink' = paper + (ink - paper) * k`, `k = 1` being the chip untouched. OKLCH and
not sRGB because "distance" has to mean *perceptual* distance.

**Saturation is always a fraction of the gamut, never an absolute chroma.** sRGB
holds about four times more chroma at the ink's L 0.26 than at a near-white
paper's L 0.97 (`maxChromaFor()` measures it), so any single absolute value is
invisible at one end or clipped at the other. A pick therefore carries its
saturation *relative to its own lightness* — `main.c / maxChromaFor(main.l,
main.h)` — and spends that same share of the very different room each end has.
The swatch grid's three rows are fractions for the same reason: as absolutes they
clamped together, and all three produced an identical page on four chips out of
five. This one mistake has now been made three times in this feature (the ink
tint floor, the swatch levels, and the first hue sliders); absolute chroma is the
trap.

**The paper is pinned.** An earlier version moved both around their midpoint,
which made every contrast change a change of page brightness too — a lot to
happen under one control, and on a tinted preset it went muddy on the way down
(a fixed chroma reads as far more saturated at mid lightness than at the ends,
so softening sepia turned the page olive). Now the paper is whatever the preset
says at every setting, and the slider only decides how strongly the text is
printed on it. Chroma and hue converge along with the lightness, so `k = 0`
lands the ink *exactly* on the paper rather than merely at its luminance —
without that the text survives its own contrast as a colour. Both are capped at
`min(k, 1)` so pushing past the preset drives lightness apart without
over-saturating.

`k` scales the **brand** distance too: left at full strength, collapsing the
contrast left a page whose verses had vanished while its chapter heading and drop
cap still shouted.

`setPaletteVars()` was left in `lib/theme.ts` for exactly this and is now its only
caller. Three things about the derivation are load-bearing:

- **Only nine tokens are written.** The surface carries a `[data-theme]` chosen by
  the resolved paper's *lightness*, which brings in the rest from `index.css` —
  `--verse-tint-alpha` above all, so the reading tint follows the paper rather
  than the app. A bright paper under the dark app theme still highlights legibly.
- **The gold is read back out of the cascade**, from a *detached probe* element,
  and only its lightness is re-placed relative to the paper. `index.css` stays the
  one place a colour is written down, and the heading stays legible on a paper its
  author never saw. The probe is why: the derived tokens are inline styles on the
  same element that carries `data-theme`, so reading the base back off it would
  chase its own tail.
- **The app's mode is an argument, not a DOM read** (`useDocumentThemeMode()`).
  `lib/theme.ts` writes `<html data-theme>` from an effect, so sampling it during
  render is one tick stale on every theme switch and never notices the OS flipping
  appearance at all.

The default (`paper: 'theme'`, contrast 1, no tints) emits **no** colour vars and
no `data-theme` — `isDefaultPalette()` short-circuits — so an install that never
opens the sheet renders exactly as it did before the feature existed.

Type is three custom properties (`--reading-font-size`, `--reading-line-height`,
`--reading-measure`) on `.reading-surface`, whose fallbacks are today's values;
`SegmentBlock` and `WordHighlighter` therefore carry **no** size, leading or family
of their own, and headings use `em` so they track the body instead of shrinking
away from it. The measure is in `ch` so it stays constant in *characters* as the
size changes. Everything is written imperatively through a ref, never as a `style`
prop, so dragging a slider repaints without re-rendering the verse tree.

**Two columns are gated in CSS** (`@media (min-width: 768px)`), not on the setting:
a phone in portrait has no room for them, and someone who turned it on for their
tablet must not get 20-character columns on their phone. The setting is a
preference; the media query is the constraint.
