import { DebugEnvironments } from './debug-environments.mjs'
import { ProjectTeams } from './project-teams.mjs'
import { AuthorWorkspace, WorkspaceError } from './workspace.mjs'
import { readWorkbenchContext } from './workbench-context.mjs'
import { AuthorJobs } from './jobs.mjs'
import { queryContent } from './content-query.mjs'
import { authorReference } from './author-reference.mjs'
import { inspectAsset } from './asset-inspect.mjs'
import { callPreviewControl } from './preview-control.mjs'
export { createSourceProject, connectDevelopmentSdk, authorConnection } from './project.mjs'
export { ContentWorkspace } from './content-workspace.mjs'
export { normalizeEnvironmentDocument } from './debug-environments.mjs'

/** Shared operations for the desktop, CLI and MCP adapters. */
export async function openAuthorSession(directory, options = {}) {
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
    async query(input = {}) {
      return queryContent(workspace, input)
    },
    async call(operation, input = {}) {
      switch (operation) {
        case 'context':
          return readWorkbenchContext(options.contextFile, workspace.root)
        case 'describe':
          return this.describe()
        case 'query':
          return this.query(input)
        case 'reference':
          return authorReference(input)
        case 'asset-inspect':
          return inspectAsset(workspace, input)
        case 'snapshot':
          return workspace.snapshot()
        case 'read':
          return workspace.read(input.file)
        case 'write':
          if (options.readOnly) throw new WorkspaceError('WRITE_DISABLED', '此会话为只读')
          return workspace.write(input)
        case 'save':
          if (options.readOnly) throw new WorkspaceError('WRITE_DISABLED', '此会话为只读')
          return workspace.saveChanges(input)
        case 'start':
          return jobs.start(input)
        case 'job':
          await jobs.refresh()
          return jobs.get(input.jobId)
        case 'jobs':
          await jobs.refresh()
          return jobs.list()
        case 'job-query':
          return jobs.queryJob(input)
        case 'jobs-query':
          return jobs.queryJobs(input)
        case 'job-output':
          return jobs.readJobOutput(input)
        case 'cancel-query':
          await jobs.refresh()
          await jobs.cancel(input.jobId)
          return jobs.queryJob({ jobId: input.jobId })
        case 'team-list':
          return { items: await this.teams.list() }
        case 'team-save':
          return this.teams.save(input)
        case 'team-remove':
          await this.teams.remove(input)
          return { id: input.id, removed: true }
        case 'environment-list':
          return { items: await this.environments.list() }
        case 'environment-save':
          return this.environments.save(input)
        case 'battle': {
          if (workspace.readOnly || !jobs.execute)
            throw new WorkspaceError('EXECUTION_DISABLED', '自动化对局需要可执行的作者会话。')
          await jobs.refresh()
          const job = jobs.get(input.jobId)
          if (job.kind !== 'preview' || job.state !== 'succeeded' || !job.result?.preview?.endpoint)
            throw new WorkspaceError('PREVIEW_NOT_ACTIVE', '此任务没有运行中的试玩候选。')
          const { jobId: _jobId, operation: action, ...args } = input
          return callPreviewControl(job.result.preview.endpoint, action, args)
        }
        case 'cancel':
          await jobs.refresh()
          return jobs.cancel(input.jobId)
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
