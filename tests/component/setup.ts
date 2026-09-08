import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount whatever the last test rendered.
 *
 * `@testing-library/react` appends each render to `document.body` and does not
 * remove it, so without this a `getByRole` in the second test matches the first
 * test's tree as well — which fails as an ambiguous-match error rather than as
 * the assertion that was actually wrong, and only once a second test exists.
 */
afterEach(cleanup);
