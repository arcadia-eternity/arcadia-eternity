import { readdir, readFile, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackLoader } from '@arcadia-eternity/pack-loader'
import type { InstalledPack, PackInstallRequest, PackLoadResult, PackLockfile, PackManager, PackResolveResult } from '@arcadia-eternity/pack-loader'

const execFileAsync = promisify(execFile)

interface PackageJsonLike {
  name?: string
  version?: string
  arcadiaEternityPack?: string
  arcadiaEternityAssets?: string
}

interface PackManifestLike {
  id: string
  version: string
}

type InstallRunner = (specifier: string, workspaceRoot: string) => Promise<void>

export class ServerPackManager implements PackManager {
  private readonly loader = new PackLoader()
  private readonly workspaceRoot: string
  private readonly installRunner: InstallRunner

  constructor(workspaceRoot?: string, installRunner?: InstallRunner) {
    this.workspaceRoot = workspaceRoot ?? this.detectWorkspaceRoot()
    this.installRunner = installRunner ?? defaultInstallRunner
  }

  async listInstalled(): Promise<InstalledPack[]> {
    const packageJsonPaths = await this.findCandidatePackageJsonPaths()
    const installed: InstalledPack[] = []

    for (const packageJsonPath of packageJsonPaths) {
      const pkg = await this.readPackageJson(packageJsonPath)
      if (!pkg) continue
      const packageRoot = dirname(packageJsonPath)

      if (pkg.arcadiaEternityPack) {
        const manifest = await this.readManifest(resolve(packageRoot, pkg.arcadiaEternityPack))
        if (manifest) {
          installed.push({
            packageName: pkg.name,
            id: manifest.id,
            version: manifest.version,
            kind: 'data',
            source: this.isWorkspacePackRoot(packageRoot) ? 'workspace' : 'npm',
            entry: basename(pkg.arcadiaEternityPack),
            root: packageRoot,
            resolved: resolve(packageRoot, pkg.arcadiaEternityPack),
          })
        }
      }

      if (pkg.arcadiaEternityAssets) {
        const manifest = await this.readManifest(resolve(packageRoot, pkg.arcadiaEternityAssets))
        if (manifest) {
          installed.push({
            packageName: pkg.name,
            id: manifest.id,
            version: manifest.version,
            kind: 'asset',
            source: this.isWorkspacePackRoot(packageRoot) ? 'workspace' : 'npm',
            entry: basename(pkg.arcadiaEternityAssets),
            root: packageRoot,
            resolved: resolve(packageRoot, pkg.arcadiaEternityAssets),
          })
        }
      }
    }

    return installed
  }

  async has(packageKey: string): Promise<boolean> {
    const installed = await this.listInstalled()
    return installed.some(pack => `/${pack.id}@${pack.version}` === packageKey)
  }

  async verify(lockfile: PackLockfile): Promise<PackResolveResult> {
    const installed = await this.listInstalled()
    const missing: PackResolveResult['missing'] = []
    const conflicts: string[] = []

    for (const [packageKey, snapshot] of Object.entries(lockfile.packages)) {
      const match = installed.find(pack => pack.id === snapshot.name && pack.version === snapshot.version && pack.kind === snapshot.kind)
      if (!match) {
        missing.push({
          name: snapshot.name,
          packageKey,
          source: snapshot.source,
        })
        continue
      }
      if (snapshot.entry !== match.entry) {
        conflicts.push(`entry mismatch for '${snapshot.name}': lock=${snapshot.entry}, installed=${match.entry}`)
      }
    }

    return {
      lockfile,
      installed,
      missing,
      conflicts,
    }
  }

  async install(request: PackInstallRequest): Promise<InstalledPack> {
    const before = await this.listInstalled()
    const installSpecifier = this.normalizeInstallSpecifier(request)
    await this.installRunner(installSpecifier, this.workspaceRoot)
    const after = await this.listInstalled()
    const installed = this.selectInstalledResult(before, after, request, installSpecifier)
    if (!installed) {
      throw new Error(`Installed package not found after pnpm add: ${installSpecifier}`)
    }
    return installed
  }

  async resolve(lockfile: PackLockfile): Promise<PackResolveResult> {
    return this.verify(lockfile)
  }

  async load(entryRef: string, options?: { enforceLockfile?: boolean }): Promise<PackLoadResult> {
    return this.loader.load(entryRef, {
      source: 'node-fs',
      validateReferences: true,
      continueOnError: false,
      enforceLockfile: options?.enforceLockfile ?? true,
    })
  }

  private detectWorkspaceRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
  }

  private async findCandidatePackageJsonPaths(): Promise<string[]> {
    const results = new Set<string>()
    const workspacePackagesDir = resolve(this.workspaceRoot, 'packages')
    const workspacePacksDir = resolve(this.workspaceRoot, 'packs')
    const rootNodeModulesDir = resolve(this.workspaceRoot, 'node_modules')

    await this.collectPackageJsons(workspacePackagesDir, results, 1)
    await this.collectPackageJsons(workspacePacksDir, results, 1)
    await this.collectPackageJsons(rootNodeModulesDir, results, 2)

    return [...results]
  }

  private isWorkspacePackRoot(packageRoot: string): boolean {
    const workspacePackagesRoot = resolve(this.workspaceRoot, 'packages')
    const workspacePacksRoot = resolve(this.workspaceRoot, 'packs')
    return packageRoot.startsWith(workspacePackagesRoot) || packageRoot.startsWith(workspacePacksRoot)
  }

  private async collectPackageJsons(root: string, out: Set<string>, maxDepth: number): Promise<void> {
    try {
      await access(root)
    } catch {
      return
    }

    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.pnpm') continue
        if (entry.isDirectory()) {
          const nextDir = join(dir, entry.name)
          const packageJson = join(nextDir, 'package.json')
          try {
            await access(packageJson)
            out.add(packageJson)
          } catch {
            if (depth < maxDepth) {
              await walk(nextDir, depth + 1)
            }
          }
        }
      }
    }

    await walk(root, 0)
  }

  private async readPackageJson(path: string): Promise<PackageJsonLike | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as PackageJsonLike
    } catch {
      return undefined
    }
  }

  private async readManifest(path: string): Promise<PackManifestLike | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as PackManifestLike
    } catch {
      return undefined
    }
  }

  private normalizeInstallSpecifier(request: PackInstallRequest): string {
    switch (request.source) {
      case 'npm':
        return request.specifier
      case 'file':
        return request.specifier.startsWith('file:') ? request.specifier : `file:${request.specifier}`
      case 'workspace':
        if (request.specifier.startsWith('workspace:')) return request.specifier
        if (request.specifier.startsWith('.') || request.specifier.startsWith('/')) {
          return `file:${request.specifier}`
        }
        return request.specifier
      default:
        throw new Error(`Unsupported server install source: ${request.source}`)
    }
  }

  private selectInstalledResult(
    before: InstalledPack[],
    after: InstalledPack[],
    request: PackInstallRequest,
    installSpecifier: string,
  ): InstalledPack | undefined {
    const beforeKeys = new Set(before.map(pack => `${pack.kind}:${pack.id}@${pack.version}`))
    const added = after.filter(pack => !beforeKeys.has(`${pack.kind}:${pack.id}@${pack.version}`))
    const preferred = [...added].sort((a, b) => (a.kind === 'data' ? -1 : 1) - (b.kind === 'data' ? -1 : 1))
    if (preferred.length > 0) return preferred[0]

    return after.find(pack =>
      pack.packageName === request.specifier
      || pack.packageName === installSpecifier
      || pack.root === resolve(this.workspaceRoot, request.specifier.replace(/^file:/, ''))
      || pack.resolved === resolve(this.workspaceRoot, request.specifier.replace(/^file:/, '')),
    )
  }
}

export const serverPackManager = new ServerPackManager()

async function defaultInstallRunner(specifier: string, workspaceRoot: string): Promise<void> {
  await execFileAsync('pnpm', ['add', '-w', '--ignore-workspace-root-check', specifier], {
    cwd: workspaceRoot,
  })
}
