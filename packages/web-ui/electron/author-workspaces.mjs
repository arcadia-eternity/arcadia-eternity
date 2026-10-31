import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, basename, relative, isAbsolute, resolve, sep } from 'node:path'

/** Local source projects are separate from installed packages and multiplayer server projects. */
export class AuthorWorkspaces {
  #entries
  #sessions = new Map()
  #queue = Promise.resolve()
  constructor({ root, api, notify = () => {}, env = process.env }) {
    Object.assign(this, { root, api, notify, env })
  }
  async list() {
    if (!this.#entries) {
      try {
        this.#entries = JSON.parse(await readFile(join(this.root, 'state/projects.json'), 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        this.#entries = []
      }
      if (!Array.isArray(this.#entries)) throw new Error('源项目登记损坏，请恢复备份')
    }
    return structuredClone(this.#entries)
  }
  async #mutate(action) {
    const next = this.#queue.catch(() => {}).then(action)
    this.#queue = next
    return next
  }
  async #save(entries) {
    const file = join(this.root, 'state/projects.json')
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(entries, null, 2))
      await rename(temp, file)
      this.#entries = entries
    } finally {
      await rm(temp, { force: true })
    }
  }
  async add(directory) {
    return this.#mutate(async () => {
      const entries = await this.list(),
        root = await realpath(directory)
      const existing = entries.find(entry => entry.directory === root)
      if (existing) return existing
      const { openAuthorSession } = await this.api()
      const probe = await openAuthorSession(root, { watch: false })
      let description
      try {
        description = await probe.describe()
      } finally {
        await probe.close()
      }
      const entry = { id: randomUUID(), directory: root, name: description.name || basename(root) }
      await this.#save([...entries, entry])
      return entry
    })
  }
  async create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('请输入 1–80 个字符的项目名称')
    const directory = join(this.root, 'projects', `pack-${randomUUID().slice(0, 12)}`)
    await mkdir(dirname(directory), { recursive: true })
    const { createSourceProject } = await this.api()
    await createSourceProject(directory, basename(directory))
    const entry = await this.add(directory)
    await this.#mutate(async () =>
      this.#save((await this.list()).map(item => (item.id === entry.id ? { ...item, name: name.trim() } : item))),
    )
    return { ...entry, name: name.trim() }
  }
  async entry(id) {
    const entry = (await this.list()).find(entry => entry.id === id)
    if (!entry) throw new Error('未登记此源项目')
    if ((await realpath(entry.directory)) !== entry.directory) throw new Error('目录已改变，请重新打开项目')
    return entry
  }
  async session(id) {
    const entry = await this.entry(id)
    if (!this.#sessions.has(id)) {
      const promise = this.api()
        .then(api => api.openAuthorSession(entry.directory, { execute: true, env: this.env }))
        .then(session => {
          session.workspace.on('change', event => this.notify({ id, ...event }))
          return session
        })
        .catch(error => {
          this.#sessions.delete(id)
          throw error
        })
      this.#sessions.set(id, promise)
    }
    return this.#sessions.get(id)
  }
  async release(id) {
    const session = this.#sessions.get(id)
    this.#sessions.delete(id)
    if (session) await (await session).close()
  }
  async forget(id) {
    await this.release(id)
    await this.#mutate(async () => this.#save((await this.list()).filter(entry => entry.id !== id)))
  }
  async export(id, destination) {
    const session = await this.session(id)
    const relation = relative(session.workspace.root, resolve(destination))
    if (!relation || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`)))
      throw new Error('导出目录必须位于源项目之外')
    try {
      await lstat(destination)
      throw new Error('请选择尚不存在的新目录')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const before = await session.workspace.revision()
    await mkdir(destination)
    try {
      for (const file of await session.workspace.files()) {
        if (file.error) throw new Error(file.error)
        const target = join(destination, file.file)
        await mkdir(dirname(target), { recursive: true })
        await cp(await session.workspace.path(file.file), target, { errorOnExist: true, force: false })
      }
      if (before !== (await session.workspace.revision())) throw new Error('导出期间源文件改变，请重新导出')
    } catch (error) {
      await rm(destination, { recursive: true, force: true })
      throw error
    }
    return destination
  }
  async openExternal(id, file, editor, line = 1, column = 1) {
    const session = await this.session(id)
    await session.workspace.assertWritable()
    const target = file ? await session.workspace.path(file) : session.workspace.root
    if (!['code', 'codium', 'cursor', 'zed'].includes(editor)) throw new Error('请选择受支持的外部编辑器')
    if (![line, column].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('行列位置无效')
    const args =
      editor === 'zed'
        ? [session.workspace.root, ...(file ? [`${target}:${line}:${column}`] : [])]
        : [session.workspace.root, ...(file ? ['--goto', `${target}:${line}:${column}`] : [])]
    await new Promise((resolve, reject) => {
      const child = spawn(editor, args, { shell: false, stdio: 'ignore', windowsHide: true })
      child.once('error', () => reject(new Error('无法打开编辑器，请检查命令是否可用，或选择显示文件夹')))
      child.once('exit', code => (code === 0 ? resolve() : reject(new Error('编辑器未能打开文件，请使用显示文件夹'))))
    })
  }
  async importAsset(id, source) {
    const session = await this.session(id)
    await session.workspace.assertWritable()
    const info = await lstat(source)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 64 * 1024 * 1024 ||
      !/\.(png|jpe?g|webp|mp3|ogg|swf)$/i.test(source)
    )
      throw new Error('请选择不超过 64 MiB 的图片、音频或 SWF 文件')
    const file = `assets/imports/${randomUUID().slice(0, 8)}-${basename(source)}`
    const target = await session.workspace.path(file, { create: true })
    await mkdir(dirname(target), { recursive: true })
    await session.workspace.path(file, { create: true })
    await copyFile(source, target, constants.COPYFILE_EXCL)
    return { file, name: basename(source) }
  }
  async close() {
    await Promise.allSettled([...this.#sessions.keys()].map(id => this.release(id)))
    await this.#queue
  }
}
