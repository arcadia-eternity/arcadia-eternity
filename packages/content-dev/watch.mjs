import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { watch } from 'chokidar'

const exec = promisify(execFile)

/** Serialize rebuilds and retain changes received while a build is running. */
export async function watchContentDev(
  directory = fileURLToPath(new URL('.', import.meta.url)),
  { onBuild = () => console.log('Built content-dev'), onError = console.error } = {},
) {
  let requested = 0
  let completed = 0
  let active
  let closed = false
  const watcher = watch(
    [
      'src',
      'template',
      'build.mjs',
      'tsconfig.json',
      '../../docs/guides/ugc-authoring-agent',
      '../../docs/guides/seer2-recreate-pet',
    ].map(path => resolve(directory, path)),
    { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 } },
  )
  function rebuild() {
    if (closed) return
    requested++
    active ??= (async () => {
      while (!closed && completed !== requested) {
        const revision = requested
        try {
          await exec(process.execPath, [resolve(directory, 'build.mjs')], { cwd: directory })
          onBuild()
        } catch (error) {
          onError(error)
        }
        completed = revision
      }
    })().finally(() => {
      active = undefined
    })
    return active
  }
  watcher.on('all', rebuild)
  watcher.on('error', onError)
  try {
    await once(watcher, 'ready')
    await rebuild()
  } catch (error) {
    await watcher.close()
    throw error
  }
  return {
    async close() {
      closed = true
      await watcher.close()
      await active
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const watcher = await watchContentDev()
  const close = () => {
    void watcher.close().catch(error => {
      console.error(error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
