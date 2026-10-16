import rootConfig from './eslint.config.js'

// The root config intentionally ignores __tests__; opt in only via this command.
export default [
  ...rootConfig.filter(config => !config.ignores),
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './packages/battle/tsconfig.baseline.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
