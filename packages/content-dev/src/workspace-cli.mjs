import { openAuthorSession } from './author-api.mjs'
import { diagnostic } from './workspace.mjs'

export async function workspaceCli(args) {
  const [directory, operation = 'describe', ...flags] = args
  if (!directory || flags.some(flag => flag !== '--execute'))
    throw new Error(
      'Usage: arcadia-content workspace <directory> <describe|query|read|write|save|check|test|demo|pack> [--execute]. JSON input on stdin for query/read/write/save.',
    )
  const session = await openAuthorSession(directory, { watch: false, execute: flags.includes('--execute') })
  const cancel = () => session.close()
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)
  try {
    let result
    if (['check', 'test', 'demo', 'pack'].includes(operation)) {
      let job = await session.jobs.start({ kind: operation })
      while (['queued', 'running'].includes(job.state)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        job = session.jobs.get(job.jobId)
      }
      result = job
      if (job.state !== 'succeeded' || job.stale) process.exitCode = 1
    } else {
      let input = ''
      if (operation !== 'describe')
        for await (const chunk of process.stdin) {
          input += chunk
          if (Buffer.byteLength(input) > 3 * 1024 * 1024) throw new Error('JSON input exceeds 3 MiB')
        }
      result = await session.call(operation, input ? JSON.parse(input) : {})
      if (operation === 'save' && !result.complete) process.exitCode = 1
    }
    console.log(JSON.stringify({ result }))
  } catch (error) {
    console.log(JSON.stringify({ error: diagnostic(error) }))
    process.exitCode = 1
  } finally {
    process.removeListener('SIGTERM', cancel)
    process.removeListener('SIGINT', cancel)
    await session.close()
  }
}
