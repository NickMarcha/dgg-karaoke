import { defineConfig } from 'vitest/config';

// Without this file Vitest would pick up the frontend's config one directory up. The integration
// files share one database and clear its tables, so they run one at a time.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], fileParallelism: false } });
