import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@arcadia-eternity\/battle\/engine$/,
        replacement: fileURLToPath(new URL('../../engine.ts', import.meta.url)),
      },
      {
        find: /^@arcadia-eternity\/battle\/authoring$/,
        replacement: fileURLToPath(new URL('../../authoring.ts', import.meta.url)),
      },
      {
        find: /^@arcadia-eternity\/data-pack-base\/native$/,
        replacement: fileURLToPath(new URL('../../../../packs/base/effects.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['design/effect-authoring/runtime.test.ts', 'test/engine/value-binding.test.ts'],
    maxWorkers: 2,
  },
})
