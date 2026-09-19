import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal merge-specific config: several server test files are authored against
// the `bun:test` API (they run under `bun test` upstream-style). Alias it to a
// vitest-backed shim so a single `vitest run` loads the whole suite. Upstream
// keeps the equivalent shim in test/bun-test-shim.ts; unlike upstream's config
// we deliberately add no module aliases, so resolution for every vitest-native
// test is unchanged.
export default defineConfig({
  resolve: {
    alias: [
      { find: 'bun:test', replacement: path.resolve(here, './test/bun-test-shim.ts') },
    ],
  },
  test: {
    // Playwright owns the reconnect-recovery spec; vitest must not load it.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
