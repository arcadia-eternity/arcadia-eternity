import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validCommand, validEvent, validBounds, rateGate } from '../swf-policy.mjs'
const envelope = { v: 1, instance: 'pet-1', task: 1, seq: 1 }
test('bounded cosmetic protocol rejects arbitrary methods, URLs and malformed allocations', () => {
  for (const type of ['fetch', 'invoke', 'install', 'getCredentials'])
    assert.equal(validCommand({ ...envelope, type, url: 'https://example.org' }), false)
  assert.equal(validCommand({ ...envelope, type: 'play', state: '物理攻击' }), true)
  assert.equal(validCommand({ ...envelope, type: 'play', state: 'execute' }), false)
  assert.equal(
    validCommand({
      ...envelope,
      type: 'load',
      bytes: { container: new ArrayBuffer(8), movie: new ArrayBuffer(8) },
      runtime: { 'evil.js': new ArrayBuffer(1) },
    }),
    false,
  )
  assert.equal(validEvent({ ...envelope, type: 'hit', state: '物理攻击', duration: Infinity }), false)
  assert.equal(validEvent({ ...envelope, type: 'error', message: 'a'.repeat(241) }), false)
  assert.equal(validBounds({ x: 0, y: 0, width: Infinity, height: 1, visible: true }), false)
  assert.equal(validBounds({ x: 0, y: 0, width: 100, height: 100, visible: true }), true)
})
test('callback quotas recover only after an elapsed window', () => {
  let now = 0
  const gate = rateGate(2, () => now)
  assert.equal(gate(), true)
  assert.equal(gate(), true)
  assert.equal(gate(), false)
  now = 1000
  assert.equal(gate(), true)
})
