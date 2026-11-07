import { LocalBattleHost } from '../../local-battle-host.mjs'
const [, , cli, directory] = process.argv
const host = new LocalBattleHost({ executable: process.execPath, cli, rendererOrigin: 'http://localhost:5173' })
const result = await host.start(directory)
console.log(result.url)
// Simulate a desktop process killed before its normal before-quit handler.
process.exit(0)
