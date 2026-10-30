#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openAuthorSession } from './author-api.mjs'
import { diagnostic } from './workspace.mjs'

const [directory, ...flags] = process.argv.slice(2)
if (!directory || flags.some(flag => !['--execute', '--read-only'].includes(flag))) {
  process.stderr.write('Usage: arcadia-content-mcp <project-directory> [--execute] [--read-only]\n')
  process.exit(1)
}
const session = await openAuthorSession(directory, {
  execute: flags.includes('--execute'),
  readOnly: flags.includes('--read-only'),
})
const server = new McpServer({ name: 'arcadia-content-authoring', version: '0.1.0' })
const outputSchema = { result: z.unknown() }
function tool(name, description, inputSchema, operation, transform = input => input, readOnly = false) {
  server.registerTool(
    name,
    { description, inputSchema, outputSchema, annotations: { readOnlyHint: readOnly } },
    async input => {
      try {
        const result = await session.call(operation, transform(input))
        return { content: [{ type: 'text', text: JSON.stringify({ result }) }], structuredContent: { result } }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: diagnostic(error) }) }] }
      }
    },
  )
}
tool(
  'workspace_describe',
  'Read the bound project identity, source revision, SDK and execution capabilities without importing project code.',
  {},
  'describe',
  undefined,
  true,
)
tool(
  'content_query',
  'Search content, source files, asset usages or diagnostics. Results are paginated.',
  {
    kind: z.enum(['content', 'assets', 'files', 'locales', 'diagnostics']).optional(),
    search: z.string().max(200).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  'query',
  undefined,
  true,
)
tool(
  'source_read',
  'Read one project source file and its current version. Generated directories are excluded.',
  { file: z.string().max(1000) },
  'read',
  undefined,
  true,
)
if (!flags.includes('--read-only'))
  tool(
    'source_apply',
    'Save one source file only if its version still matches. Null expects a new file. Re-read on conflict; no automatic merge.',
    {
      file: z.string().max(1000),
      expectedVersion: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      text: z.string().max(2 * 1024 * 1024),
    },
    'write',
  )
if (!flags.includes('--read-only'))
  tool(
    'content_apply',
    'Save reviewed existing content records or name/description entries. Query sources first. Keeps YAML sharing read-only, checks source versions and groups edits per file. Inspect complete and every result; partial writes are not rolled back.',
    {
      changes: z
        .array(
          z.object({
            kind: z.enum(['record', 'locale']),
            file: z.string().max(1000),
            expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
            index: z.number().int().min(0).nullable().optional(),
            id: z.string().optional(),
            record: z.record(z.unknown()),
          }),
        )
        .min(1)
        .max(1000),
    },
    'save',
  )
for (const [name, kind] of [
  ['check_start', 'check'],
  ['test_start', 'test'],
  ['preview_start', 'demo'],
  ['package_build', 'pack'],
]) {
  if (kind !== 'check' && !flags.includes('--execute')) continue
  tool(
    name,
    kind === 'demo'
      ? 'Build, install an isolated real package and run its configured headless demonstration battle. Does not start multiplayer hosting.'
      : `Start ${kind}; poll job_get for actual output and stale-source state.`,
    {
      sourceRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    },
    'start',
    input => ({ ...input, kind }),
  )
}
tool('job_get', 'Read bounded task output, diagnostics and final state.', { jobId: z.string() }, 'job', undefined, true)
tool(
  'job_cancel',
  'Cancel a task and terminate its child process group; source files are retained.',
  { jobId: z.string() },
  'cancel',
)
server.registerResource('workspace', 'arcadia://workspace/summary', { mimeType: 'application/json' }, async uri => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await session.describe()) }],
}))
let closing = false
async function close() {
  if (closing) return
  closing = true
  await session.close()
  await server.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
process.stdin.once('end', close)
await server.connect(new StdioServerTransport())
