import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const inside = (root, target) => {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Prefer the N-API prebuild shipped by better-sqlite3 13, then the node-gyp fallback. */
export async function locateDesktopSqliteBinary(moduleRoot, platform = process.platform, arch = process.arch) {
  const linuxMusl =
    platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? 'linuxmusl' : platform
  for (const file of [
    join(moduleRoot, 'prebuilds', `${linuxMusl}-${arch}.node`),
    join(moduleRoot, 'build', 'Release', 'better_sqlite3.node'),
    join(moduleRoot, 'build', 'Debug', 'better_sqlite3.node'),
  ]) {
    try {
      if ((await stat(file)).isFile()) return file
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return undefined
}

async function validateRuntimeLinks(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(file)
        if (isAbsolute(link) || !inside(root, resolve(directory, link)) || !inside(root, await realpath(file)))
          throw new Error('SQLite runtime contains an escaping or absolute link')
      } else if (entry.isDirectory()) await visit(file)
      else if (!entry.isFile()) throw new Error('SQLite runtime contains an unsupported file')
    }
  }
  await visit(root)
}

/** Execute the actual native library in Electron's Node runtime, including reopen. */
export async function verifyDesktopSqlite({
  executable,
  moduleRoot,
  electronVersion,
  platform = process.platform,
  arch = process.arch,
}) {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-sqlite-smoke-'))
  try {
    const probe = join(temporary, 'probe.cjs')
    await writeFile(
      probe,
      `
const {createRequire}=require('node:module');
const Database=createRequire(process.argv[2])('better-sqlite3');
const file=process.argv[3];
let db=new Database(file);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');
db.exec('CREATE TABLE probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT INTO probe VALUES (?, ?)').run('stable-id','persisted');db.close();
db=new Database(file);if(db.prepare('SELECT value FROM probe WHERE id = ?').get('stable-id').value!=='persisted')throw Error('SQLITE_REOPEN_FAILED');db.close();
console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,platform:process.platform,arch:process.arch}));
`,
    )
    const { stdout } = await exec(
      executable,
      [probe, join(moduleRoot, 'package.json'), join(temporary, 'probe.sqlite')],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_OPTIONS: '',
          DOTENV_CONFIG_PATH: join(temporary, 'no-dotenv'),
        },
        maxBuffer: 1024 * 1024,
        timeout: 30000,
      },
    )
    const result = JSON.parse(stdout.trim())
    if (
      result.electron !== electronVersion ||
      result.platform !== platform ||
      result.arch !== arch ||
      !/^\d+$/.test(result.abi)
    )
      throw new Error('SQLite smoke used a different Electron target')
    return result
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Only modifies an isolated staged copy. An offline build never downloads binaries or headers. */
export async function stageDesktopSqlite({
  runtime,
  executable,
  electronVersion,
  abi,
  platform = process.platform,
  arch = process.arch,
  cacheDirectory,
  online = false,
  rebuild,
}) {
  runtime = await realpath(runtime)
  if (
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(electronVersion) ||
    !/^\d+$/.test(String(abi)) ||
    !/^[a-z0-9_-]+$/.test(platform) ||
    !/^[a-z0-9_-]+$/.test(arch)
  )
    throw new Error('Invalid Electron native target')
  const databaseRequire = createRequire(join(runtime, 'node_modules/@arcadia-eternity/database/package.json'))
  const moduleRoot = await realpath(dirname(databaseRequire.resolve('better-sqlite3/package.json')))
  if (!inside(runtime, moduleRoot)) throw new Error('SQLite native module escapes staged runtime')
  await validateRuntimeLinks(runtime)
  const manifest = JSON.parse(await readFile(join(moduleRoot, 'package.json'), 'utf8'))
  if (manifest.name !== 'better-sqlite3' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version))
    throw new Error('Invalid SQLite module manifest')
  const target = { name: manifest.name, version: manifest.version, electronVersion, abi: String(abi), platform, arch }
  const key = [target.name, target.version, electronVersion, platform, arch, `abi${abi}`].join('-')
  const cached = join(resolve(cacheDirectory), key, 'better_sqlite3.node')
  const copy = moduleRoot + `.native-${randomUUID()}`
  await cp(moduleRoot, copy, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true })
  await rm(moduleRoot, { recursive: true, force: true })
  await rename(copy, moduleRoot)
  let binary = await locateDesktopSqliteBinary(moduleRoot, platform, arch)
  const probe = async () => {
    await validateRuntimeLinks(runtime)
    return verifyDesktopSqlite({ executable, moduleRoot, electronVersion, platform, arch })
  }
  let verified
  try {
    verified = await probe()
  } catch {
    /* A deployed dependency usually contains the system Node ABI. */
  }
  if (!verified) {
    await rm(join(moduleRoot, 'prebuilds'), { recursive: true, force: true })
    await rm(join(moduleRoot, 'build'), { recursive: true, force: true })
    binary = join(moduleRoot, 'build/Release/better_sqlite3.node')
    await mkdir(dirname(binary), { recursive: true })
    try {
      await cp(cached, binary)
      verified = await probe()
    } catch {
      await rm(binary, { force: true })
    }
  }
  if (!verified) {
    if (!online)
      throw new Error(`No verified SQLite binary for ${key}; rerun staging with --online to prepare this target`)
    if (typeof rebuild !== 'function') throw new Error('Electron native rebuild tool is unavailable')
    await rm(join(moduleRoot, 'prebuilds'), { recursive: true, force: true })
    await rebuild({
      buildPath: moduleRoot,
      projectRootPath: runtime,
      electronVersion,
      arch,
      platform,
      onlyModules: ['better-sqlite3'],
      force: true,
    })
    binary = await locateDesktopSqliteBinary(moduleRoot, platform, arch)
    if (!binary) throw new Error('Electron native rebuild did not produce a SQLite binary')
    verified = await probe()
  }
  if (verified.abi !== String(abi)) throw new Error('SQLite binary ABI does not match the selected Electron runtime')
  await mkdir(dirname(cached), { recursive: true })
  const staging = cached + `.${randomUUID()}.tmp`
  await cp(binary, staging)
  await rename(staging, cached)
  return { ...target, smoke: 'write-close-reopen', verified: true }
}

export async function loadElectronRebuild(packageFile) {
  const require = createRequire(packageFile)
  return (await import(pathToFileURL(require.resolve('@electron/rebuild')).href)).rebuild
}
