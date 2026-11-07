import { defineConfig } from 'vitest/config'
import path from 'path'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

export default defineConfig({
  plugins: [builtinEffectsPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
