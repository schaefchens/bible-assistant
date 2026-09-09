import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from '@/i18n/de.json';
import en from '@/i18n/en.json';

/**
 * Every `t('…')` in the app names a string that exists, in both languages.
 *
 * Written after a shared board's Report button rendered the words
 * `community.report` at the user. That key is a *group* — `action`,
 * `reportPost`, `reportSpace`, `reasons` — and asking for the group hands back
 * the key's own name rather than throwing, so the mistake ships looking like a
 * label. Nothing else could see it: `tsc` types `t()` as taking a string, lint
 * has no view of the locale files, and the E2E suite would only have caught it
 * had a spec happened to assert on that one button's text.
 *
 * So it belongs here, at the lowest layer that can see it, and covering every
 * call site at once — a per-button assertion is one bug caught and six hundred
 * places left uncovered.
 *
 * Three separate failures, kept separate because they read differently: a key
 * that does not exist, a key that exists but is a group, and a key one language
 * has and the other does not. That third one used to be a `node -e` one-liner
 * pasted in by hand after every locale edit.
 *
 * **It only sees literals**, and deliberately so. A handful of call sites build
 * the key (`t(\`community.report.reasons.${r}\`)`), and chasing those needs
 * either evaluation or a convention nobody would keep. Literals are where this
 * class of bug lives, and they are the overwhelming majority.
 */

type Tree = { [k: string]: string | Tree };

/** Source files, minus the locale JSON they are checked against. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** `t('a.b')`, `t("a.b")`, and the same behind a leading `i18n.` — but not a
 * template literal, which this cannot resolve and does not try to. */
const CALL = /\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g;

function callSites(): { key: string; where: string }[] {
  const out: { key: string; where: string }[] = [];
  for (const file of sourceFiles('src')) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(CALL)) out.push({ key: m[1], where: `${file}:${i + 1}` });
      });
  }
  return out;
}

function lookup(tree: Tree, key: string): string | Tree | undefined {
  return key.split('.').reduce<string | Tree | undefined>((node, part) => {
    if (node === undefined || typeof node === 'string') return undefined;
    return node[part];
  }, tree);
}

/**
 * What a key resolves to, allowing for i18next's plural suffixes: `t('x')` is
 * satisfied by `x`, or by `x_one` + `x_other` together. A count key has no
 * bare form, so looking only for the exact key reports every one of them.
 */
function resolve(tree: Tree, key: string): 'string' | 'group' | 'missing' {
  const exact = lookup(tree, key);
  if (typeof exact === 'string') return 'string';
  if (exact !== undefined) return 'group';
  const one = lookup(tree, `${key}_one`);
  const other = lookup(tree, `${key}_other`);
  return typeof one === 'string' && typeof other === 'string' ? 'string' : 'missing';
}

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : flatten(v, `${prefix}${k}.`),
  );
}

const locales: [string, Tree][] = [
  ['en', en as Tree],
  ['de', de as Tree],
];

describe('i18n keys', () => {
  const sites = callSites();

  it('finds the call sites at all', () => {
    // The regex is the whole test; a rename that quietly stops matching would
    // otherwise turn every assertion below green.
    expect(sites.length).toBeGreaterThan(200);
  });

  it('every key the app asks for exists', () => {
    const missing = locales.flatMap(([name, tree]) =>
      sites.filter((s) => resolve(tree, s.key) === 'missing').map((s) => `${name}: ${s.key} (${s.where})`),
    );
    expect(missing).toEqual([]);
  });

  it('no key names a group of strings instead of one', () => {
    const groups = locales.flatMap(([name, tree]) =>
      sites.filter((s) => resolve(tree, s.key) === 'group').map((s) => `${name}: ${s.key} (${s.where})`),
    );
    expect(groups).toEqual([]);
  });

  it('the two languages carry the same keys', () => {
    const [enKeys, deKeys] = locales.map(([, tree]) => new Set(flatten(tree)));
    expect([...enKeys].filter((k) => !deKeys.has(k))).toEqual([]);
    expect([...deKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });
});
