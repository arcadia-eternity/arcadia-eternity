import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopHelp as usage } from './command-discovery.ts'
import type { WorkshopProject, WorkshopRevocation } from '@arcadia-eternity/pack-loader/workshop'
import { connectDesktopInstance, listDesktopInstances, type DesktopConnectionOptions } from './desktop-client.ts'

async function installSource(value: string, kind: 'pack' | 'environment') {
  // A valid npm prerelease or build tag may itself end in .tgz or .zip.
  const { parseAuthorEnvironmentNpmSpec } = await import('./author-environment-source.ts')
  try {
    parseAuthorEnvironmentNpmSpec(value)
    return { kind: 'npm' as const, spec: value }
  } catch (error) {
    if (!/\.(?:tgz|zip)$/i.test(value)) throw error
  }
  if (kind === 'environment' && /\.zip$/i.test(value)) throw new Error('Select a .tgz environment archive.')
  const file = resolve(value)
  if (!(await lstat(file)).isFile()) throw new Error('Select a regular archive file.')
  return { kind: 'archive' as const, file }
}

export async function desktopCommand(args: string[], options: DesktopConnectionOptions = {}) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      instance: { type: 'string' },
      id: { type: 'string' },
      'allow-download': { type: 'boolean' },
      registry: { type: 'string' },
      refresh: { type: 'boolean' },
    },
  })
  const [group, operation, source] = positionals
  if (group === 'workshop') return workshopCommand(values, positionals.slice(1), options)
  if (values.registry !== undefined || values.refresh) throw new Error(usage)
  const discovery = group === 'instances' && positionals.length === 1 && Object.keys(values).length === 0
  const installing = operation === 'install'
  if (
    !discovery &&
    ((group !== 'packages' && group !== 'environments') ||
      (installing ? positionals.length !== 3 : operation !== 'list' || positionals.length !== 2) ||
      (values.id !== undefined &&
        (!installing ||
          group !== 'environments' ||
          !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(values.id) ||
          values.id === 'default')) ||
      (!installing && values['allow-download']))
  )
    throw new Error(usage)
  if (discovery) return { instances: await listDesktopInstances(options) }
  const instance = await connectDesktopInstance(values.instance, options)
  const kind = group === 'packages' ? 'pack' : 'environment'
  if (!installing) {
    const result = await instance.request({ operation: 'list', kind })
    if (!Array.isArray(result[group])) throw new Error('The desktop instance returned an invalid library listing.')
    return group === 'packages'
      ? { packages: result.packages }
      : { environments: result.environments, selectedEnvironmentId: result.selectedEnvironmentId }
  }
  return instance.request({
    operation: 'install',
    kind,
    source: await installSource(source, kind),
    offline: !values['allow-download'],
    ...(values.id && { environmentId: values.id }),
  })
}

interface WorkshopView {
  registry: string
  freshness: 'fresh' | 'stale'
  checkedAt?: string
  snapshot: number
  error?: { code: string; message: string }
  revocations: WorkshopRevocation[]
  revokedInstalled: unknown[]
}
const environmentId = /^[a-z0-9][a-z0-9_-]{0,79}$/

async function workshopCommand(
  values: { instance?: string; id?: string; registry?: string; refresh?: boolean; 'allow-download'?: boolean },
  [operation, spec, ...extra]: string[],
  options: DesktopConnectionOptions,
) {
  const registry = values.registry
  if (
    extra.length ||
    values['allow-download'] ||
    (registry !== undefined && !/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/.test(registry)) ||
    (operation === 'registries' && (spec !== undefined || registry !== undefined || values.refresh)) ||
    (operation === 'list' && spec !== undefined) ||
    (operation !== 'install' && values.id !== undefined) ||
    (operation === 'install' &&
      (!spec ||
        values.refresh ||
        (values.id !== undefined && (!environmentId.test(values.id) || values.id === 'default')))) ||
    !['registries', 'list', 'install'].includes(operation)
  )
    throw new Error(usage)
  const instance = await connectDesktopInstance(values.instance, options)
  const scope = registry === undefined ? {} : { registry }
  if (operation === 'registries') return instance.request({ operation: 'workshop', action: 'registries' })
  if (operation === 'list') {
    const view = (await instance.request({
      operation: 'workshop',
      action: values.refresh ? 'refresh' : 'view',
      ...scope,
    })) as Partial<Omit<WorkshopView, 'projects'>> & { projects?: WorkshopProject[] }
    if (!Array.isArray(view.projects)) throw new Error('The desktop instance returned an invalid workshop index.')
    const revoked = new Set(
      (Array.isArray(view.revocations) ? view.revocations : []).map(item => `${item.npm}@${item.version}`),
    )
    // Releases are listed newest first in the signed index.
    return {
      registry: view.registry,
      freshness: view.freshness,
      checkedAt: view.checkedAt,
      snapshot: view.snapshot,
      ...(view.error ? { error: view.error } : {}),
      projects: view.projects.map(project => ({
        id: project.id,
        kind: project.kind,
        npm: project.npm,
        title: project.title,
        summary: project.summary,
        official: project.official,
        repository: project.repository,
        versions: project.releases
          .filter(release => !revoked.has(`${project.npm}@${release.version}`) && !revoked.has(`${project.npm}@*`))
          .map(release => release.version),
        containsCode: project.releases.some(release => release.containsCode),
      })),
      revokedInstalled: view.revokedInstalled,
    }
  }
  const at = spec.lastIndexOf('@')
  if (at <= 0) throw new Error('Specify the exact release as <npm-name>@<version>.')
  return instance.request({
    operation: 'workshop',
    action: 'install',
    ...scope,
    npm: spec.slice(0, at),
    version: spec.slice(at + 1),
    ...(values.id && { environmentId: values.id }),
  })
}

export async function desktopCli(args: string[]) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) console.log(usage)
  else console.log(JSON.stringify(await desktopCommand(args)))
}
