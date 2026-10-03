import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['db/**/*.test.ts', 'src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
})
