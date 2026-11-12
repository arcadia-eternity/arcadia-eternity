import { expect, it } from 'vitest'
import { parseNpmPackOutput } from '../src/npm/pack-output'

const entry = {
  name: '@arcadia-eternity/example',
  version: '1.0.0',
  filename: 'arcadia-eternity-example-1.0.0.tgz',
  integrity: 'sha512-example',
  shasum: 'abc123',
  files: [
    { path: 'package.json', size: 10, mode: 0o644 },
    { path: 'content.json', size: 20, mode: 0o644 },
  ],
}

it('reads the npm 11 array receipt', () => {
  expect(parseNpmPackOutput(JSON.stringify([entry]))).toEqual([entry])
})

it('reads the npm 12 package-keyed receipt', () => {
  expect(parseNpmPackOutput(JSON.stringify({ [entry.name]: entry }))).toEqual([entry])
})

it('rejects empty, malformed, and unsafe receipts', () => {
  for (const stdout of ['[]', '{}', 'null', 'not json', JSON.stringify([{ filename: 'x.tgz', files: [{}] }])])
    expect(() => parseNpmPackOutput(stdout)).toThrow('npm returned')
})
