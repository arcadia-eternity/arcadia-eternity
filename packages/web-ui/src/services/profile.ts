import { ref } from 'vue'
import { getDefaultTeam } from './defaultTeam'
import {
  ProfileRepository,
  ProfileError,
  defaultData,
  validateData,
  type ProfileData,
  type ProfileStorage,
  type ProfileSnapshot,
  type Envelope,
} from '@arcadia-eternity/local-profile'
import { BrowserProfileStorage } from '@arcadia-eternity/local-profile/browser'
import { installProfileStorage, localStorageUnavailable } from './localStorage'

export const profileStatus = ref<'loading' | 'saved' | 'unsaved' | 'memory-only' | 'blocked'>('loading')
export const profileFailure = ref('')
export const profileMigrationNotice = ref('')
export const profileSwitching = ref(false)
let repository: ProfileRepository
let snapshot: ProfileSnapshot | null = null
function defaultWebProfile() {
  const value = defaultData()
  value.library.teams = [getDefaultTeam()]
  return value
}
let data = defaultWebProfile()
let writable = false
let remote = false
let queue: Promise<void> = Promise.resolve()
let pending = false
let migrationCandidate: ProfileData | undefined
let channel: BroadcastChannel | undefined
let desktopChangeSubscription: (() => void) | undefined

export function currentProfileData() {
  return structuredClone(data)
}
export function profileInitialized() {
  return !!repository
}
export function profileReady() {
  return profileStatus.value !== 'loading' && profileStatus.value !== 'blocked' && !profileSwitching.value
}
function failure(error: unknown) {
  localStorageUnavailable.value = true
  profileFailure.value = error instanceof Error ? error.message : '资料保存失败'
  profileStatus.value = 'unsaved'
}
function publish(next: ProfileSnapshot) {
  snapshot = next
  data = structuredClone(next.data)
  profileStatus.value = remote ? 'memory-only' : 'saved'
  profileFailure.value = ''
  localStorageUnavailable.value = false
  channel?.postMessage({ revision: next.revision })
}
function saveSoon() {
  profileStatus.value = remote || !writable ? 'memory-only' : 'unsaved'
  if (remote) {
    void window.arcadiaRemotePlay?.updateProfileDraft?.(currentProfileData()).catch(failure)
    return
  }
  if (pending || !writable) return
  pending = true
  queue = queue
    .then(async () => {
      pending = false
      const captured = structuredClone(data)
      const next = snapshot
        ? await repository.update({ expectedRevision: snapshot.revision, data: captured })
        : await repository.create({ data: captured })
      snapshot = next
      if (!pending) profileStatus.value = 'saved'
      profileFailure.value = ''
      localStorageUnavailable.value = false
      channel?.postMessage({ revision: next.revision })
    })
    .catch(failure)
}
export async function flushProfile() {
  await queue
  if (pending) await flushProfile()
  if (profileFailure.value) throw new Error(profileFailure.value)
}
export async function retryProfileSave() {
  profileFailure.value = ''
  saveSoon()
  await flushProfile()
}

function migrate(prefer?: 'player' | 'player-data'): ProfileData {
  const result = defaultWebProfile()
  const read = (key: string) => {
    const value = localStorage.getItem(key)
    if (value === null) return undefined
    try {
      return JSON.parse(value)
    } catch {
      throw new ProfileError('PROFILE_CORRUPT', `旧资料损坏：${key}`)
    }
  }
  const identityErrors: string[] = []
  const readIdentity = (key: 'player' | 'player-data') => {
    try {
      const value = read(key)
      if (value === undefined) return undefined
      return validateData({ ...result, profile: { id: value?.id, name: value?.name } }).profile
    } catch {
      identityErrors.push(key)
      return undefined
    }
  }
  const primary = readIdentity('player-data'),
    secondary = readIdentity('player')
  if (!primary && !secondary && identityErrors.length)
    throw new ProfileError('PROFILE_CORRUPT', `旧身份损坏：${identityErrors.join('、')}`)
  if (primary && secondary && (primary.id !== secondary.id || primary.name !== secondary.name) && !prefer)
    throw new ProfileError('LEGACY_IDENTITY_CONFLICT', '旧资料身份不一致，请选择 player 或 player-data')
  const identity = prefer === 'player' ? secondary : prefer === 'player-data' ? primary : (primary ?? secondary)
  if (!identity && prefer) throw new ProfileError('PROFILE_CORRUPT', '所选旧身份不可用')
  if (identity) result.profile = identity
  profileMigrationNotice.value = identityErrors.length
    ? `已采用有效身份；损坏的旧记录 ${identityErrors.join('、')} 仍保留，可导出原始数据。`
    : ''
  const pets = read('petStorage')
  if (pets)
    result.library = {
      storage: pets.storage,
      teams: pets.teams?.map(
        (t: { name: string; pets: ProfileData['library']['storage']; ruleSetId?: string; gameMode?: string }) => ({
          name: t.name,
          pets: t.pets,
          ruleSetId: t.ruleSetId ?? (t.gameMode === 'competitive' ? 'competitive_ruleset' : 'casual_standard_ruleset'),
        }),
      ),
      currentTeamIndex: pets.currentTeamIndex,
    }
  for (const key of Object.keys(result.settings) as (keyof ProfileData['settings'])[]) {
    const value = read(`gameSetting.${key}`)
    if (value !== undefined) Object.assign(result.settings, { [key]: value })
  }
  return validateData(result)
}

export async function initializeProfile(prefer?: 'player' | 'player-data') {
  await queue
  profileStatus.value = 'loading'
  remote = !!window.arcadiaRemotePlay
  let storage: ProfileStorage
  if (window.arcadiaDesktop?.profile) {
    const request = window.arcadiaDesktop.profile
    storage = {
      readRaw: async () => {
        const result = await request({ action: 'raw' })
        if (result.error) throw new ProfileError(result.error.code, result.error.message)
        return result.value as string | null
      },
      read: async () => {
        const result = await request({ action: 'read' })
        if (result.error) throw new ProfileError(result.error.code, result.error.message)
        return result.value as Envelope | null
      },
      commit: async (expected, next) => {
        const result = await request({ action: 'commit', expected, next })
        if (result.error) throw new ProfileError(result.error.code, result.error.message)
      },
    }
  } else storage = new BrowserProfileStorage()
  repository = new ProfileRepository(storage)
  try {
    if (remote) {
      const config = await window.arcadiaRemotePlay!.getBootConfig()
      data = config.profile ? validateData(config.profile.data) : defaultWebProfile()
      snapshot = config.profile ?? null
      writable = false
      profileStatus.value = 'memory-only'
    } else {
      const state = await repository.open()
      if (state) publish(state.current)
      else {
        migrationCandidate = prefer ? migrate(prefer) : (migrationCandidate ?? migrate())
        data = migrationCandidate
        publish(await repository.create({ data }))
        migrationCandidate = undefined
      }
      writable = true
      if (!channel && typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('arcadia-profile')
        channel.onmessage = event => {
          if (event.data.revision !== snapshot?.revision) {
            writable = false
            profileStatus.value = 'blocked'
            profileFailure.value = '其他窗口已修改资料，请重新载入'
          }
        }
      }
    }
  } catch (error) {
    writable = false
    profileStatus.value = 'blocked'
    profileFailure.value = error instanceof Error ? error.message : '无法读取个人资料'
  }
  desktopChangeSubscription ??= window.arcadiaDesktop?.onProfileChanged?.(() => {
    writable = false
    profileStatus.value = 'blocked'
    profileFailure.value = '个人资料已更新，请重新载入'
  })
  installProfileStorage({
    read(key) {
      if (key === 'player' || key === 'player-data') return JSON.stringify(data.profile)
      if (key === 'petStorage') return JSON.stringify({ ...data.library, lastMatchingConfig: null })
      const setting = key.slice('gameSetting.'.length) as keyof ProfileData['settings']
      return setting in data.settings ? JSON.stringify(data.settings[setting]) : null
    },
    write(key, value) {
      if (profileStatus.value === 'blocked' || profileSwitching.value) return false
      try {
        const parsed = JSON.parse(value)
        if (key === 'player' || key === 'player-data') {
          if (parsed.id !== data.profile.id) throw new ProfileError('PROFILE_BUSY', '更换 UID 需要断开重连')
          data.profile = { id: parsed.id, name: parsed.name }
        } else if (key === 'petStorage')
          data.library = { storage: parsed.storage, teams: parsed.teams, currentTeamIndex: parsed.currentTeamIndex }
        else {
          const setting = key.slice('gameSetting.'.length)
          if (setting in data.settings) Object.assign(data.settings, { [setting]: parsed })
        }
        saveSoon()
        return true
      } catch (error) {
        failure(error)
        return false
      }
    },
  })
}
export function useTemporaryProfile() {
  writable = false
  profileStatus.value = 'memory-only'
  profileFailure.value = ''
}
export async function exportProfile() {
  await queue
  return repository.exportBackup(data)
}
export async function inspectProfile(bytes: string) {
  if (profileStatus.value !== 'blocked') await flushProfile()
  return repository.inspectImport(bytes)
}
export async function profileRecovery() {
  await flushProfile()
  return (await repository.open())?.recovery ?? null
}
export async function commitProfile(plan: { planId: string; expectedRevision: number | null }) {
  if (!writable && (remote || profileStatus.value !== 'blocked' || (await repository.open()) !== null))
    throw new ProfileError('STORAGE_DENIED', '当前资料未持久保存')
  publish(await repository.commitImport({ ...plan, decision: 'restore' }))
  writable = true
  window.dispatchEvent(new Event('local-profile-changed'))
}
export async function saveRemoteProfile() {
  if (!window.arcadiaRemotePlay?.requestProfileSave) throw new ProfileError('STORAGE_DENIED')
  await window.arcadiaRemotePlay.requestProfileSave({
    data: currentProfileData(),
    expectedRevision: snapshot?.revision ?? null,
  })
}
export async function withProfileSwitch<T>(action: () => Promise<T>, exclusive = true): Promise<T> {
  if (profileSwitching.value) throw new ProfileError('PROFILE_BUSY')
  profileSwitching.value = true
  try {
    if (!exclusive) return await action()
    if (!navigator.locks) throw new ProfileError('PROFILE_BUSY', '当前浏览器不支持安全切换资料')
    return await navigator.locks.request(
      'arcadia-profile-connection',
      { mode: 'exclusive', ifAvailable: true },
      async lock => {
        if (!lock) throw new ProfileError('PROFILE_BUSY', '其他窗口仍连接服务器')
        return action()
      },
    )
  } finally {
    profileSwitching.value = false
  }
}
export async function holdProfileConnection(): Promise<() => void> {
  if (!repository) return () => {}
  if (!profileReady()) throw new ProfileError('PROFILE_BUSY', '个人资料尚未准备好')
  if (!navigator.locks) return () => {}
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  await new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request('arcadia-profile-connection', { mode: 'shared' }, async () => {
        resolve()
        await held
      })
      .catch(reject)
  })
  return release
}

export async function rawProfileData() {
  return repository.rawData()
}
export async function repairProfile(bytes: string, raw: string) {
  publish(await repository.repair(bytes, raw))
  writable = true
}

/** Export only legacy profile keys, as original strings; credentials never enter recovery material. */
export function rawLegacyProfileData() {
  const keys = [
    'player',
    'player-data',
    'petStorage',
    ...Object.keys(defaultData().settings).map(key => `gameSetting.${key}`),
  ]
  return Object.fromEntries(
    keys.flatMap(key => {
      const raw = localStorage.getItem(key)
      return raw === null ? [] : [[key, raw]]
    }),
  )
}
