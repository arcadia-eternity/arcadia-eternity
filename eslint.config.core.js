import rootConfig from './eslint.config.js'
export default [
  ...rootConfig.filter(config => !config.ignores),
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './packages/battle/tsconfig.core-test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
