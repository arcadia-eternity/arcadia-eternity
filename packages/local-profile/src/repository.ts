import {
  defaultData,
  digest,
  ProfileError,
  parseBackup,
  validateData,
  type ProfileData,
  type ProfileBackup,
} from './schema'

export interface ProfileSnapshot {
  revision: number
  data: ProfileData
  digest: string
}
export interface Envelope {
  version: 1
  current: ProfileSnapshot
  recovery: ProfileSnapshot | null
}
export type ProfileExpectation = number | null | { corrupt: string }
export interface ProfileStorage {
  readRaw(): Promise<string | null>
  read(): Promise<Envelope | null>
  /** Compare and publish in one transaction. A null expectation requires empty storage. */
  commit(expected: ProfileExpectation, next: Envelope): Promise<void>
}
export async function validateEnvelope(value: unknown): Promise<Envelope> {
  try {
    if (!value || typeof value !== 'object' || !('version' in value)) throw new Error()
    if (value.version !== 1) throw new ProfileError('UNSUPPORTED_VERSION')
    const envelope = value as Envelope
    for (const snapshot of [envelope.current, envelope.recovery]) {
      if (snapshot === null) continue
      if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new Error()
      const data = validateData(snapshot.data)
      if (snapshot.digest !== (await digest(data))) throw new Error()
    }
    if (!envelope.current) throw new Error()
    return structuredClone(envelope)
  } catch (error) {
    if (error instanceof ProfileError && error.code === 'UNSUPPORTED_VERSION') throw error
    throw new ProfileError('PROFILE_CORRUPT', '个人资料损坏，原始数据已保留')
  }
}
export class ProfileRepository {
  private plans = new Map<string, { data: ProfileData; expected: number | null }>()
  constructor(
    private storage: ProfileStorage,
    private appVersion = '4.4.1',
  ) {}
  async open() {
    const value = await this.storage.read()
    return value ? validateEnvelope(value) : null
  }
  async rawData() {
    return this.storage.readRaw()
  }
  async repair(bytes: string | Uint8Array, expectedRaw: string) {
    try {
      await this.open()
      throw new ProfileError('REVISION_CONFLICT')
    } catch (error) {
      if (!(error instanceof ProfileError) || error.code !== 'PROFILE_CORRUPT') throw error
    }
    const data = parseBackup(bytes).data
    const current = { revision: 1, data, digest: await digest(data) }
    await this.storage.commit({ corrupt: expectedRaw }, { version: 1, current, recovery: null })
    return current
  }
  async create(input: { name?: string; data?: ProfileData } = {}) {
    return this.write(input.data ?? defaultData(input.name), null, false)
  }
  async update(input: { expectedRevision: number; data: ProfileData }) {
    return this.write(input.data, input.expectedRevision, false)
  }
  private async write(data: ProfileData, expected: number | null, restore: boolean): Promise<ProfileSnapshot> {
    data = validateData(data)
    const hash = await digest(data)
    const old = await this.open()
    if ((old?.current.revision ?? null) !== expected) throw new ProfileError('REVISION_CONFLICT')
    if (old?.current.digest === hash) return old.current
    const current = { revision: (expected ?? 0) + 1, digest: hash, data }
    await this.storage.commit(expected, {
      version: 1,
      current,
      recovery: restore ? (old?.current ?? null) : (old?.recovery ?? null),
    })
    return structuredClone(current)
  }
  async exportBackup(data?: ProfileData): Promise<ProfileBackup> {
    const selected = data ?? (await this.open())?.current.data
    if (!selected) throw new ProfileError('PROFILE_EMPTY')
    const backup: ProfileBackup = {
      format: 'arcadia.profile',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: this.appVersion,
      data: validateData(selected),
    }
    return parseBackup(JSON.stringify(backup))
  }
  async inspectImport(bytes: string | Uint8Array) {
    const backup = parseBackup(bytes),
      old = await this.open()
    const planId = globalThis.crypto.randomUUID()
    this.plans.clear()
    this.plans.set(planId, { data: backup.data, expected: old?.current.revision ?? null })
    return {
      planId,
      expectedRevision: old?.current.revision ?? null,
      data: structuredClone(backup.data),
      current: old?.current ?? null,
      unchanged: old?.current.digest === (await digest(backup.data)),
    }
  }
  async commitImport(input: { planId: string; expectedRevision: number | null; decision: 'restore' }) {
    const plan = this.plans.get(input.planId)
    if (!plan || input.decision !== 'restore' || plan.expected !== input.expectedRevision)
      throw new ProfileError('REVISION_CONFLICT')
    const result = await this.write(plan.data, plan.expected, true)
    this.plans.delete(input.planId)
    return result
  }
  async recover(input: { expectedRevision: number }) {
    const old = await this.open()
    if (!old?.recovery) throw new ProfileError('RECOVERY_UNAVAILABLE')
    return this.write(old.recovery.data, input.expectedRevision, true)
  }
}
