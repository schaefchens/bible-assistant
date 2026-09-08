/**
 * Entry point for the end-to-end suite.
 *
 * The specs drive the **built** app (`php -S -t dist`), so two things have to
 * be true before Playwright starts, and neither is Playwright's job:
 *
 *   1. `dist/` must be current. `vite build` re-copies ~230 MB of
 *      `public/storage`, so this refuses to run rather than rebuilding behind
 *      your back — testing a stale bundle is worse than not testing.
 *   2. The per-user server state must be reset, so a run starts from a known
 *      place. The content-addressed caches (`storage/audio`, `storage/bible`)
 *      are deliberately *kept*: they are what makes real narration free.
 *
 * Run: npm run e2e  [-- --headed --grep narration]
 */
import { spawn } from 'node:child_process';
import { existsSync, renameSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

/** Newest mtime under a path, skipping the noise directories. */
function newest(path, skip = new Set(['node_modules', '.git'])) {
  let best = 0;
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) {
        if (skip.has(e)) continue;
        walk(join(p, e));
      }
      return;
    }
    if (st.mtimeMs > best) best = st.mtimeMs;
  };
  walk(path);
  return best;
}

if (!existsSync(dist)) die('dist/ does not exist — run `npm run build` first.');
if (!existsSync(join(dist, 'api.php'))) {
  die('dist/api.php is missing — the E2E suite serves the backend out of dist/.');
}
if (!existsSync(join(dist, 'api'))) {
  die('dist/api/ is missing — api.php requires public/api/*.php and cannot boot without it.');
}
if (!existsSync(join(dist, 'secrets.php'))) {
  die(
    'dist/secrets.php is missing, so narration and the assistant cannot work.\n' +
      '  It is copied from public/secrets.php by `npm run build`.',
  );
}

// Sources that must be older than the bundle. `public/` as a whole is not
// checked: its storage/ tree is written by every run, and by the app itself.
const SOURCES = [
  'src',
  'index.html',
  'vite.config.ts',
  'package.json',
  'public/api.php',
  // api.php is a router over these; a stale dist/api/ is a backend that
  // disagrees with the one under test.
  'public/api',
];
const builtAt = statSync(join(dist, 'index.html')).mtimeMs;
const stale = SOURCES.filter((rel) => {
  const p = join(root, rel);
  return existsSync(p) && newest(p) > builtAt;
});
if (stale.length > 0) {
  die(
    `dist/ is older than ${stale.join(', ')} — run \`npm run build\`.\n` +
      '  The E2E suite tests the built artifact on purpose, so a stale bundle\n' +
      '  would quietly test the previous version of your change.',
  );
}

// A `live` run that was killed mid-test can leave a clip moved aside; put any
// back before starting, or the journeys would generate it again for real.
function restoreAside(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) restoreAside(p);
    else if (e.name.endsWith('.e2e-aside')) {
      const original = p.slice(0, -'.e2e-aside'.length);
      rmSync(original, { force: true });
      renameSync(p, original);
      console.log(`  restored ${original} (left aside by an interrupted live run)`);
    }
  }
}
restoreAside(join(dist, 'storage', 'audio'));

// Reset only what a run writes. storage/audio (the shared, content-addressed
// speech cache) and storage/bible (the Zefania parse cache) are what keep the
// suite free and quick — wiping them would mean real OpenAI calls.
for (const dir of ['users', 'shares', 'reports', 'moderation', 'feedback']) {
  rmSync(join(dist, 'storage', dir), { recursive: true, force: true });
}

const args = ['playwright', 'test', ...process.argv.slice(2)];
console.log(`▶ npx ${args.join(' ')}\n`);
const child = spawn('npx', args, { cwd: root, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
