/**
 * Builds Google Play store graphics for Bible Assistant.
 *
 *   phone screenshots : 1080x1920 (9:16) — headline + full device shot
 *   feature graphic   : 1024x500
 *
 * Source captures are raw 1080x2400 emulator screencaps.
 */
import sharp from '/Users/css/Projects/scharfmedia/bible-assistant/node_modules/sharp/lib/index.js';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SHOTS = '/private/tmp/claude-502/-Users-css-Projects-scharfmedia-bible-assistant/9e911031-8f17-4d2e-b51e-6a68954315c3/scratchpad/shots';
const OUT = '/Users/css/Projects/scharfmedia/bible-assistant/resources/store';

// Brand palette — lifted from tailwind.config.js so the frames match the app.
const NAVY = '#1a1a2e';
const NAVY_DEEP = '#0f0f1e';
const GOLD_GLOW = '#e7c98a';
const GOLD_DIM = '#9c8456';
const CREAM_DIM = '#bdb6a9';

const W = 1080;
const H = 1920;

// Device plate: the whole 1080x2400 capture, scaled to fit under the headline.
const DEV_H = 1430;
const DEV_W = Math.round((DEV_H * 1080) / 2400); // 644
const DEV_X = Math.round((W - DEV_W) / 2);
const DEV_Y = 440;
const RADIUS = 26;

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Background + headline block, as one SVG. */
function backdrop(headline, subline) {
  const headSize = 74;
  const headLead = 88;
  const subSize = 38;
  const subLead = 50;

  // Headline sits above the device, vertically packed from y=170.
  let y = 170 + headSize;
  const heads = headline
    .map((line) => {
      const t = `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Georgia, Cambria, serif" font-size="${headSize}" fill="${GOLD_GLOW}">${esc(line)}</text>`;
      y += headLead;
      return t;
    })
    .join('');

  let sy = y + 12;
  const subs = subline
    .map((line) => {
      const t = `<text x="${W / 2}" y="${sy}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${subSize}" fill="${CREAM_DIM}">${esc(line)}</text>`;
      sy += subLead;
      return t;
    })
    .join('');

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="${NAVY_DEEP}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.16" r="0.62">
      <stop offset="0%" stop-color="${GOLD_GLOW}" stop-opacity="0.17"/>
      <stop offset="100%" stop-color="${GOLD_GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <line x1="${W / 2 - 60}" y1="132" x2="${W / 2 + 60}" y2="132" stroke="${GOLD_DIM}" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
  ${heads}
  ${subs}
</svg>`);
}

/** Rounded-corner mask for the device plate. */
function roundMask(w, h, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

/** Thin gold hairline around the device plate. */
function deviceBorder(w, h, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="${r}" ry="${r}" fill="none" stroke="${GOLD_DIM}" stroke-width="1.5" opacity="0.55"/></svg>`,
  );
}

async function frame({ src, headline, subline, out }) {
  const device = await sharp(join(SHOTS, src))
    .resize(DEV_W, DEV_H, { fit: 'fill' })
    .composite([
      { input: roundMask(DEV_W, DEV_H, RADIUS), blend: 'dest-in' },
      { input: deviceBorder(DEV_W, DEV_H, RADIUS), blend: 'over' },
    ])
    .png()
    .toBuffer();

  mkdirSync(dirname(out), { recursive: true });
  await sharp(backdrop(headline, subline))
    .composite([{ input: device, left: DEV_X, top: DEV_Y }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log('  ✓', out.replace(OUT + '/', ''));
}

/** 1024x500 feature graphic: wordmark left, phone bleeding off the right. */
async function featureGraphic({ src, title, tagline, out }) {
  const FW = 1024;
  const FH = 500;
  // The phone is rendered taller than the canvas, then the top 500px are cut
  // out — so the device bleeds off the bottom edge instead of floating.
  const phoneH = 610;
  const phoneW = Math.round((phoneH * 1080) / 2400);
  const phoneX = 700;
  const phoneY = 0;

  const phoneTall = await sharp(join(SHOTS, src))
    .resize(phoneW, phoneH, { fit: 'fill' })
    .composite([
      { input: roundMask(phoneW, phoneH, 22), blend: 'dest-in' },
      { input: deviceBorder(phoneW, phoneH, 22), blend: 'over' },
    ])
    .png()
    .toBuffer();

  const phone = await sharp(phoneTall)
    .extract({ left: 0, top: 0, width: phoneW, height: FH })
    .png()
    .toBuffer();

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${FW}" height="${FH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="${NAVY_DEEP}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.5" r="0.72">
      <stop offset="0%" stop-color="${GOLD_GLOW}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${GOLD_GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${FW}" height="${FH}" fill="url(#bg)"/>
  <rect width="${FW}" height="${FH}" fill="url(#glow)"/>
  <line x1="72" y1="176" x2="172" y2="176" stroke="${GOLD_DIM}" stroke-width="3" stroke-linecap="round"/>
  <text x="72" y="268" font-family="Georgia, Cambria, serif" font-size="76" fill="${GOLD_GLOW}">${esc(title)}</text>
  <text x="72" y="330" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" fill="${CREAM_DIM}">${esc(tagline[0])}</text>
  <text x="72" y="372" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" fill="${CREAM_DIM}">${esc(tagline[1] ?? '')}</text>
</svg>`);

  mkdirSync(dirname(out), { recursive: true });
  await sharp(svg)
    .composite([{ input: phone, left: phoneX, top: phoneY }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log('  ✓', out.replace(OUT + '/', ''));
}

const DE = [
  {
    src: '07-chat-reading.png',
    headline: ['Sprich. Und höre.'],
    subline: ['Stelle ansagen — sie wird vorgelesen,', 'Wort für Wort mitmarkiert.'],
    out: join(OUT, 'de-DE/phone-1-hoeren.png'),
  },
  {
    src: '14-ef-2.png',
    headline: ['Ohne hinzusehen'],
    subline: ['Fünf riesige Flächen für Start, Vor,', 'Zurück und Mikrofon.'],
    out: join(OUT, 'de-DE/phone-2-freihaendig.png'),
  },
  {
    src: '08-reader.png',
    headline: ['Lesen wie im Buch'],
    subline: ['Fließender Text mit Absätzen —', 'keine Zeile pro Vers.'],
    out: join(OUT, 'de-DE/phone-3-lesen.png'),
  },
  {
    src: '10-cards.png',
    headline: ['Verse behalten'],
    subline: ['Karten zum Umdrehen,', 'per Sprache angelegt.'],
    out: join(OUT, 'de-DE/phone-4-karten.png'),
  },
  {
    src: '11-boards.png',
    headline: ['Auf Tafeln ordnen'],
    subline: ['Karten nach Thema sammeln', 'und frei anordnen.'],
    out: join(OUT, 'de-DE/phone-5-tafeln.png'),
  },
  {
    src: '04-step2.png',
    headline: ['8 Übersetzungen'],
    subline: ['Deutsch und Englisch.', 'Zum Mitnehmen offline.'],
    out: join(OUT, 'de-DE/phone-6-uebersetzungen.png'),
  },
  {
    src: '19-settings-voices.png',
    headline: ['Deine Stimme,', 'deine Fassung'],
    subline: ['Lesestimme, Übersetzung und Tempo', 'frei wählbar.'],
    out: join(OUT, 'de-DE/phone-7-einstellungen.png'),
  },
];

const EN = [
  {
    src: 'en-01-chat.png',
    headline: ['Say it. Hear it.'],
    subline: ['Name a passage — it reads aloud,', 'highlighting every word.'],
    out: join(OUT, 'en-US/phone-1-listen.png'),
  },
  {
    src: 'en-07b-eyesfree.png',
    headline: ['Eyes off. Ears on.'],
    subline: ['Five huge zones for play, next,', 'back and the microphone.'],
    out: join(OUT, 'en-US/phone-2-handsfree.png'),
  },
  {
    src: 'en-02-reader.png',
    headline: ['Read like a book'],
    subline: ['Flowing prose with paragraphs —', 'not one line per verse.'],
    out: join(OUT, 'en-US/phone-3-read.png'),
  },
  {
    src: 'en-05-translations.png',
    headline: ['8 translations'],
    subline: ['English and German.', 'Downloaded for offline use.'],
    out: join(OUT, 'en-US/phone-4-translations.png'),
  },
  {
    src: 'en-06-settings.png',
    headline: ['Your voice,', 'your version'],
    subline: ['Choose the reading voice,', 'the translation and the pace.'],
    out: join(OUT, 'en-US/phone-5-settings.png'),
  },
];

console.log('German phone screenshots:');
for (const f of DE) await frame(f);
console.log('English phone screenshots:');
for (const f of EN) await frame(f);
console.log('Feature graphics:');
await featureGraphic({
  src: '07-chat-reading.png',
  title: 'Bibel-Assistent',
  tagline: ['Die Bibel hören, lesen und behalten —', 'gesteuert mit der Stimme.'],
  out: join(OUT, 'de-DE/feature-graphic.png'),
});
await featureGraphic({
  src: 'en-01-chat.png',
  title: 'Bible Assistant',
  tagline: ['Hear, read and keep the Bible —', 'driven entirely by voice.'],
  out: join(OUT, 'en-US/feature-graphic.png'),
});
console.log('done');
