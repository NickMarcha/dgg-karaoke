import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Without this file Vitest would pick up the frontend's config one directory up. The integration
// files share one database and clear its tables, so they run one at a time.
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], fileParallelism: false },
});
