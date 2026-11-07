import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { bounded, isPortListening, shutdownDesktopProcess } from './desktop-acceptance-process.mjs'

const server = `const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));process.on('message',()=>s.close(()=>process.exit(0)));`
async function fixture(t, code = server) {
  const child = spawn(process.execPath, ['-e', code], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  t.after(async () => {
    await shutdownDesktopProcess({ child, quit: () => child.send('quit'), timeoutMs: 50 }).catch(() => {})
  })
  const [message] = await bounded(once(child, 'message'), 5000, 'Fixture did not start')
  return { child, port: message.port }
}

test('normal application quit closes its process and listener without force', async t => {
  const { child, port } = await fixture(t)
  assert.equal(await isPortListening(port), true)
  const result = await shutdownDesktopProcess({ child, quit: () => child.send('quit'), ports: [port], timeoutMs: 2000 })
  assert.deepEqual(result, { forced: false, exitCode: 0, exitSignal: null })
  assert.equal(await isPortListening(port), false)
})

test('normal quit waits for the descendant listener after the launcher exits', async t => {
  const delayedServer = `const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));process.on('message',()=>setTimeout(()=>s.close(()=>process.exit(0)),200));`
  const owned = await fixture(
    t,
    `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(delayedServer)}],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',m=>process.send(m));process.on('message',()=>c.send('quit',()=>process.exit(0)));`,
  )
  const result = await shutdownDesktopProcess({
    child: owned.child,
    quit: () => owned.child.send('quit'),
    ports: [owned.port],
    timeoutMs: 2000,
  })
  assert.deepEqual(result, { forced: false, exitCode: 0, exitSignal: null })
  assert.equal(await isPortListening(owned.port), false)
})

test('hung quit terminates only the captured process tree and closes its descendant listener', async t => {
  const unrelated = await fixture(t)
  const owned = await fixture(
    t,
    `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(server)}],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',m=>process.send(m));process.on('message',()=>{});`,
  )
  const result = await shutdownDesktopProcess({
    child: owned.child,
    quit: () => new Promise(() => {}),
    ports: [owned.port],
    timeoutMs: 50,
  })
  assert.equal(result.forced, true)
  assert.equal(await isPortListening(owned.port), false)
  assert.equal(await isPortListening(unrelated.port), true, 'unrelated application remains running')
})

test('an unproven remaining listener requests preservation instead of deleting live files', async t => {
  const unrelated = await fixture(t)
  const owned = await fixture(t)
  await assert.rejects(
    shutdownDesktopProcess({
      child: owned.child,
      quit: () => owned.child.send('quit'),
      ports: [unrelated.port],
      timeoutMs: 1000,
      terminationTimeoutMs: 200,
    }),
    error => error.preserveInstallerWorkspace === true,
  )
  assert.equal(await isPortListening(unrelated.port), true)
})
