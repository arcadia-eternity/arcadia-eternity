import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/v2/__tests__/**/*.test.ts'],
  },
  esbuild: {
    target: 'node18',
  },
})
