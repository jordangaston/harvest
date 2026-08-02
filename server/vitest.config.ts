import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          setupFiles: ['tests/helpers/unit-setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          globalSetup: ['tests/helpers/global-setup.ts'],
          hookTimeout: 60000,
          testTimeout: 60000,
        },
      },
    ],
  },
});
