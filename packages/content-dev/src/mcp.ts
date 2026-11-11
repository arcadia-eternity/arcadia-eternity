#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { openAuthorSession } from './author-api.ts'
import { diagnostic } from './workspace.ts'
import { identifier, version, record, outputSchemas, jobKind, jobState, referenceTopics } from './mcp-contracts.ts'
import { TeamDocumentSchema } from './project-teams.ts'
import { EnvironmentDocumentSchema } from './debug-environments.ts'
import { isRecord } from './types.ts'

const [directory, ...flags] = process.argv.slice(2)
let contextFile
const options = new Set()
for (let index = 0; index < flags.length; index++) {
  const flag = flags[index]
  if (flag === '--context-file' && flags[index + 1] && !flags[index + 1].startsWith('--')) contextFile = flags[++index]
  else if (['--execute', '--read-only', '--published'].includes(flag)) options.add(flag)
  else options.add('invalid')
}
if (!directory || options.has('invalid')) {
  process.stderr.write(
    'Usage: arcadia-content-mcp <project-directory> [--execute] [--read-only] [--context-file <file>] [--published]\n',
  )
  process.exit(1)
}
const session = await openAuthorSession(directory, {
  execute: options.has('--execute'),
  readOnly: options.has('--read-only'),
  contextFile,
  published: options.has('--published'),
})
const server = new McpServer({ name: 'arcadia-content-authoring', version: '0.1.0' })
type ToolOperation = keyof typeof outputSchemas
type ToolTransform = (input: Record<string, unknown>) => Record<string, unknown>
function tool(
  name: string,
  description: string,
  inputSchema: z.ZodRawShape,
  operation: ToolOperation,
  transform: ToolTransform = input => input,
  readOnly = false,
) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: { result: outputSchemas[operation] },
      annotations: { readOnlyHint: readOnly, ...(readOnly ? { destructiveHint: false, idempotentHint: true } : {}) },
    },
    async (input: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const value = await session.call(operation, transform(input))
        let result = value
        let image: ContentBlock | undefined
        if (operation === 'asset-inspect' && isRecord(value)) {
          const { image: inspectedImage, ...metadata } = value
          result = metadata
          if (
            isRecord(inspectedImage) &&
            inspectedImage.type === 'image' &&
            typeof inspectedImage.mimeType === 'string' &&
            typeof inspectedImage.data === 'string'
          )
            image = { type: 'image', mimeType: inspectedImage.mimeType, data: inspectedImage.data }
        }
        return {
          ...(operation === 'save' && isRecord(result) && !result.complete ? { isError: true } : {}),
          content: [
            { type: 'text', text: JSON.stringify({ result }) },
            ...(image ? [image] : []),
          ] satisfies ContentBlock[],
          structuredContent: { result },
        }
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
  'workspace_context',
  'Read live desktop context: current view, focused object/resource, language, unsaved drafts and external conflicts. No selection is required. Context is not an edit scope or authorization; follow the user request and query related content as needed. Draft values are unsaved and are not source revisions. Disconnected/expired context must not be treated as current. Re-read source versions before writes; external edits are reconciled by the desktop.',
  {},
  'context',
  undefined,
  true,
)
tool(
  'content_query',
  'Find content by stable ID or localized name. Defaults to concise project summaries; detail:full includes records for editing. Locales paginate individual entries. Dependency/all scope reads declared installed content without executing code; dependencies are read-only and their file paths belong to that dependency, not the bound project. Use file/version/index from full project rows for saves, never a translated name as identity.',
  {
    kind: z.enum(['content', 'presentations', 'resources', 'assets', 'files', 'locales', 'diagnostics']).optional(),
    search: z.string().max(200).optional(),
    id: z.string().max(200).optional(),
    contentKind: z.enum(['species', 'skills', 'marks', 'behaviors', 'presentations', 'resources']).optional(),
    locale: z.string().max(80).optional(),
    namespace: z.string().max(200).optional(),
    packageName: z.string().max(200).optional(),
    scope: z.enum(['project', 'dependencies', 'all']).optional(),
    detail: z.enum(['summary', 'full']).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  'query',
  undefined,
  true,
)
tool(
  'source_read',
  'Read one project source file and its current version. Generated directories are excluded except in read-only published-package sessions.',
  { file: z.string().max(1000) },
  'read',
  undefined,
  true,
)
if (!session.workspace.readOnly)
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
if (!session.workspace.readOnly)
  tool(
    'content_apply',
    'Save reviewed records or name/description entries. create-record uses a new data file and expectedVersion:null; new locale files also use null. Query sources first. Keeps YAML sharing read-only, checks versions and groups edits per file. Inspect complete and every result; partial writes are not rolled back.',
    {
      changes: z
        .array(
          z.object({
            kind: z.enum(['record', 'locale', 'create-record']),
            file: z.string().max(1000),
            expectedVersion: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            index: z.number().int().min(0).nullable().optional(),
            id: z.string().optional(),
            record: z.record(z.string(), z.unknown()),
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
  ['preview_start', 'preview'],
  ['package_build', 'pack'],
]) {
  if (session.workspace.readOnly) continue
  if (kind !== 'check' && !options.has('--execute')) continue
  tool(
    name,
    kind === 'preview'
      ? 'Build and install a captured npm candidate, then keep a local Node battle host ready for the full client. Poll job_get for preview.url or preview.clientPath. job_cancel stops it; new candidates do not replace existing battles.'
      : `Start ${kind}; poll job_get for actual output and stale-source state.`,
    {
      ...(kind === 'preview'
        ? {
            environmentId: z
              .string()
              .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)
              .optional(),
          }
        : {}),
      sourceRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    },
    'start',
    input => ({ ...input, kind }),
  )
}
tool(
  'job_list',
  'Discover current and retained project jobs across author sessions. Compact results omit logs. Reading never selects a task or opens a window.',
  {
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    state: jobState.optional(),
    kind: jobKind.optional(),
  },
  'jobs-query',
  undefined,
  true,
)
tool(
  'job_get',
  'Read task status, phase, diagnostics and candidate metadata. Logs are omitted by default. waitMs waits briefly for a change; afterCursor is the previously observed outputCursor. includeOutput returns only a bounded log chunk.',
  {
    jobId: z.string(),
    waitMs: z.number().int().min(0).max(10000).optional(),
    afterCursor: z.number().int().min(0).optional(),
    includeOutput: z.boolean().optional(),
    limit: z.number().int().min(1).max(65536).optional(),
  },
  'job-query',
  undefined,
  true,
)
tool(
  'job_output',
  'Read an incremental log chunk using UTF-16 code-unit cursors. Pass nextCursor on the next call. truncated reports a lost log prefix; hasMore means more retained output is available.',
  {
    jobId: z.string(),
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(65536).optional(),
  },
  'job-output',
  undefined,
  true,
)
tool(
  'job_cancel',
  'Cancel a task and terminate its child process group; source files are retained.',
  { jobId: z.string() },
  'cancel-query',
)
tool(
  'team_list',
  'Read saved project test teams and versions. These are not the user’s unsaved team drafts or current battle players.',
  {},
  'team-list',
  undefined,
  true,
)
tool(
  'environment_list',
  'Read saved named battle environments and versions. Reading or saving an environment does not select it in the desktop.',
  {},
  'environment-list',
  undefined,
  true,
)
if (!session.workspace.readOnly) {
  tool(
    'team_save',
    'Save a project team against its file version; null creates a new team. Does not overwrite desktop drafts, change selections or replace a running match. Conflicting user drafts remain available for reconciliation.',
    {
      document: TeamDocumentSchema,
      expectedVersion: version.nullable(),
    },
    'team-save',
  )
  tool(
    'team_remove',
    'Delete a saved project team only if its version matches. Existing battles and desktop drafts keep their copied values; automatic tests referencing this team will fail until updated.',
    {
      id: identifier,
      expectedVersion: version,
    },
    'team-remove',
  )
  tool(
    'environment_save',
    'Save a named environment against its version; null creates it. Does not install dependencies or change the user’s selected environment. Prepare a new preview to use the changed configuration.',
    {
      document: EnvironmentDocumentSchema,
      expectedVersion: version.nullable(),
    },
    'environment-save',
  )
}
tool(
  'author_reference',
  'Read the actual SDK schemas or focused authoring guidance. Schema notes distinguish normalized runtime definitions from source references. Description guidance covers current supported semantics, not future generic reference protocols.',
  {
    topic: z.enum(referenceTopics),
  },
  'reference',
  undefined,
  true,
)
tool(
  'asset_inspect',
  'Inspect one declared project resource by ID. Local images up to 2 MiB may be returned as standard image content when includeImage is true. MIME follows the filename; decoding/display is handled by the client. No dimensions or image integrity validation are provided. HTTP resources return metadata only and are never fetched or cached. Audio/SWF are not executed.',
  {
    id: z.string().min(1).max(200),
    includeImage: z.boolean().optional(),
  },
  'asset-inspect',
  undefined,
  true,
)

if (!session.workspace.readOnly && options.has('--execute')) {
  const battle = (name: string, description: string, schema: z.ZodRawShape, operation: string, readOnly = false) =>
    tool(name, description, { jobId: z.string(), ...schema }, 'battle', input => ({ ...input, operation }), readOnly)
  const identity = { sessionId: z.string() }
  const mutation = { ...identity, expectedRevision: z.number().int().min(0) }
  battle(
    'battle_create',
    'Create an isolated automation battle on an existing preview candidate using the latest saved team files and a fixed seed. Team-only edits do not require rebuilding the candidate. Never operates on the human preview battle or unsaved team drafts. At most four automation battles per preview.',
    {
      teamIds: z.tuple([identifier, identifier]),
      seed: z.string().min(1).max(200),
    },
    'create',
  )
  battle(
    'battle_read',
    'Read an automation battle state, revision and available selections. Use returned selections for actions; this does not read or change the human preview battle.',
    identity,
    'read',
    true,
  )
  battle(
    'battle_events',
    'Read bounded automation battle events after a cursor. Expired cursors are explicit errors; read state again to recover.',
    {
      ...identity,
      afterCursor: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    'events',
    true,
  )
  battle(
    'battle_action',
    'Submit one legal selection to an automation battle at the observed revision. Concurrent/stale actions are rejected. The user’s manual match is unaffected.',
    {
      ...mutation,
      selection: record,
    },
    'action',
  )
  battle(
    'battle_reset',
    'Reset only the named automation battle, checking its revision. Omit teams/seed to reuse its team IDs and seed; reset reads their latest saved files. Never resets the human match.',
    {
      ...mutation,
      teamIds: z.tuple([identifier, identifier]).optional(),
      seed: z.string().min(1).max(200).optional(),
    },
    'reset',
  )
  battle(
    'battle_close',
    'Release one isolated automation battle after checking its revision. Keeps the preview host and human match running.',
    mutation,
    'close',
  )
}
server.registerResource('workspace', 'arcadia://workspace/summary', { mimeType: 'application/json' }, async uri => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await session.describe()) }],
}))
for (const topic of referenceTopics)
  server.registerResource(
    `reference-${topic}`,
    `arcadia://authoring/${topic}`,
    { mimeType: 'application/json' },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await session.call('reference', { topic })),
        },
      ],
    }),
  )
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
