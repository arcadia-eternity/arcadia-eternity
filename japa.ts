import { configure, run } from '@japa/runner'
import { assert } from '@japa/assert'
import { expect } from '@japa/expect'
import { specReporter } from '@japa/spec-reporter'

/*
|--------------------------------------------------------------------------
| Configure tests
|--------------------------------------------------------------------------
|
| The configure method accepts the configuration to configure the Japa
| tests runner.
|
*/
configure({
  /*
  |--------------------------------------------------------------------------
  | Test files
  |--------------------------------------------------------------------------
  |
  | Define a set of files to be loaded for testing. You can define
  | glob patterns and we will expand them for you.
  |
  */
  files: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts'],

  /*
  |--------------------------------------------------------------------------
  | Timeout
  |--------------------------------------------------------------------------
  |
  | Timeout for a single test. You can override this value for individual
  | tests as well.
  |
  */
  timeout: 10000,

  /*
  |--------------------------------------------------------------------------
  | Plugins
  |--------------------------------------------------------------------------
  |
  | Define the plugins to extend the runner functionality. You can also
  | define them inside the test files.
  |
  */
  plugins: [assert(), expect()],

  /*
  |--------------------------------------------------------------------------
  | Reporters
  |--------------------------------------------------------------------------
  |
  | Define the reporters to use for displaying the test results. You can
  | also define them inside the test files.
  |
  */
  reporters: {
    activated: ['spec'],
    list: [{ name: 'spec', handler: specReporter() }],
  },

  /*
  |--------------------------------------------------------------------------
  | Setup and teardown hooks
  |--------------------------------------------------------------------------
  |
  | Define global setup and teardown hooks that are executed before and
  | after all the tests.
  |
  */
  setup: [
    () => {
      // Global setup - configure module resolution for ESM
      process.env.NODE_ENV = process.env.NODE_ENV || 'test'
    },
  ],
})

/*
|--------------------------------------------------------------------------
| Run tests
|--------------------------------------------------------------------------
|
| The following "run" method is required to execute all the tests.
|
*/
run()
