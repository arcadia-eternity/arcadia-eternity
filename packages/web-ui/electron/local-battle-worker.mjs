import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

// Electron's embedded Node runs the same CLI as a local Node host. Parent loss
// must not leave an authority process running after the desktop app exits.
const [, , cli, ...argumentsForCli] = process.argv
if (!cli || !process.connected) throw new Error('Desktop authority requires its parent process')
process.argv = [process.execPath, cli, ...argumentsForCli]
let shuttingDown = false
const cleanupDir = process.env.ARCADIA_DESKTOP_TEMP
process.once('exit', () => {
  try {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true })
  } catch {
    /* Parent also cleans up. */
  }
})
process.once('disconnect', () => {
  if (!shuttingDown) {
    process.kill(process.pid, 'SIGTERM')
    setTimeout(() => process.exit(1), 5000).unref()
  }
})
process.once('SIGTERM', () => {
  shuttingDown = true
  if (process.connected) process.disconnect()
  // The CLI may not have installed its own shutdown handler yet.
  if (process.listenerCount('SIGTERM') === 0) process.exit(0)
})
await import(pathToFileURL(cli).href)
// A CLI startup failure returns a nonzero exit code without creating a server.
// Do not keep that failed process alive solely through the parent IPC channel.
if (process.exitCode && process.connected) {
  shuttingDown = true
  process.disconnect()
}
