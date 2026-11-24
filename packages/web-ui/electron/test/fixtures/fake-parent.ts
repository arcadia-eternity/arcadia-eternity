import assert from 'node:assert/strict'
import { LocalBattleHost } from '../../local-battle-host.ts'
const [, , cli, directory] = process.argv
const host = new LocalBattleHost({
  executable: process.execPath,
  cli,
  rendererOrigin: 'http://localhost:5173',
  attachWorkspace: child => {
    child.send({ directory })
    return () => {}
  },
})
const result = await host.start(directory)
assert.equal(result.status, 'running')
console.log(result.url)
// Simulate a desktop process killed before its normal before-quit handler.
process.exit(0)
