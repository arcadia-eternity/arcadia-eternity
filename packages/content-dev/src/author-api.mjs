import { AuthorWorkspace, WorkspaceError } from './workspace.mjs'
import { readWorkbenchContext } from './workbench-context.mjs'
import { AuthorJobs } from './jobs.mjs'
export { createSourceProject, connectDevelopmentSdk, authorConnection } from './project.mjs'

/** Shared operations for the desktop, CLI and MCP adapters. */
export async function openAuthorSession(directory, options = {}) {
  const workspace = await AuthorWorkspace.open(directory, options)
  const jobs = new AuthorJobs(workspace, options)
  return {
    workspace,
    jobs,
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
    async query({ kind = 'content', search = '', offset = 0, limit = 50 } = {}) {
      const snapshot = await workspace.snapshot()
      const rows =
        kind === 'assets'
          ? snapshot.assets
          : kind === 'files'
            ? snapshot.files
            : kind === 'locales'
              ? snapshot.localeSources
              : kind === 'diagnostics'
                ? snapshot.diagnostics
                : ['presentations', 'resources'].includes(kind)
                  ? snapshot.records.filter(row => row.kind === kind)
                  : snapshot.records
      const filtered = rows.filter(row => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()))
      return { total: filtered.length, offset, items: filtered.slice(offset, offset + Math.min(limit, 100)) }
    },
    async call(operation, input = {}) {
      switch (operation) {
        case 'context':
          return readWorkbenchContext(options.contextFile, workspace.root)
        case 'describe':
          return this.describe()
        case 'query':
          return this.query(input)
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
          return jobs.get(input.jobId)
        case 'cancel':
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
