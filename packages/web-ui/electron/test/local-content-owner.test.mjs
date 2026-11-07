import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { bindLocalContentOwner } from '../local-content-owner.mjs'

test('resource owners rotate on document reload, renderer crash and close, while SPA and child frames retain their owner', async () => {
  const contents = new EventEmitter(),
    released = []
  const owner = bindLocalContentOwner(contents, async value => {
    released.push(value)
  })
  const first = owner.current()
  contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  assert.equal(owner.current(), first)
  assert.deepEqual(released, [])
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  const second = owner.current()
  assert.notEqual(first, second)
  contents.emit('render-process-gone')
  const third = owner.current()
  contents.emit('destroyed')
  assert.deepEqual(released, [first, second, third])
  assert.notEqual(owner.current(), third)
})
