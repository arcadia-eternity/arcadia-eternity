import { z } from 'zod'
import { EnvironmentDocumentV2Schema } from './debug-environments.mjs'
export { referenceTopics } from './author-reference.mjs'

export const version = z.string().regex(/^[a-f0-9]{64}$/)
export const identifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)
export const record = z.record(z.string(), z.unknown())
const diagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    severity: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
  })
  .passthrough()
const saved = z.object({ file: z.string(), version })
const jobState = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'])
export const jobKind = z.enum(['check', 'test', 'demo', 'preview', 'pack'])
export { jobState }
const job = z
  .object({
    jobId: z.string(),
    kind: jobKind,
    state: jobState,
    stale: z.boolean(),
    sourceRevision: version,
    createdAt: z.number(),
    phase: z.string().optional(),
    outputCursor: z.number().int().optional(),
    diagnosticCount: z.number().int().optional(),
    diagnosticsTruncated: z.boolean().optional(),
    diagnostics: z.array(diagnosticSchema).optional(),
    result: z
      .object({
        preview: z
          .object({ endpoint: z.string(), clientPath: z.string(), url: z.string().optional() })
          .passthrough()
          .optional(),
        candidate: record.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
const page = item =>
  z
    .object({
      total: z.number().int(),
      offset: z.number().int(),
      nextOffset: z.number().int().nullable(),
      items: z.array(item),
    })
    .passthrough()
const team = z.object({ schemaVersion: z.literal(1), id: identifier, name: z.string(), team: z.array(record), version })
const legacyEnvironment = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string(),
  packages: z.record(z.string(), z.string()),
  sources: z.array(z.string()),
  version: version.nullable(),
})
const environment = z.discriminatedUnion('schemaVersion', [
  legacyEnvironment,
  EnvironmentDocumentV2Schema.extend({ version: version.nullable() }),
])

// Dynamic content and battle payloads keep their domain fields; the envelopes and
// control fields are explicit so clients can handle pagination, conflicts and jobs.
export const outputSchemas = {
  describe: z.object({
    protocolVersion: z.number(),
    root: z.string(),
    name: z.string(),
    project: record,
    sourceRevision: version,
    capabilities: record,
    diagnostics: z.array(diagnosticSchema),
  }),
  context: z.object({ connected: z.boolean(), reason: z.string().optional(), state: record.optional() }).passthrough(),
  query: page(
    z
      .object({
        kind: z.string(),
        scope: z.enum(['project', 'dependencies']),
        readOnly: z.boolean(),
        namespace: z.string(),
        packageName: z.string().optional(),
        id: z.string().optional(),
        qualifiedId: z.string().optional(),
        file: z.string().optional(),
        version: version.optional(),
        index: z.number().int().nullable().optional(),
        name: z.string().optional(),
        record: record.optional(),
      })
      .passthrough(),
  ).extend({ diagnostics: z.array(diagnosticSchema).optional() }),
  read: saved.extend({ text: z.string() }),
  write: saved,
  save: z.object({
    complete: z.boolean(),
    results: z.array(
      z.object({
        file: z.string(),
        saved: z.boolean(),
        version: version.optional(),
        diagnostic: diagnosticSchema.optional(),
      }),
    ),
  }),
  start: job,
  'job-query': job,
  'cancel-query': job,
  'jobs-query': page(job),
  'job-output': z.object({
    jobId: z.string(),
    text: z.string(),
    cursor: z.number().int(),
    nextCursor: z.number().int(),
    endCursor: z.number().int(),
    truncated: z.boolean(),
    hasMore: z.boolean(),
    unit: z.literal('utf16'),
  }),
  'team-list': z.object({ items: z.array(team) }),
  'team-save': team,
  'team-remove': z.object({ id: identifier, removed: z.literal(true) }),
  'environment-list': z.object({ items: z.array(environment) }),
  'environment-save': environment,
  reference: z.object({ topic: z.string(), title: z.string() }).passthrough(),
  'asset-inspect': z.object({ metadata: record }),
  battle: z
    .object({
      sessionId: z.string(),
      revision: z.number().int(),
      state: record.nullable().optional(),
      stateCurrent: z.boolean().optional(),
      failure: diagnosticSchema.optional(),
      selections: z.array(record).optional(),
      seed: z.string().optional(),
      teamIds: z.array(identifier).optional(),
      playerId: z.string().optional(),
      cursor: z.number().int().optional(),
      events: z.array(z.object({ cursor: z.number().int(), revision: z.number().int(), message: record })).optional(),
      nextCursor: z.number().int().optional(),
      hasMore: z.boolean().optional(),
      closed: z.boolean().optional(),
    })
    .passthrough(),
}
