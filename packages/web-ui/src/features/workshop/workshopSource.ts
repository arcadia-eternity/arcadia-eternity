import {
  OFFICIAL_WORKSHOP_ROOT,
  WorkshopClient,
  type WorkshopTrustState,
  type WorkshopTrustStore,
  type WorkshopView,
} from '@arcadia-eternity/pack-loader/workshop'
import type {
  WorkshopInstallResult,
  WorkshopRegistryEntry,
  WorkshopRegistryPreview,
  WorkshopRequest,
  WorkshopSummary,
} from '@/types/workshop'

const messages: Record<string, string> = {
  WORKSHOP_INDEX_STALE: '索引已过期，请刷新后再安装。',
  WORKSHOP_RELEASE_REVOKED: '此版本已被撤销。',
  WORKSHOP_RELEASE_UNKNOWN: '索引中没有此版本。',
  WORKSHOP_PROJECT_UNKNOWN: '索引中没有此项目。',
  WORKSHOP_INTEGRITY_MISMATCH: '下载内容与签名索引不一致，已停止安装。',
  WORKSHOP_MIRRORS_FAILED: '无法连接工坊索引，已显示离线缓存。',
  WORKSHOP_FETCH_FAILED: '无法连接工坊索引。',
  WORKSHOP_SIGNATURE_INVALID: '工坊签名校验失败。',
  WORKSHOP_SIGNATURE_THRESHOLD: '工坊签名校验失败。',
  WORKSHOP_ROLLBACK: '工坊索引版本回退，已拒绝。',
  WORKSHOP_SNAPSHOT_EXPIRED: '工坊快照已过期。',
  WORKSHOP_ROOT_EXPIRED: '工坊根密钥已过期，请更新客户端。',
  WORKSHOP_ROOT_CHANGED: '根密钥在确认后发生变化，请重新预览。',
  WORKSHOP_ROOT_MISSING: '该地址没有工坊根文件。',
  WORKSHOP_URL_INVALID: '请输入 HTTPS 地址。',
  WORKSHOP_REGISTRY_EXISTS: '已添加同名工坊源。',
  WORKSHOP_REGISTRY_UNKNOWN: '找不到此工坊源。',
  WORKSHOP_STATE_BUSY: '另一个窗口正在更新索引，请稍后重试。',
  ENVIRONMENT_ALREADY_EXISTS: '环境标识已存在，请指定新的环境标识。',
}

export function workshopError(error: unknown) {
  const detail = error as { code?: unknown; message?: unknown } | undefined
  const raw = typeof detail?.code === 'string' ? detail.code : typeof detail?.message === 'string' ? detail.message : ''
  const code = /^[A-Z_]+/.exec(raw)?.[0] ?? ''
  return messages[code] ?? (typeof detail?.message === 'string' && detail.message ? detail.message : '工坊操作失败')
}

export interface WorkshopSource {
  /** Desktop installs into the local workspace; the browser only browses. */
  canInstall: boolean
  canManageRegistries: boolean
  registries(): Promise<WorkshopRegistryEntry[]>
  view(registry: string, refresh: boolean): Promise<WorkshopSummary>
  preview(site: string): Promise<WorkshopRegistryPreview>
  addRegistry(site: string, fingerprint: string): Promise<string>
  removeRegistry(registry: string): Promise<void>
  install(input: Extract<WorkshopRequest, { action: 'install' }>): Promise<WorkshopInstallResult>
}

function desktopSource(api: NonNullable<NonNullable<typeof window.arcadiaDesktop>['workshop']>): WorkshopSource {
  const call = async <T>(input: WorkshopRequest) => {
    const response = await api(input)
    if (response.error) throw new Error(workshopError(response.error))
    return response.result as T
  }
  const registry = (id: string) => (id === 'official' ? {} : { registry: id })
  return {
    canInstall: true,
    canManageRegistries: true,
    registries: async () => (await call<{ registries: WorkshopRegistryEntry[] }>({ action: 'registries' })).registries,
    view: (id, refresh) => call({ action: refresh ? 'refresh' : 'view', ...registry(id) }),
    preview: site => call({ action: 'preview-registry', site }),
    addRegistry: async (site, fingerprint) =>
      (await call<{ id: string }>({ action: 'add-registry', site, fingerprint })).id,
    removeRegistry: async id => {
      await call({ action: 'remove-registry', registry: id })
    },
    install: input => call(input),
  }
}

const storageKey = (registry: string) => 'arcadia.workshop.' + registry
/** Per-tab cache of verified state; Web Locks serialize updates across tabs when available. */
export function browserTrustStore(storage: Storage = window.localStorage): WorkshopTrustStore {
  const read = (registry: string) => {
    const text = storage.getItem(storageKey(registry))
    return text ? (JSON.parse(text) as WorkshopTrustState) : undefined
  }
  return {
    async read(registry) {
      return read(registry)
    },
    async update(registry, next) {
      const write = () => {
        const state = next(read(registry))
        if (!state) return false
        storage.setItem(storageKey(registry), JSON.stringify(state))
        return true
      }
      return navigator.locks ? navigator.locks.request(storageKey(registry), write) : write()
    },
  }
}

function browserSource(): WorkshopSource {
  const client = new WorkshopClient({ trustedRoot: OFFICIAL_WORKSHOP_ROOT, store: browserTrustStore() })
  const summarize = (view: WorkshopView): WorkshopSummary => ({
    registry: view.registry,
    official: true,
    freshness: view.freshness,
    checkedAt: view.checkedAt,
    snapshot: view.snapshot.version,
    expires: view.snapshot.expires,
    error: view.error,
    projects: view.index.projects,
    revocations: view.index.revocations,
    revokedInstalled: [],
  })
  const unsupported = () => Promise.reject(new Error('请在桌面客户端中操作'))
  return {
    canInstall: false,
    canManageRegistries: false,
    registries: async () => [{ id: 'official', site: '', official: true }],
    view: async (_id, refresh) => {
      try {
        return summarize((!refresh && (await client.cached())) || (await client.refresh()))
      } catch (error) {
        throw new Error(workshopError(error))
      }
    },
    preview: unsupported,
    addRegistry: unsupported,
    removeRegistry: unsupported,
    install: unsupported,
  }
}

export function createWorkshopSource(desktop = window.arcadiaDesktop): WorkshopSource {
  return desktop?.workshop ? desktopSource(desktop.workshop) : browserSource()
}
