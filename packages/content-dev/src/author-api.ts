import { DebugEnvironments } from './debug-environments.ts'
import { ProjectTeams } from './project-teams.ts'
import {
  AuthorWorkspace,
  WorkspaceError,
  type SaveChangesInput,
  type WorkspaceOptions,
  type WriteInput,
} from './workspace.ts'
import { readWorkbenchContext } from './workbench-context.ts'
import { AuthorJobs } from './jobs.ts'
import { queryContent } from './content-query.ts'
import { authorReference } from './author-reference.ts'
import { inspectAsset } from './asset-inspect.ts'
import { callPreviewControl } from './preview-control.ts'
import { isRecord, type UnknownRecord } from './types.ts'
export { createSourceProject, connectDevelopmentSdk, authorConnection } from './project.ts'
export { ContentWorkspace } from './content-workspace.ts'
export { normalizeEnvironmentDocument } from './debug-environments.ts'

export interface AuthorSessionOptions extends WorkspaceOptions {
  execute?: boolean
  contextFile?: string
  env?: NodeJS.ProcessEnv
  executable?: string
}

/** Shared operations for the desktop, CLI and MCP adapters. */
export async function openAuthorSession(directory: string, options: AuthorSessionOptions = {}) {
  const workspace = await AuthorWorkspace.open(directory, options)
  const jobs = new AuthorJobs(workspace, options)
  await jobs.initialize()
  return {
    workspace,
    jobs,
    teams: new ProjectTeams(workspace),
    environments: new DebugEnvironments(workspace),
    async describe() {
      const snapshot = await workspace.snapshot()
      return {
        protocolVersion: 1,
        root: snapshot.root,
        name: snapshot.name,
        project: snapshot.project,
        sourceRevision: await workspace.revision(),
        capabilities: { ...snapshot.capabilities, codeExecution: !workspace.readOnly && jobs.execute },
        diagnostics: snapshot.diagnostics,
      }
    },
    async query(input: UnknownRecord = {}) {
      return queryContent(workspace, input)
    },
    async call(operation: string, input: unknown = {}) {
      if (!isRecord(input)) throw new WorkspaceError('INPUT_INVALID', '操作参数需要对象')
      switch (operation) {
        case 'context':
          return readWorkbenchContext(options.contextFile, workspace.root)
        case 'describe':
          return this.describe()
        case 'query':
          return this.query(input)
        case 'reference':
          return authorReference(input as { topic?: string })
        case 'asset-inspect':
          return inspectAsset(workspace, input as Parameters<typeof inspectAsset>[1])
        case 'snapshot':
          return workspace.snapshot()
        case 'read':
          return workspace.read(field(input, 'file'))
        case 'write':
          if (options.readOnly) throw new WorkspaceError('WRITE_DISABLED', '此会话为只读')
          return workspace.write(input as unknown as WriteInput)
        case 'save':
          if (options.readOnly) throw new WorkspaceError('WRITE_DISABLED', '此会话为只读')
          return workspace.saveChanges(input as unknown as SaveChangesInput)
        case 'start':
          return jobs.start(input as unknown as Parameters<typeof jobs.start>[0])
        case 'job':
          await jobs.refresh()
          return jobs.get(field(input, 'jobId'))
        case 'jobs':
          await jobs.refresh()
          return jobs.list()
        case 'job-query':
          return jobs.queryJob(input as unknown as Parameters<typeof jobs.queryJob>[0])
        case 'jobs-query':
          return jobs.queryJobs(input)
        case 'job-output':
          return jobs.readJobOutput(input as unknown as Parameters<typeof jobs.readJobOutput>[0])
        case 'cancel-query': {
          const jobId = field(input, 'jobId')
          await jobs.refresh()
          await jobs.cancel(jobId)
          return jobs.queryJob({ jobId })
        }
        case 'team-list':
          return { items: await this.teams.list() }
        case 'team-save':
          return this.teams.save(input as unknown as Parameters<ProjectTeams['save']>[0])
        case 'team-remove': {
          const removal = input as unknown as { id: string; expectedVersion: string | null }
          await this.teams.remove(removal)
          return { id: removal.id, removed: true }
        }
        case 'environment-list':
          return { items: await this.environments.list() }
        case 'environment-save':
          return this.environments.save(input as unknown as Parameters<DebugEnvironments['save']>[0])
        case 'battle': {
          if (workspace.readOnly || !jobs.execute)
            throw new WorkspaceError('EXECUTION_DISABLED', '自动化对局需要可执行的作者会话。')
          await jobs.refresh()
          const job = jobs.get(field(input, 'jobId'))
          if (job.kind !== 'preview' || job.state !== 'succeeded' || !job.result?.preview?.endpoint)
            throw new WorkspaceError('PREVIEW_NOT_ACTIVE', '此任务没有运行中的试玩候选。')
          const { jobId: _jobId, operation: action, ...args } = input
          if (typeof action !== 'string') throw new WorkspaceError('INPUT_INVALID', '需要战斗操作')
          return callPreviewControl(job.result.preview.endpoint, action, args)
        }
        case 'cancel':
          await jobs.refresh()
          return jobs.cancel(field(input, 'jobId'))
        default:
          throw new WorkspaceError('OPERATION_INVALID', '不支持的作者操作')
      }
    },
    async close() {
      await jobs.close()
      await workspace.close()
    },
  }
}

function field(input: UnknownRecord, name: string): string {
  const value = input[name]
  if (typeof value !== 'string') throw new WorkspaceError('INPUT_INVALID', `${name} 需要字符串`)
  return value
}
