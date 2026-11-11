import { openAuthorSession } from './author-api.ts'
import { diagnostic } from './workspace.ts'

export async function workspaceCli(args) {
  const [directory, operation = 'describe', ...flags] = args
  let execute = false,
    environmentId
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === '--execute') execute = true
    else if (flags[index] === '--environment' && operation === 'preview' && flags[index + 1])
      environmentId = flags[++index]
    else throw new Error('Unknown workspace option; use --execute or preview --environment <id>')
  }
  if (!directory)
    throw new Error(
      'Usage: arcadia-content workspace <directory> <operation> [--execute] [--environment <id>]. JSON input on stdin for query/read/write/save.',
    )
  const session = await openAuthorSession(directory, { watch: false, execute })
  const cancel = () => session.close()
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)
  try {
    let result
    if (['check', 'test', 'demo', 'preview', 'pack'].includes(operation)) {
      let job = await session.jobs.start({ kind: operation, ...(environmentId ? { environmentId } : {}) })
      while (['queued', 'running'].includes(job.state)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        job = session.jobs.get(job.jobId)
      }
      result = job
      if (job.state !== 'succeeded' || job.stale) process.exitCode = 1
      if (operation === 'preview' && job.state === 'succeeded' && !job.stale) {
        console.log(JSON.stringify({ result: job }))
        while (!session.jobs.closed && session.jobs.get(job.jobId).state === 'succeeded')
          await new Promise(resolve => setTimeout(resolve, 100))
        const final = session.jobs.get(job.jobId)
        console.log(JSON.stringify({ result: final }))
        if (final.state === 'failed') process.exitCode = 1
        return
      }
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
