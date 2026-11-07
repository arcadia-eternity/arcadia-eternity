import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { notifyAuthorPreviewChange } from '../author-preview-events.mjs'

test('preview changes are scoped to the bound project and exclude unrelated author payloads', () => {
  const sent = []
  const projects = new WeakMap()
  const window = (id, destroyed = false) => {
    const value = { isDestroyed: () => destroyed, webContents: { send: (...args) => sent.push([id, ...args]) } }
    projects.set(value.webContents, id)
    return value
  }
  const windows = [window('a'), window('b'), window('a', true)]
  notifyAuthorPreviewChange(windows, projects, {
    id: 'a',
    type: 'change',
    file: 'debug/teams/blue.yaml',
    secret: 'private',
  })
  assert.deepEqual(sent, [['a', 'author-preview:changed', { type: 'change', file: 'debug/teams/blue.yaml' }]])
})

test('preview preload exposes only change payload and removes its subscription on teardown', async () => {
  const exposed = {},
    listeners = new Map()
  const source = await readFile(new URL('../preview-preload.cjs', import.meta.url), 'utf8')
  runInNewContext(source, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (name, value) => {
          exposed[name] = value
        },
      },
      ipcRenderer: {
        on: (name, fn) => listeners.set(name, fn),
        removeListener: (name, fn) => {
          assert.equal(listeners.get(name), fn)
          listeners.delete(name)
        },
      },
    }),
  })
  const seen = []
  const off = exposed.arcadiaAuthorPreview.onChanged(value => seen.push(value))
  const payload = { type: 'change', file: 'debug/environments/test.json' }
  listeners.get('author-preview:changed')({ sender: 'must not cross bridge' }, payload)
  assert.deepEqual(seen, [payload])
  off()
  assert.equal(listeners.size, 0)
})
