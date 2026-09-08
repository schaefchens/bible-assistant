import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import viteConfig from './vite.config';

/**
 * Layers 1 to 3 of the test strategy: `unit` (pure functions, `node`), `int`
 * (stores + Dexie + queue, `jsdom`) and `component` (a React render, `jsdom`).
 * Layer 4 is Playwright and lives in playwright.config.ts — it drives the
 * shipped app and is run on command, not by `npm test`.
 *
 * Built by merging the real vite config rather than restating it, so the `@`
 * alias and the `__GIT_COMMIT__` / `__BUILD_TIME__` defines cannot drift from
 * what the app is actually built with. This matters more than it looks:
 * `src/services/api/origin.ts` evaluates `import.meta.env` at module load and
 * sits on the critical path into the stores, so a hand-rolled config missing
 * one of these fails at import time rather than in an assertion.
 *
 * Plugins are dropped from the shared base — VitePWA is a build-time concern —
 * and `react()` is added back on the one project that needs it. It stays off
 * `unit` and `int` deliberately: those two never render, and the JSX transform
 * is not free.
 */
const base = viteConfig({ mode: 'test', command: 'serve' });

export default mergeConfig(
  { ...base, plugins: [] },
  defineConfig({
    test: {
      passWithNoTests: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            // Pure modules only, so there is nothing to mock and no DOM to
            // pay for. If a spec here needs jsdom, it belongs in `int`.
            environment: 'node',
            include: ['tests/unit/**/*.test.ts'],
          },
        },
        {
          extends: true,
          // The only project that renders, so the only one that pays for the
          // JSX transform.
          plugins: [react()],
          test: {
            name: 'component',
            /**
             * Rules that only exist once React renders, and that no pure
             * function can see: a hook's reactivity, a guarded state
             * adjustment during render, a memo's dependency list.
             *
             * The entry criterion is deliberately narrow, because the layer
             * below and the layer above both already cover more than it does.
             * "Does this button work" is a journey — it belongs in
             * `tests/e2e`, which grows by capability and drives the real app.
             * "Does this function return the right thing" belongs in `unit`.
             * What lands here is the middle case that neither can reach: a
             * component whose *render behaviour* is the rule.
             */
            environment: 'jsdom',
            include: ['tests/component/**/*.test.tsx'],
            setupFiles: ['tests/component/setup.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'int',
            // jsdom supplies `Audio` (audioPlaybackManager constructs elements
            // at module load) and `localStorage` (zustand/persist); the setup
            // file adds IndexedDB for Dexie.
            environment: 'jsdom',
            include: ['tests/int/**/*.test.ts'],
            setupFiles: ['tests/int/setup.ts'],
          },
        },
      ],
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
    },
  }),
);
