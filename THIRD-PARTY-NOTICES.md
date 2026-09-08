# Third-party notices

`LICENSE.md` (PolyForm Noncommercial 1.0.0) covers the Bible Assistant **source
code** and nothing else. This file lists what the app uses that belongs to
someone else, and on what terms.

Nothing here is legal advice, and nothing here grants you any rights in the
material listed. If you fork this project, the obligations below are yours to
satisfy for yourself — a licence to the code is not a licence to the content it
reads.

---

## Bible translations

The app reads eight translations from Zefania-style XML in `public/bibles/`.
They fall into two very different groups.

### Public domain, or distributed as freely usable

| file | translation | status |
| --- | --- | --- |
| `kjv.xml` | King James Version (1611) | Public domain in the United States. In the United Kingdom it remains under perpetual Crown copyright, exercised through the Cambridge University Press and Oxford University Press letters patent — in practice unenforced outside the UK. |
| `lut.xml` | Luther 1912 | The file's own `<rights>` element states "This Text is in the Public Domain". Publisher metadata: `www.toledot.info`. This is Luther **1912**, not the copyrighted Luther 1984/2017. |
| `elb.xml` | Elberfelder 1905, with Strong's numbers (`ELB1905STR`) | Published 1905; the translation itself is out of copyright. |
| `s51.xml` | Schlachter 1951, with Strong's numbers (`SCH1951`) | Distributed by the "Free Bible Software Group" and widely redistributed as freely usable. Less clear-cut than the pre-1900 texts above: the 1951 revision is more recent than the 1911 original, so the revisers' contribution may still attract rights. Not the copyrighted Schlachter 2000. |

### Still in copyright — not in this repository

**These four are not committed.** They are listed in `.gitignore` and ship only
via `scripts/deploy.sh --with-bibles`, the same arrangement as the ambient
music. A clone of this repository contains the four public-domain texts above
and nothing else.

| file | translation | rights holder |
| --- | --- | --- |
| `esv.xml` | English Standard Version, ESV® Text Edition 2016 | Crossway Bibles. The file's own root element records "Copyright © 2001 by Crossway Bibles". |
| `nkjv.xml` | New King James Version (1982) | Thomas Nelson, an imprint of HarperCollins Christian Publishing. |
| `hfa.xml` | Hoffnung für Alle | Fontis / Brunnen Verlag Basel, with Biblica. |
| `s00.xml` | Schlachter 2000 | Genfer Bibelgesellschaft. |

Every one of these publishers permits short quotation — typically a few hundred
verses — and none permits redistributing the complete text.

**Permission is being sought from each of these four rights holders. Any
translation for which permission cannot be obtained will be removed from the
project entirely.**

`bible:build` and `bible:verify` skip a translation whose XML is absent
(`buildPacks.mjs` warns and continues), so the app builds, verifies and runs
from a clone — it offers four translations rather than eight.

**They are not in this repository's history either.** An earlier repository did
contain them, committed 2026-05-25; untracking alone would not have removed
them, because the blobs stay addressable at the commit that introduced them.
So that repository was made private and archived, and this one starts from a
single commit — the four texts have never been in it. Both claims hold here:
not in the tree, and not in the history.

---

## Ambient music

Seven background tracks in `public/storage/ambient/`, sourced from
**[Pixabay](https://pixabay.com/music/)**:

`ambient-background.mp3` · `cinematic-ambient.mp3` · `forest-sunrise.mp3` ·
`guitar-ambient.mp3` · `heavens-whisper.mp3` · `nature-cinematic.mp3` ·
`relaxing-guitar.mp3`

They are **not** in this git repository — `public/storage/` is ignored, and
`scripts/deploy.sh` uploads them only with an explicit `--with-ambient`. The
app fetches them from the server at runtime (`?action=ambient.list`); they are
not bundled into the iOS or Android builds.

Terms: the **Pixabay Content License**
(<https://pixabay.com/service/license-summary/>), which permits commercial and
noncommercial use and **does not require attribution**. They are credited here
anyway, because a notice file that omits what the app actually plays is not
much of a notice.

Two caveats worth recording rather than discovering later:

- The Pixabay licence does **not** permit distributing the content "on a
  standalone basis". The app serves each track as a direct `.mp3` URL under
  `storage/ambient/`, which is closer to that line than embedding would be.
  Background music inside an application is the licence's intended use; a
  publicly listable directory of the raw files is less obviously so.
- Pixabay uploads from before January 2019 were released under **CC0**, and
  later ones under the Content License above. Which applies to a given track
  depends on when it was uploaded.

The files carry no ID3 metadata, but **the filenames are unchanged from
download**, so each name above is the identifier Pixabay gave the track and is
what a search there resolves back to. Uploader names are not recorded — Pixabay
requires no attribution, so they were not captured at the time. Worth knowing
that Pixabay filenames normally carry a trailing numeric id
(`forest-sunrise-142943.mp3`); these do not, so the names alone are the trail.

---

## npm dependencies

Runtime and build dependencies are declared in `package.json` and resolved into
`node_modules/`, each carrying its own licence. They are predominantly MIT and
Apache-2.0 — React, Vite, Zustand, Tailwind, Dexie, dnd-kit, Capacitor and its
plugins, i18next, Playwright, Vitest. None is vendored into this repository.

`npx license-checker --summary` (or `npm query ":root > *"`) will produce a
current list if a full inventory is ever needed.

## OpenAI

Chat, speech synthesis, forced alignment and transcription are proxied to the
OpenAI API through `public/api/openai.php`. No OpenAI code is included here.
Generated speech is cached under `public/storage/audio/`; whether that output
may be redistributed is governed by the OpenAI terms in force for the account
whose key paid for it, not by this project's licence.

## Fonts

No webfont is shipped or fetched. `tailwind.config.js` sets pure system stacks
— `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto` for sans and
`Georgia, Cambria` for serif — and there is no `@font-face` rule and no Google
Fonts request anywhere in the app. Nothing to license.

## Icons

`src/components/common/icons.tsx` holds the app's 21 icons as inline SVG. All
of them were generated during development by a language model — every commit
in this repository is co-authored by one — which means their provenance cannot
be traced to a source, and the model may reproduce geometry it memorised.

That was not a hypothetical. `GearIcon` carried a 676-character path that was
recognisably **Feather Icons'** `settings` glyph with its numbers scaled
(`15` → `14.8`, `1.65` → `1.6`, `2` → `1.94`), and the shared `Glyph` frame
uses Feather's exact conventions: a 24×24 viewBox, stroke 2, round caps and
joins. No icon package was ever a dependency, so nothing was imported — the
path was emitted. **It has been replaced** with a cog computed from
trigonometry on the 24×24 grid, and the longest path in the file is now 98
characters.

The remaining 20 icons are utilitarian geometry well below any threshold of
originality: a 17-character play triangle, pause as two `<rect>`s, dots as
three `<circle>`s, chevrons and checks as single `<polyline>`s. Only one glyph
in the file was ever complex enough to carry expressive content, and that was
the one replaced.

Recorded here because the risk is generic rather than specific to this file:
anything drawn by a model may echo a memorised source, and the tell is a path
long enough to be expressive. Grepping for the longest `d="…"` in a file is a
cheap way to find the candidates worth checking.

## Artwork

The app icon and splash artwork in `resources/` (`icon.png`, `splash.png`,
`source/`, `store/`) were made for this project and are covered by
`LICENSE.md`.
