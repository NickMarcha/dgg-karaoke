import { defineConfig } from 'vitest/config';

// Without this file Vitest would pick up the frontend's config one directory up.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
