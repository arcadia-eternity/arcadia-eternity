import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopHelp as usage } from './command-discovery.ts'
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
    },
  })
  const [group, operation, source] = positionals
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

export async function desktopCli(args: string[]) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) console.log(usage)
  else console.log(JSON.stringify(await desktopCommand(args)))
}
