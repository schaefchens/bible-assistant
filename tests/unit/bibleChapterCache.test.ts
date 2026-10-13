import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * api.php caches every chapter it parses under storage/bible/, and a cached
 * chapter used to outlive its source: replacing s00.xml with the licensed
 * Schlachter 2000 would have kept the earlier wording live on every chapter
 * somebody had read before. Each
 * entry now carries the size and mtime of the XML it was parsed from
 * (`bibleXmlFingerprint` in public/api/bible.php) and is parsed again when
 * they no longer match.
 *
 * It spawns `php`, like announcements.test.ts: the rule is PHP's, and one php
 * process per request over a throwaway APP_ROOT is the lowest layer that can
 * see it. Separate processes on purpose — PHP caches stat() results within one.
 */

const api = join(__dirname, '..', '..', 'public', 'api');

type Read = { text: string; cached: boolean } | { error: unknown };

/** One `bible.chapter` read of S00 1:1 against `root`, as a fresh request. */
function readGenesis1(root: string): Read {
  const run = spawnSync(
    'php',
    [
      '-d', 'opcache.enable_cli=0',
      '-r',
      'define("APP_ROOT", getenv("BA_ROOT"));' +
        ' require getenv("BA_API") . "/bootstrap.php"; require getenv("BA_API") . "/bible.php";' +
        ' $r = bibleChapterVerses("S00", 1, 1);' +
        ' echo json_encode(isset($r["error"]) ? ["error" => $r["error"]] : ["text" => $r["verses"][0]["text"], "cached" => $r["cached"]]);',
    ],
    { encoding: 'utf8', env: { ...process.env, BA_ROOT: root, BA_API: api } },
  );
  if (run.error) throw new Error(`php is required to run this test: ${run.error.message}`);
  expect(run.status, run.stderr || run.stdout).toBe(0);
  return JSON.parse(run.stdout) as Read;
}

const zefania = (text: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><bible><testament name="Old"><book number="1">' +
  `<chapter number="1"><verse number="1">${text}</verse></chapter></book></testament></bible>`;

let root = '';
const xml = () => join(root, 'bibles', 's00.xml');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ba-bible-cache-'));
  mkdirSync(join(root, 'bibles'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a cached chapter follows the XML it was parsed from", () => {
  it('is served from the cache while that XML is unchanged', () => {
    writeFileSync(xml(), zefania('Im Anfang schuf Gott'));
    expect(readGenesis1(root)).toEqual({ text: 'Im Anfang schuf Gott', cached: false });
    expect(readGenesis1(root)).toEqual({ text: 'Im Anfang schuf Gott', cached: true });
  });

  it('is parsed again once the XML is replaced', () => {
    writeFileSync(xml(), zefania('Im Anfang schuf Gott'));
    readGenesis1(root);
    writeFileSync(xml(), zefania('Im Anfang schuf Gott die Himmel und die Erde.'));
    expect(readGenesis1(root)).toEqual({
      text: 'Im Anfang schuf Gott die Himmel und die Erde.',
      cached: false,
    });
  });

  it('does not trust an entry written before the stamp existed', () => {
    writeFileSync(xml(), zefania('Im Anfang schuf Gott'));
    const dir = join(root, 'storage', 'bible', 'S00', '1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '1.json'),
      JSON.stringify({ format: 'xml-v2', verses: [{ pk: 1001001, verse: 1, text: 'alt', textTts: 'alt' }] }),
    );
    expect(readGenesis1(root)).toEqual({ text: 'Im Anfang schuf Gott', cached: false });
  });

  it('keeps serving what it has when the XML is not on the server', () => {
    writeFileSync(xml(), zefania('Im Anfang schuf Gott'));
    readGenesis1(root);
    rmSync(xml());
    expect(readGenesis1(root)).toEqual({ text: 'Im Anfang schuf Gott', cached: true });
  });
});
