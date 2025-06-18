/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'packages/battle/tsconfig.test.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@arcadia-eternity/(.*)$': '<rootDir>/packages/$1/src',
    // Mock jsondiffpatch to avoid ES module issues
    '^jsondiffpatch$': '<rootDir>/jest-mocks/jsondiffpatch.js',
  },
  transformIgnorePatterns: ['node_modules/(?!(nanoid|jsondiffpatch|@dmsnell)/)'],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.d.ts',
    '!packages/*/src/**/*.test.ts',
    '!packages/*/src/**/*.spec.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  verbose: true,
}
