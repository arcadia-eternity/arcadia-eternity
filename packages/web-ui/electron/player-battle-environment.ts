import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnvironmentInstallation } from '@arcadia-eternity/content-sdk/management-workspace'

const error = (code: string) => Object.assign(new Error(code), { code })
const environmentId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const leaseId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/

type Snapshot = Pick<
  EnvironmentInstallation,
  'directory' | 'environmentId' | 'document' | 'draftRevision' | 'contentRevision'
> & { release(): Promise<void> }

interface PlayerBattleSource {
  acquireProject(id: string): Promise<Snapshot>
}

interface BattleLease {
  snapshot: Snapshot
  timer: ReturnType<typeof setTimeout>
  releasing?: Promise<boolean>
}

/** Keep the player's private read copy only while the CLI prepares its in-memory battle content. */
export class PlayerBattleEnvironments {
  #environments: PlayerBattleSource
  #ttl: number
  #closed = false
  #pending = new Set<Promise<unknown>>()
  #leases = new Map<string, BattleLease>()
  constructor(environments: PlayerBattleSource, { ttlMs = 300_000 } = {}) {
    this.#environments = environments
    this.#ttl = ttlMs
  }

  async request(input: Record<string, unknown>) {
    if (this.#closed) throw error('PLAYER_LIBRARY_CLOSED')
    if (
      input.operation === 'battle-environment-release' &&
      Object.keys(input).length === 2 &&
      typeof input.leaseId === 'string' &&
      leaseId.test(input.leaseId)
    ) {
      await this.#release(input.leaseId)
      return { released: true }
    }
    if (
      input.operation !== 'battle-environment-acquire' ||
      Object.keys(input).length !== 2 ||
      typeof input.environmentId !== 'string' ||
      !environmentId.test(input.environmentId)
    )
      throw error('INVALID_REQUEST')
    if (this.#pending.size + this.#leases.size >= 4) throw error('PLAYER_BATTLE_ENVIRONMENT_BUSY')
    const task = this.#acquire(input.environmentId)
    this.#pending.add(task)
    try {
      return await task
    } finally {
      this.#pending.delete(task)
    }
  }

  async #acquire(id: string) {
    const snapshot = await this.#environments.acquireProject(id)
    let granted = false
    try {
      if (this.#closed) throw error('PLAYER_LIBRARY_CLOSED')
      // ContentWorkspace.acquire returns an independent copy of npm materials without
      // host metadata. Attach the applied (possibly older than draft) document there.
      const receipt = {
        format: 'arcadia.environment-installation/1',
        installationId: snapshot.environmentId,
        document: snapshot.document,
        draftRevision: snapshot.draftRevision,
        contentRevision: snapshot.contentRevision,
      }
      await writeFile(join(snapshot.directory, '.arcadia-prepared.json'), JSON.stringify(receipt), {
        flag: 'wx',
        mode: 0o600,
      })
      // This is the existing local-play policy for a prepared player installation.
      const admission = { format: 'arcadia.npm-admission', version: 2, profile: 'local-development' }
      await writeFile(join(snapshot.directory, 'arcadia-admission.json'), JSON.stringify(admission), {
        flag: 'wx',
        mode: 0o600,
      })
      if (this.#closed) throw error('PLAYER_LIBRARY_CLOSED')
      const token = randomUUID()
      this.#leases.set(token, { snapshot, timer: this.#cleanupTimer(token) })
      granted = true
      return {
        leaseId: token,
        directory: snapshot.directory,
        environmentId: snapshot.environmentId,
        draftRevision: snapshot.draftRevision,
        contentRevision: snapshot.contentRevision,
        expiresInMs: this.#ttl,
      }
    } finally {
      if (!granted) await snapshot.release()
    }
  }

  #cleanupTimer(token: string) {
    const timer = setTimeout(() => {
      this.#release(token).catch(cause =>
        console.warn('Player battle snapshot cleanup failed:', cause.code ?? cause.message),
      )
    }, this.#ttl)
    timer.unref()
    return timer
  }

  async #release(token: string) {
    const entry = this.#leases.get(token)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.releasing ??= Promise.resolve()
      .then(() => entry.snapshot.release())
      .then(() => this.#leases.delete(token))
      .catch(cause => {
        entry.releasing = undefined
        if (!this.#closed) entry.timer = this.#cleanupTimer(token)
        throw cause
      })
    await entry.releasing
  }

  async close() {
    this.#closed = true
    await Promise.allSettled(this.#pending)
    await Promise.all([...this.#leases.keys()].map(token => this.#release(token)))
  }
}
