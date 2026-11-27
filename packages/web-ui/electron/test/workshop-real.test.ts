import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.ts'
import { ContentLibrary } from '../content-library.ts'
import { LocalEnvironments } from '../local-environments.ts'
import { runContentCommand } from '../content-projects.ts'
import { DesktopWorkshop } from '../workshop.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

test(
  'installs official releases from the live signed registry and npm',
  { timeout: 600000, skip: process.env.ARCADIA_LIVE_WORKSHOP !== '1' },
  async t => {
    const { acquireAuthorEnvironment, parseAuthorEnvironmentNpmSpec } =
      await import('@arcadia-eternity/content-sdk/management-workspace')
    const { validateWorkspaceProject } = await import('@arcadia-eternity/server')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-workshop-live-'))
    const runtime = {
      executable: process.execPath,
      cli: join(repository, 'dist/cli.js'),
      npmCacheDirectory: join(root, 'npm'),
    }
    const library = new ContentLibrary({
      root: join(root, 'library'),
      run: (args, signal) => runContentCommand(runtime, args, signal),
      host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
      reviewInstall: () => true,
      authorizeEnvironment: () => true,
    })
    const environments = new LocalEnvironments({
      openWorkspace: () => ContentWorkspace.open(join(root, 'personal')),
      library: { prepareEnvironmentProject: library.prepareEnvironmentProject.bind(library) },
      acquireRecipe: (source, destination, options) =>
        acquireAuthorEnvironment(
          source.kind === 'npm' ? parseAuthorEnvironmentNpmSpec(source.spec) : source,
          destination,
          { ...options, cache: join(root, 'recipe-cache') },
        ),
      validate: validateWorkspaceProject,
    })
    t.after(async () => {
      await environments.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    })
    const workshop = new DesktopWorkshop({
      directory: join(root, 'workshop'),
      host: {
        listPackages: async () => (await library.list()).packages,
        installPackage: (spec, verify) => library.installNpm(spec, false, verify),
        installEnvironment: (spec, environmentId, verify, verifyGraph) =>
          environments.installRecipe(
            { kind: 'npm', spec },
            { ...(environmentId && { environmentId }), allowDownload: true, verify, verifyGraph },
          ),
      },
    })
    const view = await workshop.request({ action: 'refresh' })
    assert.ok('projects' in view)
    assert.equal(view.freshness, 'fresh', JSON.stringify(view.error))
    const env = view.projects.find(project => project.id === 'official.training-120')!
    const latest = env.releases[0].version
    const started = await workshop.request({
      action: 'install',
      npm: env.npm,
      version: latest,
      environmentId: 'training',
    })
    assert.ok('operationId' in started)
    const job = await environments.waitForOperation(started.operationId).catch(error => error)
    assert.ok(!(job instanceof Error), String(job?.code) + ' ' + String(job?.message))
    assert.equal((job as { environmentId: string }).environmentId, 'training')
  },
)
