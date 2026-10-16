import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@arcadia-eternity/battle/core': fileURLToPath(new URL('./core.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['test/core/**/*.test.ts'] },
})
