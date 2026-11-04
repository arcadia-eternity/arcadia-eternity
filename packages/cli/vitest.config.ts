import { defineConfig } from 'vitest/config'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

export default defineConfig({ plugins: [builtinEffectsPlugin()] })
