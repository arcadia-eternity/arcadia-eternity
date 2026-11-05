import { execFile } from 'node:child_process'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

export async function bounded(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function isPortListening(port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(port) })
    const finish = (error, value) => {
      socket.destroy()
      error ? reject(error) : resolve(value)
    }
    socket.once('connect', () => finish(undefined, true))
    socket.once('error', error => (error.code === 'ECONNREFUSED' ? finish(undefined, false) : finish(error)))
    socket.setTimeout(timeoutMs, () => finish(new Error(`Could not establish whether listener ${port} stopped`)))
  })
}

async function listenersClosed(ports, milliseconds) {
  const deadline = performance.now() + milliseconds
  let pending = ports
  while (pending.length) {
    const stillOpen = []
    for (const port of pending) {
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new Error(`Owned listener ${port} remains open after termination deadline`)
      try {
        if (await isPortListening(port, Math.max(1, Math.min(2000, Math.ceil(remaining))))) stillOpen.push(port)
      } catch (error) {
        // A reset during process teardown is inconclusive. Probe again until a
        // connection is refused; never accept a reset as proof of termination.
        if (error.code !== 'ECONNRESET') throw error
        stillOpen.push(port)
      }
    }
    pending = stillOpen
    if (pending.length) await delay(Math.max(1, Math.min(25, deadline - performance.now())))
  }
}

async function exited(child, milliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return
  let listener
  try {
    await bounded(
      new Promise(resolve => {
        listener = resolve
        child.once('exit', listener)
      }),
      milliseconds,
      'Owned desktop process did not exit',
    )
  } finally {
    if (listener) child.removeListener('exit', listener)
  }
}

/** Playwright starts Electron in a detached POSIX process group. Its PID is
 * captured from the returned ChildProcess, never discovered by product name.
 * On Windows taskkill /T is restricted to that same owned child PID. */
export async function shutdownDesktopProcess({
  child,
  quit,
  ports = [],
  timeoutMs = 30000,
  terminationTimeoutMs = 10000,
}) {
  if (!Number.isInteger(child?.pid) || child.pid <= 1) throw new Error('Owned desktop child identity is required')
  const listeners = [...new Set(ports.filter(value => value !== undefined).map(Number))]
  if (listeners.some(value => !Number.isInteger(value) || value < 1 || value > 65535))
    throw new Error('Invalid owned listener port')
  if (![timeoutMs, terminationTimeoutMs].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Process shutdown timeouts must be positive and finite')
  let forced = false
  try {
    if (child.exitCode === null && child.signalCode === null) {
      await bounded(
        Promise.resolve()
          .then(quit)
          .catch(() => {}),
        Math.min(timeoutMs, 2000),
        'Desktop quit request timed out',
      ).catch(() => {})
      await exited(child, timeoutMs)
    }
    await listenersClosed(listeners, timeoutMs)
  } catch {
    forced = true
    try {
      if (process.platform === 'win32') {
        await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          timeout: 10000,
          windowsHide: true,
        })
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      // The launcher exit event does not establish that every descendant has
      // finished exiting. Observe both conditions within the bounded window.
      await Promise.all([exited(child, terminationTimeoutMs), listenersClosed(listeners, terminationTimeoutMs)])
    } catch (cause) {
      const error = new Error(
        `Cannot prove desktop process tree ${child.pid} stopped; preserve its installation and profile`,
        { cause },
      )
      error.preserveInstallerWorkspace = true
      throw error
    }
  }
  return { forced, exitCode: child.exitCode, exitSignal: child.signalCode }
}
