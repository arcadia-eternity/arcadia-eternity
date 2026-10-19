import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: {
    alias: [
      { find: '@arcadia-eternity/battle/v4', replacement: fileURLToPath(new URL('../../v4.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['design/effect-authoring/runtime.test.ts', 'test/v4/value-binding.test.ts'],
    maxWorkers: 2,
  },
})
