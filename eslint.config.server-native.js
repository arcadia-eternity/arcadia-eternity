import rootConfig from './eslint.config.js'
export default [
  ...rootConfig.filter(config => !config.ignores),
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './packages/server/tsconfig.native-runtime-test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
