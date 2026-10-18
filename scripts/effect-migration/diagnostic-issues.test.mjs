import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relevant } from './diagnostic-issues.mjs'

test('retains a nested discriminator failure in an otherwise matching outer branch', () => {
  const nested = { code: 'invalid_literal', path: ['apply', 'settings', 'type'], message: 'Expected nested type' }
  const wrongOuter = { code: 'invalid_literal', path: ['apply', 'type'], message: 'Expected another action' }
  const issues = [
    { code: 'invalid_union', path: ['apply'], unionErrors: [{ issues: [nested] }, { issues: [wrongOuter] }] },
  ]
  assert.deepEqual(relevant(issues, {}), [
    { path: '/apply/settings/type', code: 'invalid_literal', message: 'Expected nested type' },
  ])
})
test('reports an unknown direct discriminator without retaining unrelated alternatives', () => {
  const root = { apply: { type: 'unknown' } }
  const issues = [
    {
      code: 'invalid_union',
      path: ['apply'],
      unionErrors: [
        { issues: [{ code: 'invalid_literal', path: ['apply', 'type'] }] },
        { issues: [{ code: 'invalid_type', path: ['apply'] }] },
      ],
    },
  ]
  assert.deepEqual(relevant(issues, root), [{ path: '/apply', code: 'unsupported_variant', value: root.apply }])
})
