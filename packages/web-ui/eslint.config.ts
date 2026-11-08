import pluginVue from 'eslint-plugin-vue'
import { configureVueProject, defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

configureVueProject({ rootDir: import.meta.dirname })
const autoImportFlatConfig = {
  languageOptions: {
    // Element Plus service APIs resolved by the Vite auto-import plugin.
    // Keep lint usable before the first application build.
    globals: { ElMessage: 'readonly', ElMessageBox: 'readonly' } as const,
  },
}
// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: ['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '**/release/**', '**/release-preview/**'],
  },
  autoImportFlatConfig,

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    name: 'electron/commonjs-preloads',
    files: ['electron/*preload.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    name: 'app/overrides',
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'vue/no-deprecated-filter': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
  skipFormatting,
)
