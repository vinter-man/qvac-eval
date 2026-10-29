import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts', 'src/adapter/types.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
    },
  },
});
