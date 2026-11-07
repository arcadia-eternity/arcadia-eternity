import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once, EventEmitter } from 'node:events'
import { protectStandardStreams } from '../stdio.mjs'

test('logging continues after the launcher closes its actual output pipe', async () => {
  const module = new URL('../stdio.mjs', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      String.raw`
    import { protectStandardStreams } from ${JSON.stringify(module)};
    protectStandardStreams();
    process.on('message', () => {
      process.stdout.write('Electron desktop bridge status: ready\n');
      process.stderr.write('Electron desktop bridge probe failed\n');
      setTimeout(() => process.exit(0), 30);
    });
    process.send('ready');
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  )
  try {
    await once(child, 'message')
    const exited = once(child, 'exit')
    child.stdout.destroy()
    child.stderr.destroy()
    child.send('write')
    assert.equal((await exited)[0], 0)
  } finally {
    child.kill()
  }
})

test('only broken output pipes are ignored; other stream errors still propagate', () => {
  const stream = new EventEmitter()
  protectStandardStreams([stream])
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
  const error = Object.assign(new Error('disk failure'), { code: 'EIO' })
  assert.throws(() => stream.emit('error', error), error)
})
