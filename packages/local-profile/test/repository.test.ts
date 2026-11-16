import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProfileRepository, defaultData, parseBackup, rawProfileBytes } from '../src/index'
import { BrowserProfileStorage } from '../src/browser'
import { FileProfileStorage } from '../src/node'

for (const kind of ['browser', 'file'])
  describe(kind, () => {
    async function fixture() {
      const dir = await mkdtemp(join(tmpdir(), 'arcadia-profile-'))
      const storage = kind === 'browser' ? new BrowserProfileStorage(new IDBFactory()) : new FileProfileStorage(dir)
      return {
        storage,
        repository: new ProfileRepository(storage),
        clean: () => rm(dir, { recursive: true, force: true }),
      }
    }
    it('restores exactly, retains a recovery point, and does not duplicate a repeated import', async () => {
      const f = await fixture()
      try {
        const a = await f.repository.create({ name: '甲' }),
          b = defaultData('乙')
        b.settings.musicVolume = 13
        const backup = await f.repository.exportBackup(b)
        const preview = await f.repository.inspectImport(JSON.stringify(backup))
        preview.data.profile.name = '修改预览不能修改计划'
        const result = await f.repository.commitImport({ ...preview, decision: 'restore' })
        expect(result.data).toEqual(b)
        const reopened = new ProfileRepository(f.storage)
        expect((await reopened.open())?.recovery?.data).toEqual(a.data)
        const again = await reopened.inspectImport(JSON.stringify({ ...backup, exportedAt: new Date().toISOString() }))
        expect((await reopened.commitImport({ ...again, decision: 'restore' })).revision).toBe(result.revision)
        expect((await reopened.recover({ expectedRevision: result.revision })).data).toEqual(a.data)
      } finally {
        await f.clean()
      }
    })
    it('rejects stale previews without replacing valid data', async () => {
      const f = await fixture()
      try {
        const a = await f.repository.create()
        const p = await f.repository.inspectImport(JSON.stringify(await f.repository.exportBackup(defaultData())))
        a.data.profile.name = 'Newer'
        await f.repository.update({ expectedRevision: a.revision, data: a.data })
        await expect(f.repository.commitImport({ ...p, decision: 'restore' })).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        })
        expect((await f.repository.open())?.current.data.profile.name).toBe('Newer')
      } finally {
        await f.clean()
      }
    })
  })
it('exchanges a browser backup with a file repository without losing settings or unresolved references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-exchange-'))
  try {
    const browser = new ProfileRepository(new BrowserProfileStorage(new IDBFactory()))
    const file = new ProfileRepository(new FileProfileStorage(dir))
    const data = defaultData()
    data.library.teams[0].ruleSetId = 'missing:rules'
    await browser.create({ data })
    const p = await file.inspectImport(JSON.stringify(await browser.exportBackup()))
    await file.commitImport({ ...p, decision: 'restore' })
    expect((await file.exportBackup()).data).toEqual((await browser.exportBackup()).data)
    await writeFile(join(dir, 'profile.json'), '{broken')
    await expect(file.open()).rejects.toMatchObject({ code: 'PROFILE_CORRUPT' })
    await expect(file.create()).rejects.toMatchObject({ code: 'PROFILE_CORRUPT' })
    expect(await readFile(join(dir, 'profile.json'), 'utf8')).toBe('{broken')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('rejects credentials, unknown versions and malformed data instead of stripping fields', () => {
  const backup = {
    format: 'arcadia.profile',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: 'test',
    data: defaultData(),
  }
  expect(() => parseBackup(JSON.stringify({ ...backup, token: 'secret' }))).toThrow()
  expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow('UNSUPPORTED_VERSION')
  backup.data.library.currentTeamIndex = 9
  expect(() => parseBackup(JSON.stringify(backup))).toThrow()
})

it('keeps a live desktop owner exclusive, and only recovers a dead owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-owner-'))
  const owner = new FileProfileStorage(dir),
    other = new FileProfileStorage(dir)
  try {
    await owner.acquireOwner()
    await new ProfileRepository(owner).create()
    await expect(other.unlock()).rejects.toMatchObject({ code: 'PROFILE_BUSY' })
    const repo = new ProfileRepository(other),
      state = (await repo.open())!
    state.current.data.profile.name = 'Other'
    await expect(repo.update({ expectedRevision: 1, data: state.current.data })).rejects.toMatchObject({
      code: 'PROFILE_BUSY',
    })
    await owner.close()
    await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 2147483647 }))
    await other.unlock()
    await repo.update({ expectedRevision: 1, data: state.current.data })
    expect((await repo.open())?.current.data.profile.name).toBe('Other')
  } finally {
    await owner.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('repairs corrupt bytes only with their exact original value, preserving unknown versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-repair-'))
  try {
    const storage = new FileProfileStorage(dir),
      repo = new ProfileRepository(storage)
    const backup = JSON.stringify(await repo.exportBackup(defaultData('Restored')))
    await writeFile(join(dir, 'profile.json'), '{broken')
    await expect(repo.repair(backup, '{stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await storage.readRaw()).toBe('{broken')
    expect((await repo.repair(backup, '{broken')).data.profile.name).toBe('Restored')
    await writeFile(join(dir, 'profile.json'), '{"version":999}')
    await expect(repo.repair(backup, '{"version":999}')).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    expect(await storage.readRaw()).toBe('{"version":999}')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('leaves the current snapshot and recovery intact after a rejected commit', async () => {
  const storage = new BrowserProfileStorage(new IDBFactory())
  const repo = new ProfileRepository(storage)
  await repo.create()
  const before = await storage.readRaw()
  const denied = new ProfileRepository({
    read: () => storage.read(),
    readRaw: () => storage.readRaw(),
    commit: async () => {
      throw new Error('QuotaExceededError')
    },
  })
  const plan = await denied.inspectImport(JSON.stringify(await repo.exportBackup(defaultData())))
  await expect(denied.commitImport({ ...plan, decision: 'restore' })).rejects.toThrow('QuotaExceededError')
  expect(await storage.readRaw()).toBe(before)
})

it('recovers after a recovery process dies without deleting a live recovery gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-gate-'))
  try {
    const storage = new FileProfileStorage(dir)
    await writeFile(join(dir, 'recovery-aaaaaaaa.lock'), JSON.stringify({ pid: 2147483647 }))
    await writeFile(join(dir, 'owner.lock'), JSON.stringify({ pid: 2147483647 }))
    await storage.unlock()
    await new ProfileRepository(storage).create()
    const live = join(dir, 'recovery-bbbbbbbb.lock')
    await writeFile(live, JSON.stringify({ pid: process.pid }))
    await expect(storage.unlock()).rejects.toMatchObject({ code: 'PROFILE_BUSY' })
    expect(await readFile(live, 'utf8')).toBe(JSON.stringify({ pid: process.pid }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

for (const kind of ['browser', 'file'])
  it(`${kind}: simultaneous restores cannot both overwrite one revision`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-race-'))
    try {
      const factory = new IDBFactory()
      const storage = () => (kind === 'file' ? new FileProfileStorage(dir) : new BrowserProfileStorage(factory))
      const a = new ProfileRepository(storage()),
        b = new ProfileRepository(storage())
      await a.create()
      const pa = await a.inspectImport(JSON.stringify(await a.exportBackup(defaultData('A'))))
      const pb = await b.inspectImport(JSON.stringify(await b.exportBackup(defaultData('B'))))
      const results = await Promise.allSettled([
        a.commitImport({ ...pa, decision: 'restore' }),
        b.commitImport({ ...pb, decision: 'restore' }),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const final = await new ProfileRepository(storage()).open()
      expect(final?.current.revision).toBe(2)
      expect(final?.recovery?.revision).toBe(1)
      expect(['A', 'B']).toContain(final?.current.data.profile.name)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

it('preserves undecodable corrupt file bytes through raw export and compare-and-repair', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'profile-binary-'))
  try {
    const storage = new FileProfileStorage(dir),
      repo = new ProfileRepository(storage)
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x81])
    await writeFile(join(dir, 'profile.json'), bytes)
    const raw = (await repo.rawData())!
    expect(Buffer.from(rawProfileBytes(raw))).toEqual(bytes)
    await expect(repo.open()).rejects.toMatchObject({ code: 'PROFILE_CORRUPT' })
    const backup = await repo.exportBackup(defaultData())
    await repo.repair(JSON.stringify(backup), raw)
    expect((await repo.open())?.current.data).toEqual(backup.data)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
