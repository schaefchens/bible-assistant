#!/usr/bin/env node
/**
 * Generates every app-icon asset from one pristine source.
 *
 * Why this exists rather than `capacitor-assets generate`:
 *
 *   - capacitor-assets sizes one bitmap for the *worst* case (a circular mask),
 *     so the glyph ended up at ~65% of the canvas everywhere — including iOS,
 *     which only clips corners. Then its adaptive-icon XML insets the layers a
 *     further 16.7%, leaving the Android launcher glyph at ~43% of the icon. It
 *     read as a small logo floating in a navy square.
 *   - It also insets the *background* layer, so the navy only covered the
 *     guaranteed-visible 72dp of the 108dp canvas; a launcher's parallax/zoom
 *     could reveal transparent corners.
 *   - It never handled the PWA icons anyway (see the note in vite.config.ts), so
 *     custom code was needed regardless.
 *
 * The fix is per-role sizing: full-bleed surfaces get a large glyph, and only
 * genuinely masked surfaces pay for the safe zone.
 *
 * Splash screens are still capacitor-assets' job — this script only owns icons.
 *
 *   node scripts/icons/buildIcons.mjs
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Brand navy. Must stay in step with theme-color, the splash and the Android
 * window background, or the splash-to-chrome handoff shows a tone step. */
const NAVY = '#1a1a2e';
/** Untouched original render; its background is #14162d, not our navy. */
const SOURCE = 'resources/source/icon.png';
/** Max per-channel distance (summed) at which a pixel counts as background. */
const BG_TOLERANCE = 30;

/**
 * How much of the canvas the glyph's larger dimension fills, per role.
 *
 * `masked` is the constrained one: an Android adaptive icon only guarantees the
 * central 72 of 108dp (66.6%), and the mask can be a circle, so content must
 * stay inside that. Everything else is full-bleed or corner-clipped only, where
 * that much padding just makes the icon look small.
 */
const FILL = {
  fullBleed: 0.78,
  masked: 0.62,
  /** 32px has no room for margin; legibility wins. */
  favicon: 0.86,
};

const A = 'android/app/src/main/res';
const IOS_ICONSET = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
/** density → [legacy icon px, adaptive layer px (108dp)] */
const DENSITIES = {
  ldpi: [36, 81],
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};

/**
 * Repaint the source's background to our navy, then crop to the glyph.
 *
 * Only near-background pixels are repainted, which leaves the gold and its
 * anti-aliased edges alone. Note the crop keeps its navy backdrop instead of
 * keying it out: every surface we composite onto is the same navy, so keeping it
 * avoids the dark fringe that keying anti-aliased edges would leave.
 */
async function extractGlyph() {
  const { data, info } = await sharp(path.join(ROOT, SOURCE))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bg = [data[0], data[1], data[2]];
  const navy = [
    parseInt(NAVY.slice(1, 3), 16),
    parseInt(NAVY.slice(3, 5), 16),
    parseInt(NAVY.slice(5, 7), 16),
  ];

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const distance =
        Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (distance <= BG_TOLERANCE) {
        data[i] = navy[0];
        data[i + 1] = navy[1];
        data[i + 2] = navy[2];
        data[i + 3] = 255;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${SOURCE}: found no glyph — is it a solid colour?`);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const buffer = await sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: w, height: h })
    .png()
    .toBuffer();
  return { buffer, width: w, height: h };
}

/** White mask the icon is clipped to, for the legacy Android plates. */
function maskSvg(size, shape) {
  const body =
    shape === 'circle'
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>`
      : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/>`;
  return Buffer.from(`<svg width="${size}" height="${size}">${body}</svg>`);
}

async function renderIcon(glyph, size, fill, shape = 'square') {
  const layers = [];
  if (fill > 0) {
    const scale = (size * fill) / Math.max(glyph.width, glyph.height);
    const art = await sharp(glyph.buffer)
      .resize(Math.max(1, Math.round(glyph.width * scale)), Math.max(1, Math.round(glyph.height * scale)))
      .toBuffer();
    layers.push({ input: art, gravity: 'center' });
  }
  if (shape !== 'square') layers.push({ input: maskSvg(size, shape), blend: 'dest-in' });

  return sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite(layers)
    .png()
    .toBuffer();
}

/** Adaptive icons: full-bleed layers, no `<inset>`. The safe-zone padding lives
 * in the foreground bitmap (FILL.masked) so there is no hidden multiplier, and
 * the background covers all 108dp so a launcher's zoom can never reveal a gap. */
const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;

async function main() {
  const glyph = await extractGlyph();
  console.log(
    `source glyph ${glyph.width}x${glyph.height} → ` +
      `${Math.round(FILL.fullBleed * 100)}% full-bleed, ${Math.round(FILL.masked * 100)}% masked`,
  );

  /** [relative path, size, fill, shape] */
  const targets = [
    // iOS ships a single 1024 icon; the OS applies the squircle.
    [`${IOS_ICONSET}/AppIcon-512@2x.png`, 1024, FILL.fullBleed, 'square'],
    // Derived master, kept beside the original for reference.
    ['resources/icon.png', 1024, FILL.fullBleed, 'square'],
    // Web + PWA. The maskable entry is a separate bitmap precisely so the
    // unmasked one doesn't have to carry safe-zone padding.
    ['public/icons/icon-192.png', 192, FILL.fullBleed, 'square'],
    ['public/icons/icon-512.png', 512, FILL.fullBleed, 'square'],
    ['public/icons/icon-512-maskable.png', 512, FILL.masked, 'square'],
    ['public/apple-touch-icon.png', 180, FILL.fullBleed, 'square'],
    ['public/favicon-32.png', 32, FILL.favicon, 'square'],
  ];

  for (const [density, [legacy, adaptive]] of Object.entries(DENSITIES)) {
    targets.push(
      // Legacy plates, only used below API 26.
      [`${A}/mipmap-${density}/ic_launcher.png`, legacy, FILL.fullBleed, 'rounded'],
      [`${A}/mipmap-${density}/ic_launcher_round.png`, legacy, FILL.masked, 'circle'],
      // Adaptive layers. Both are opaque navy — see extractGlyph().
      [`${A}/mipmap-${density}/ic_launcher_foreground.png`, adaptive, FILL.masked, 'square'],
      [`${A}/mipmap-${density}/ic_launcher_background.png`, adaptive, 0, 'square'],
    );
  }

  for (const [rel, size, fill, shape] of targets) {
    const out = path.join(ROOT, rel);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, await renderIcon(glyph, size, fill, shape));
    console.log(`  ${rel}  ${size}px`);
  }

  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const out = path.join(ROOT, A, 'mipmap-anydpi-v26', name);
    await writeFile(out, ADAPTIVE_XML);
    console.log(`  ${A}/mipmap-anydpi-v26/${name}`);
  }
}

await main();
