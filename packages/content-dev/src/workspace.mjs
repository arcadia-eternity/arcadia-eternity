import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import YAML from 'yaml'
import chokidar from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
import { resourceReferences, bindingPresentation, validResourceId, validAssetPath } from './lib/presentation.mjs'
import { yamlSharing, recordSharing, changedSharedField, sharingSignature } from './lib/yaml-sharing.mjs'

const ignored = new Set(['node_modules', 'dist', '.git', '.arcadia', '.DS_Store', 'Thumbs.db'])
const kinds = ['species', 'skills', 'marks', 'behaviors', 'presentations', 'resources']
const basePackageName = '@arcadia-eternity/data-pack-base'
const baseProjectId = 'arcadia-eternity.base'
const isBaseManifest = manifest => manifest.name === basePackageName || manifest.arcadia?.projectId === baseProjectId
const textLimit = 2 * 1024 * 1024
const hash = value => createHash('sha256').update(value).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export class WorkspaceError extends Error {
  constructor(code, message, file) {
    super(message)
    this.code = code
    this.file = file
  }
}
const fail = (code, message, file) => {
  throw new WorkspaceError(code, message, file)
}
export function diagnostic(error) {
  return {
    code: error.code ?? 'WORKSPACE_ERROR',
    severity: 'error',
    message: error.message,
    ...(error.file ? { file: error.file } : {}),
  }
}
function parse(text, file) {
  try {
    let doc
    const lineCounter = new YAML.LineCounter()
    const value =
      extname(file) === '.json'
        ? JSON.parse(text)
        : (doc = YAML.parseDocument(text, { merge: true, lineCounter })).toJS({ maxAliasCount: 100 })
    if (doc?.errors.length) throw doc.errors[0]
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(value)), value)) throw new Error('数据必须是有限的 JSON 值')
    return { value, doc, lineCounter, sharedFields: yamlSharing(doc, lineCounter) }
  } catch (error) {
    fail('SOURCE_INVALID', error.message, file)
  }
}
function safeValue(value) {
  if (Array.isArray(value)) value.forEach(safeValue)
  else if (object(value))
    for (const [key, entry] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor', '<<'].includes(key)) fail('SOURCE_INVALID', `不支持的字段：${key}`)
      safeValue(entry)
    }
  else if (value !== null && !['string', 'boolean', 'number'].includes(typeof value))
    fail('SOURCE_INVALID', '不支持的数据值')
  if (typeof value === 'number' && !Number.isFinite(value)) fail('SOURCE_INVALID', '数值必须有限')
}
// Change individual YAML nodes so comments and unrelated records survive a form save.
function updateNodes(doc, before, after, path = []) {
  if (isDeepStrictEqual(before, after)) return
  if (
    (object(before) && object(after)) ||
    (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
  ) {
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) doc.deleteIn([...path, key])
    for (const key of Object.keys(after))
      updateNodes(doc, before[key], after[key], [...path, Array.isArray(after) ? Number(key) : key])
  } else if (!path.length) doc.contents = doc.createNode(after)
  else doc.setIn(path, after)
}

function serializeForm({ value, doc, sharedFields }, next, file, original) {
  const changed = changedSharedField(sharedFields, value, next)
  if (changed)
    fail('SHARED_FIELD_READ_ONLY', `共享字段 ${changed.path.join('.') || '整个对象'} 请在外部编辑器修改`, file)
  if (isDeepStrictEqual(value, next)) return original
  if (!doc) return JSON.stringify(next, null, 2) + '\n'
  const signature = sharingSignature(doc)
  updateNodes(doc, value, next)
  const text = String(doc)
  const saved = parse(text, file)
  if (!isDeepStrictEqual(saved.value, next) || !isDeepStrictEqual(sharingSignature(saved.doc), signature))
    fail('SOURCE_STRUCTURE_CHANGED', '此次修改无法保留 YAML 共享结构，请在外部编辑器处理', file)
  return text
}

/** Ordinary source files are authoritative. No project database or generated-output writes. */
export class AuthorWorkspace extends EventEmitter {
  #watcher
  #queues = new Map()
  #dirty = new Set()
  #closed = false
  constructor(root) {
    super()
    this.root = root
  }
  static async open(directory, { watch = true, readOnly = false, published = false } = {}) {
    const workspace = new AuthorWorkspace(await realpath(directory))
    const manifest = JSON.parse((await workspace.read('package.json')).text)
    workspace.published = published
    workspace.readOnly = readOnly || published || isBaseManifest(manifest)
    if (isBaseManifest(manifest) && !manifest.arcadia) {
      const pack = JSON.parse((await workspace.read('pack.json')).text)
      if (pack.id !== baseProjectId) fail('PROJECT_INVALID', '基础包身份不一致', 'pack.json')
      workspace.baseProject = { projectId: pack.id, namespace: pack.id }
    }
    if (
      !workspace.baseProject &&
      (!object(manifest.arcadia) ||
        typeof manifest.arcadia.projectId !== 'string' ||
        typeof manifest.arcadia.namespace !== 'string')
    )
      fail('PROJECT_INVALID', '请选择包含 arcadia 身份的 npm 内容包源项目', 'package.json')
    if (watch) {
      workspace.#watcher = chokidar.watch(workspace.root, {
        ignoreInitial: true,
        ignored: path =>
          relative(workspace.root, path)
            .split(sep)
            .some(part => (ignored.has(part) && !(workspace.published && part === 'dist')) || part.endsWith('.tgz')),
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
        followSymlinks: false,
      })
      workspace.#watcher.on('all', (type, path) =>
        workspace.emit('change', { type, file: relative(workspace.root, path).split(sep).join('/') }),
      )
      await new Promise((resolve, reject) => {
        workspace.#watcher.once('ready', resolve)
        workspace.#watcher.once('error', reject)
      })
      workspace.#watcher.on('error', error =>
        workspace.emit('change', { type: 'rescan', diagnostic: diagnostic(error) }),
      )
    }
    return workspace
  }
  async assertWritable() {
    if (this.readOnly || isBaseManifest(JSON.parse((await this.read('package.json')).text)))
      fail('WRITE_DISABLED', '此内容包为只读，请在自己的内容包中创作。')
  }
  async path(file, { create = false } = {}) {
    if (this.#closed) fail('WORKSPACE_CLOSED', '工作区已关闭')
    if (
      typeof file !== 'string' ||
      !file ||
      isAbsolute(file) ||
      file.includes('\\') ||
      file.includes('\0') ||
      file.includes(':')
    )
      fail('PATH_INVALID', '需要项目内相对路径')
    const parts = file.split('/')
    if (
      parts.some(
        part => !part || part === '.' || part === '..' || (ignored.has(part) && !(this.published && part === 'dist')),
      )
    )
      fail('PATH_INVALID', '此路径不是可编辑源文件', file)
    if ((await realpath(this.root)) !== this.root) fail('PATH_INVALID', '项目目录已改变，请重新打开')
    let current = this.root
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index])
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
          fail('PATH_INVALID', '源路径必须是普通文件／目录', file)
      } catch (error) {
        if (create && error.code === 'ENOENT') continue
        throw error
      }
    }
    return current
  }
  async read(file) {
    const path = await this.path(file)
    if ((await lstat(path)).size > textLimit) fail('SOURCE_TOO_LARGE', '文本超过 2 MiB，请在外部编辑器打开', file)
    const bytes = await readFile(path)
    if (bytes.length > textLimit || bytes.includes(0)) fail('SOURCE_INVALID', '文件不是受支持的源文本', file)
    return { file, text: bytes.toString('utf8'), version: hash(bytes) }
  }
  async files() {
    const result = []
    const walk = async (directory, prefix = '') => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if ((ignored.has(entry.name) && !(this.published && entry.name === 'dist')) || entry.name.endsWith('.tgz'))
          continue
        const file = prefix + entry.name
        if (entry.isSymbolicLink()) {
          result.push({ file, error: '不支持符号链接' })
          continue
        }
        if (entry.isDirectory()) await walk(join(directory, entry.name), file + '/')
        else if (entry.isFile()) {
          const info = await lstat(await this.path(file))
          result.push({ file, size: info.size, modified: info.mtimeMs })
        }
        if (result.length > 10000) fail('SOURCE_TOO_LARGE', '项目超过 10000 个源文件')
      }
    }
    await walk(this.root)
    return result
  }
  async revision() {
    const hashes = []
    for (const entry of await this.files()) {
      if (entry.error) fail('PATH_INVALID', entry.error, entry.file)
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(await this.path(entry.file))) digest.update(chunk)
      hashes.push([entry.file, digest.digest('hex')])
    }
    return hash(JSON.stringify(hashes))
  }
  async snapshot() {
    const manifest = JSON.parse((await this.read('package.json')).text)
    const project = this.baseProject ?? manifest.arcadia
    const readOnly = this.readOnly || isBaseManifest(manifest)
    const baseSources = new Map()
    if (this.baseProject) {
      const pack = JSON.parse((await this.read('pack.json')).text)
      for (const kind of kinds)
        for (const file of pack.data?.[kind] ?? []) baseSources.set(`${pack.paths?.dataDir ?? 'data'}/${file}`, kind)
    }
    const files = await this.files(),
      records = [],
      diagnostics = [],
      ids = new Set()
    const locales = {},
      localeSources = []
    if (this.published) {
      // Published views follow the declared runtime artifacts, even when stale raw sources ship alongside them.
      const content = await this.read(manifest.arcadia.content)
      const data = JSON.parse(content.text).data
      safeValue(data)
      if (!object(data)) fail('SOURCE_INVALID', '安装包缺少内容数据', content.file)
      const add = (kind, record, source, index) => {
        if (!object(record) || typeof record.id !== 'string') fail('SOURCE_INVALID', '安装内容缺少 ID', source.file)
        records.push({ kind, record, file: source.file, version: source.version, index, sharedFields: [] })
      }
      for (const kind of ['species', 'skills', 'marks', 'behaviors']) {
        if (data[kind] !== undefined && !Array.isArray(data[kind]))
          fail('SOURCE_INVALID', '安装内容需要数组', content.file)
        for (const [index, record] of (data[kind] ?? []).entries()) add(kind, record, content, index)
      }
      if (manifest.arcadia.presentation) {
        const source = await this.read(manifest.arcadia.presentation)
        const presentation = JSON.parse(source.text)
        safeValue(presentation)
        if (presentation.version !== 2) fail('SOURCE_INVALID', '安装包需要 v2 表现格式', source.file)
        for (const [index, record] of (presentation.bindings ?? []).entries())
          add('presentations', record, source, index)
        for (const [index, resource] of (presentation.resources ?? []).entries()) {
          const kind = resource.mime?.startsWith('image/')
            ? 'image'
            : resource.mime?.startsWith('audio/')
              ? 'audio'
              : 'swf'
          add(
            'resources',
            { id: resource.id, kind, source: resource.source, ...(resource.tags ? { tags: resource.tags } : {}) },
            source,
            index,
          )
        }
        for (const [language, namespaces] of Object.entries(presentation.locales ?? {})) {
          for (const [namespace, entries] of Object.entries(namespaces)) {
            localeSources.push({
              file: source.file,
              version: source.version,
              language,
              namespace,
              entries,
              sharedFields: [],
            })
          }
        }
      }
    }
    for (const entry of this.published ? [] : files) {
      if (entry.error) {
        diagnostics.push({ code: 'PATH_INVALID', severity: 'error', file: entry.file, message: entry.error })
        continue
      }
      const match = baseSources.has(entry.file)
        ? [entry.file, baseSources.get(entry.file)]
        : /^data\/(species|skills|marks|behaviors|presentations|resources)\/.+\.(json|ya?ml)$/.exec(entry.file)
      const locale = /^locales\/([^/]+)\/([^/]+)\.(json|ya?ml)$/.exec(entry.file)
      if (
        this.baseProject &&
        locale &&
        !['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'].includes(locale[2])
      )
        continue
      if (!match && !locale) continue
      try {
        const source = await this.read(entry.file),
          { value, doc, lineCounter, sharedFields } = parse(source.text, entry.file)
        if (locale) {
          if (
            !object(value) ||
            Object.values(value).some(
              entry =>
                !object(entry) ||
                Object.entries(entry).some(
                  ([key, text]) => !['name', 'description'].includes(key) || typeof text !== 'string',
                ),
            )
          )
            fail('SOURCE_INVALID', '语言文件需要以对象 ID 映射名称与描述文本', entry.file)
          safeValue(value)
          locales[entry.file] = value
          localeSources.push({
            file: entry.file,
            version: source.version,
            language: locale[1],
            namespace: locale[2],
            entries: value,
            sharedFields,
            locations: Object.fromEntries(
              Object.keys(value).flatMap(id => {
                const node = doc?.getIn([id], true)
                if (!node?.range) return []
                const position = lineCounter.linePos(node.range[0])
                return [[id, { line: position.line, column: position.col }]]
              }),
            ),
          })
          continue
        }
        const values = Array.isArray(value) ? value : [value]
        for (const [index, record] of values.entries()) {
          if (!object(record) || typeof record.id !== 'string' || !record.id)
            fail('SOURCE_INVALID', '每条内容需要 ID', entry.file)
          const key = `${match[1]}:${record.id}`
          if (ids.has(key))
            diagnostics.push({
              code: 'DUPLICATE_ID',
              severity: 'error',
              file: entry.file,
              message: `重复内容 ID：${key}`,
            })
          ids.add(key)
          const node = doc?.getIn(Array.isArray(value) ? [index] : [], true)
          const position = node?.range ? lineCounter.linePos(node.range[0]) : undefined
          records.push({
            kind: match[1],
            file: entry.file,
            index: Array.isArray(value) ? index : null,
            version: source.version,
            record,
            sharedFields: recordSharing(sharedFields, Array.isArray(value) ? index : null),
            ...(position ? { line: position.line, column: position.col } : {}),
          })
        }
      } catch (error) {
        diagnostics.push(diagnostic(error))
      }
    }
    for (const row of records) {
      if (
        ['species', 'skills', 'marks'].includes(row.kind) &&
        ['presentation', 'assetRef', 'iconRef', 'sfxRef'].some(key => key in row.record)
      )
        diagnostics.push({
          code: 'PRESENTATION_MIGRATION_REQUIRED',
          severity: 'error',
          file: row.file,
          message: '此对象仍使用旧资源格式，请将表现与资源迁移到 data/presentations 和 data/resources。',
        })
    }
    const assets = records
      .filter(row => row.kind === 'resources')
      .map(row => ({
        id: row.record.id,
        file: row.record.source,
        definition: row.file,
        kind: row.record.kind,
        name: row.record.name ?? row.record.id,
        ...files.find(file => file.file === row.record.source),
        references: [],
      }))
    const byId = new Map(assets.map(row => [row.id, row]))
    const targets = new Set()
    for (const source of records.filter(row => row.kind === 'presentations')) {
      try {
        const target = source.record.target
        const key = JSON.stringify([target?.kind, target?.id])
        if (targets.has(key)) throw new Error(`重复表现关联：${key}`)
        targets.add(key)
        if (!records.some(row => row.kind === target?.kind && row.record.id === target?.id))
          throw new Error(`表现关联的对象不存在：${key}`)
        for (const ref of resourceReferences(bindingPresentation(source.record))) {
          if (typeof ref !== 'string') continue
          const resource = byId.get(ref)
          if (resource) resource.references.push({ file: source.file, kind: target.kind, id: target.id })
          else
            diagnostics.push({
              code: 'RESOURCE_MISSING',
              severity: 'error',
              file: source.file,
              message: `资源引用不存在：${ref}`,
            })
        }
      } catch (error) {
        diagnostics.push({ ...diagnostic(error), file: source.file })
      }
    }
    for (const resource of assets) {
      if (
        typeof resource.file !== 'string' ||
        (!/^https?:\/\//.test(resource.file) && !files.some(row => row.file === resource.file && !row.error))
      )
        diagnostics.push({
          code: 'RESOURCE_MISSING',
          severity: 'error',
          file: resource.definition,
          message: `素材位置已失效，请重新定位：${resource.id}`,
        })
    }
    return {
      protocolVersion: 1,
      root: this.root,
      project,
      name: this.baseProject ? '基础包' : manifest.name,
      version: manifest.version,
      records,
      files,
      assets,
      locales,
      localeSources,
      diagnostics,
      capabilities: {
        sourceEditing: !readOnly,
        structuredSaving: !readOnly,
        localeEditing: !readOnly,
        yamlSharing: 'read-only-fields',
        externalEditor: !readOnly,
        kinds,
        sdkApi: project.sdkApi,
      },
    }
  }
  setDirty(file, dirty) {
    if (dirty) this.#dirty.add(file)
    else this.#dirty.delete(file)
  }
  async asset(file) {
    if (!file.startsWith('assets/') && !(await this.snapshot()).assets.some(row => row.file === file))
      fail('PATH_INVALID', '请选择项目声明的素材', file)
    const path = await this.path(file)
    if ((await lstat(path)).size > 64 * 1024 * 1024) fail('SOURCE_TOO_LARGE', '素材超过 64 MiB', file)
    const bytes = await readFile(path)
    return { file, bytes, version: hash(bytes) }
  }
  async #serialize(file, action) {
    const pending = (this.#queues.get(file) ?? Promise.resolve()).catch(() => {}).then(action)
    this.#queues.set(file, pending)
    try {
      return await pending
    } finally {
      if (this.#queues.get(file) === pending) this.#queues.delete(file)
    }
  }
  async #version(file) {
    try {
      return (await this.read(file)).version
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  async #check(file, expectedVersion, fromForm) {
    await this.assertWritable()
    if (this.#dirty.has(file) && !fromForm) fail('UNSAVED_CHANGES', '此文件有未保存表单', file)
    if (expectedVersion !== (await this.#version(file)))
      fail('REVISION_CONFLICT', '文件已在外部修改，未保存输入仍保留', file)
  }
  async write({ file, expectedVersion, text }, { fromForm = false } = {}) {
    await this.assertWritable()
    if (typeof text !== 'string' || Buffer.byteLength(text) > textLimit)
      fail('SOURCE_TOO_LARGE', '源文本超过大小限制', file)
    return this.#serialize(file, async () => {
      const path = await this.path(file, { create: true })
      await this.#check(file, expectedVersion, fromForm)
      await mkdir(dirname(path), { recursive: true })
      await this.path(file, { create: true })
      await this.#check(file, expectedVersion, fromForm)
      await writeFileAtomic(path, text)
      if (fromForm) this.#dirty.delete(file)
      this.emit('change', { type: 'change', file })
      return { file, version: hash(text) }
    })
  }
  async saveRecord({ file, expectedVersion, index = null, record }) {
    const { results } = await this.saveChanges(
      { changes: [{ kind: 'record', file, expectedVersion, index, record }] },
      { fromForm: true },
    )
    const result = results[0]
    if (!result.saved) fail(result.diagnostic.code, result.diagnostic.message, result.diagnostic.file ?? file)
    return { file: result.file, version: result.version }
  }
  /** Prepare the whole review first; commit each source once, reporting partial writes explicitly. */
  async saveChanges({ changes }, { fromForm = false } = {}) {
    await this.assertWritable()
    if (!Array.isArray(changes) || !changes.length || changes.length > 1000)
      fail('SOURCE_INVALID', '请选择 1–1000 项修改')
    const catalog = changes.some(change => ['locale', 'create-record'].includes(change?.kind))
      ? await this.snapshot()
      : undefined
    const created = new Set()
    for (const change of changes.filter(change => change?.kind === 'create-record')) {
      const kind = /^data\/(species|skills|marks|presentations|resources)\/.+\.(json|ya?ml)$/.exec(change.file)?.[1]
      if (!kind || !object(change.record) || typeof change.record.id !== 'string' || !change.record.id)
        fail('SOURCE_INVALID', '新建内容需要有效类型、ID 和源文件位置', change.file)
      const key = JSON.stringify([kind, change.record.id])
      if (created.has(key) || catalog.records.some(row => row.kind === kind && row.record.id === change.record.id))
        fail('DUPLICATE_ID', '此内容 ID 已存在，请使用其他标识', change.file)
      created.add(key)
    }
    const files = new Map(),
      targets = new Set()
    for (const change of changes) {
      const { file, expectedVersion, kind, record, index = null, id } = change
      const creating = kind === 'create-record'
      if (typeof expectedVersion !== 'string' && !(expectedVersion === null && (creating || kind === 'locale')))
        fail('SOURCE_INVALID', '保存需要已读取的源版本', file)
      if (creating && expectedVersion !== null) fail('SOURCE_INVALID', '新建内容不能覆盖已有文件', file)
      if (creating && index !== null) fail('SOURCE_INVALID', '新建内容需要独立文件，不能指定数组位置', file)
      const isLocale = kind === 'locale'
      if (kind !== 'record' && !isLocale && !creating) fail('SOURCE_INVALID', '不支持的修改类型', file)
      if (
        !(
          isLocale
            ? /^locales\/[^/]+\/[^/]+\.(json|ya?ml)$/
            : /^data\/(species|skills|marks|behaviors|presentations|resources)\/.+\.(json|ya?ml)$/
        ).test(file)
      )
        fail('PATH_INVALID', '请选择已有的内容或语言源文件', file)
      const key = JSON.stringify([file, isLocale ? id : index])
      if (targets.has(key)) fail('SOURCE_INVALID', '同一内容出现重复修改', file)
      targets.add(key)
      if (!files.has(file)) {
        if (this.#dirty.has(file) && !fromForm) fail('UNSAVED_CHANGES', '此文件有未保存表单', file)
        await this.path(file, { create: expectedVersion === null })
        const version = await this.#version(file)
        if (version !== expectedVersion) fail('REVISION_CONFLICT', '来源已改变或新建位置已被占用，请核对', file)
        const source = expectedVersion === null ? { file, version: null, text: '{}' } : await this.read(file)
        if (source.version !== expectedVersion)
          fail('REVISION_CONFLICT', '文件已改变，草稿仍保留，请核对外部变化', file)
        const parsed = parse(source.text, file)
        safeValue(parsed.value)
        files.set(file, { source, parsed, next: JSON.parse(JSON.stringify(parsed.value)) })
      }
      const prepared = files.get(file)
      if (prepared.source.version !== expectedVersion)
        fail('REVISION_CONFLICT', '同一文件的草稿版本不一致，请核对外部变化', file)
      safeValue(record)
      if (!object(record)) fail('SOURCE_INVALID', '保存内容必须是对象', file)
      if (!isLocale) {
        const sourceKind = file.split('/')[1]
        if (sourceKind === 'resources') {
          if (
            !validResourceId(record?.id) ||
            !['image', 'audio', 'swf'].includes(record?.kind) ||
            typeof record.source !== 'string' ||
            (!/^https?:\/\//.test(record.source) && !validAssetPath(record.source))
          )
            fail('SOURCE_INVALID', '资源需要稳定 ID、类型和项目内路径或 HTTP 地址', file)
        } else if (sourceKind === 'presentations') {
          if (
            !object(record?.target) ||
            !['species', 'skills', 'marks'].includes(record.target.kind) ||
            typeof record.target.id !== 'string'
          )
            fail('SOURCE_INVALID', '表现需要对应的内容对象', file)
          resourceReferences(bindingPresentation(record))
        } else if (['presentation', 'assetRef', 'iconRef', 'sfxRef'].some(key => key in record))
          fail('SOURCE_INVALID', '请将表现关联和资源定义分别保存到 data/presentations 与 data/resources', file)
      }
      if (isLocale) {
        if (
          typeof id !== 'string' ||
          !id ||
          ['__proto__', 'constructor', 'prototype'].includes(id) ||
          !object(prepared.next) ||
          !object(record) ||
          Object.entries(record).some(
            ([key, value]) => !['name', 'description'].includes(key) || typeof value !== 'string',
          )
        )
          fail('SOURCE_INVALID', '名称与描述需要文本值', file)
        const namespace = /^locales\/[^/]+\/([^/]+)\.(json|ya?ml)$/.exec(file)?.[1]
        const contentKind = {
          species: 'species',
          skill: 'skills',
          mark: 'marks',
          mark_ability: 'marks',
          mark_emblem: 'marks',
          mark_global: 'marks',
        }[namespace]
        if (
          !contentKind ||
          catalog.records.filter(row => row.kind === contentKind && row.record.id === id).length +
            Number(created.has(JSON.stringify([contentKind, id]))) !==
            1
        )
          fail('SOURCE_INVALID', '名称与描述需要对应唯一的已有内容对象', file)
        prepared.next[id] = record
      } else {
        if (!object(record) || typeof record.id !== 'string' || !record.id) fail('SOURCE_INVALID', '内容需要 ID', file)
        if (creating) {
          prepared.next = record
          continue
        }
        const before =
          index === null
            ? prepared.next
            : Array.isArray(prepared.next) && Number.isInteger(index)
              ? prepared.next[index]
              : undefined
        if (!object(before) || before.id !== record.id) fail('SOURCE_INVALID', '内容位置或身份已改变，请核对来源', file)
        if (index === null) prepared.next = record
        else prepared.next[index] = record
      }
    }
    const prepared = [...files]
      .map(([file, { source, parsed, next }]) => ({
        file,
        expectedVersion: source.version,
        text:
          source.version === null
            ? extname(file) === '.json'
              ? JSON.stringify(next, null, 2) + '\n'
              : YAML.stringify(next)
            : serializeForm(parsed, next, file, source.text),
      }))
      .sort((a, b) => Number(a.file.startsWith('locales/')) - Number(b.file.startsWith('locales/')))
    const results = []
    for (const change of prepared) {
      try {
        const result = await this.write(change, { fromForm })
        results.push({ ...result, saved: true })
      } catch (error) {
        results.push({ file: change.file, saved: false, diagnostic: diagnostic(error) })
        break
      }
    }
    return { results, complete: results.length === prepared.length && results.every(result => result.saved) }
  }
  async close() {
    this.#closed = true
    await this.#watcher?.close()
    await Promise.allSettled(this.#queues.values())
    this.removeAllListeners()
  }
}
