import { join } from 'node:path'
import { fileWorkshopTrustStore } from '@arcadia-eternity/pack-loader/node'
import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  assertGraphNotRevoked,
  resolveWorkshopRelease,
  revocationFor,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'
import { installAuthorEnvironment } from './author-environment-install.ts'
import { isRecord } from './types.ts'
import type { AuthorWorkspace } from './workspace.ts'
import { contentError } from './workspace-materials.ts'

type ClientFactory = (workspace: AuthorWorkspace) => Pick<WorkshopClient, 'refresh' | 'cached'>

// Trust state lives in the author workspace so its rollback protection follows the project owner.
const defaultClient: ClientFactory = workspace =>
  new WorkshopClient({
    trustedRoot: OFFICIAL_WORKSHOP_ROOT,
    store: fileWorkshopTrustStore(join(workspace.root, '.arcadia', 'workshop-trust')),
  })

export function authorWorkshop(workspace: AuthorWorkspace, client: ClientFactory = defaultClient) {
  let instance: ReturnType<ClientFactory> | undefined
  const open = () => (instance ??= client(workspace))
  async function view(refresh: boolean, signal?: AbortSignal): Promise<WorkshopView> {
    const workshop = open()
    if (refresh) return workshop.refresh(signal)
    return (await workshop.cached()) ?? workshop.refresh(signal)
  }
  return {
    async list(input: unknown, signal?: AbortSignal) {
      if (!isRecord(input) || (input.refresh !== undefined && typeof input.refresh !== 'boolean'))
        throw contentError('INPUT_INVALID')
      const search = typeof input.search === 'string' ? input.search.trim().toLowerCase() : ''
      const kind = input.kind === 'package' || input.kind === 'environment' ? input.kind : undefined
      const current = await view(input.refresh === true, signal)
      const projects = current.index.projects
        .filter(project => !kind || project.kind === kind)
        .filter(
          project =>
            !search ||
            [project.id, project.npm, project.title, project.summary, ...project.tags].some(text =>
              text.toLowerCase().includes(search),
            ),
        )
        .map(project => ({
          id: project.id,
          kind: project.kind,
          npm: project.npm,
          title: project.title,
          summary: project.summary,
          official: project.official,
          repository: project.repository,
          versions: project.releases
            .filter(release => !revocationFor(current.index, project.npm, release.version))
            .map(release => ({ version: release.version, containsCode: release.containsCode })),
        }))
      return {
        registry: current.registry,
        snapshot: current.snapshot.version,
        freshness: current.freshness,
        ...(current.checkedAt && { checkedAt: current.checkedAt }),
        ...(current.error && { error: current.error }),
        projects,
      }
    },
    /** Install an environment release only when a fresh signed index lists it with the same archive digest. */
    async installEnvironment(input: unknown, signal?: AbortSignal) {
      if (!isRecord(input) || typeof input.name !== 'string' || typeof input.version !== 'string')
        throw contentError('INPUT_INVALID')
      const current = await view(true, signal)
      const target = resolveWorkshopRelease(current, input.name, input.version)
      if (target.project.kind !== 'environment')
        throw contentError('WORKSHOP_KIND_MISMATCH', '工坊项目不是环境，请在 package.json 声明为依赖')
      const result = await installAuthorEnvironment(
        workspace,
        { source: { kind: 'npm', name: input.name, version: input.version } },
        signal,
        {
          archive(acquired) {
            if (acquired.integrity !== target.release.integrity)
              throw contentError('WORKSHOP_INTEGRITY_MISMATCH', 'npm 归档与工坊索引记录不一致')
          },
          graph: packages => assertGraphNotRevoked(current, packages),
        },
      )
      return { ...result, registry: target.registry, snapshot: current.snapshot.version }
    },
  }
}
