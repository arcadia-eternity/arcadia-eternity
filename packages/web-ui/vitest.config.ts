import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readBaseBattleUi } from './scripts/build-web-content.mjs'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

const configDir = import.meta.dirname

export default defineConfig({
  define: { __BASE_BATTLE_UI__: JSON.stringify(await readBaseBattleUi()) },
  plugins: [builtinEffectsPlugin(), vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Real battle Workers run deadline-limited WASM; avoid starving them behind many DOM suites.
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@': resolve(configDir, 'src'),
    },
  },
})
