import { computed, ref, watch } from 'vue'
import { nanoid } from 'nanoid'
import type { PetSchemaType, PlayerSchemaType } from '@arcadia-eternity/schema'
import type {
  ProjectTeamStorage,
  ProjectTeam,
  TeamDraft,
  TeamDocument,
  TeamLibraryDelegate,
} from '@/components/team/library'
import type { TeamEditorDelegate } from '@/components/team/delegate'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const document = (entry: TeamDocument): TeamDocument =>
  copy({
    schemaVersion: 1,
    id: entry.id,
    name: entry.name,
    team: entry.team.map(({ ...pet }) => {
      delete (pet as Partial<PetSchemaType>).id
      return pet
    }),
  })
type Editable = Omit<TeamDraft, 'team'> & { team: PetSchemaType[] }
function editable(entry: ProjectTeam, dirty = false): Editable {
  return { ...copy(entry), dirty, team: entry.team.map(pet => ({ ...copy(pet), id: nanoid() })) }
}

/** Project files, local drafts and launch snapshots have distinct ownership. */
export async function createProjectTeamLibrary(
  storage: ProjectTeamStorage,
  defaults: PlayerSchemaType[],
  fallbackPet?: () => PetSchemaType | undefined,
) {
  const saved = await storage.list()
  const draft = await storage.readDraft()
  const entries = ref<Editable[]>(saved.map(entry => editable(entry)))
  if (draft) {
    if (
      draft.schemaVersion !== 1 ||
      !Array.isArray(draft.entries) ||
      draft.selected?.length !== 2 ||
      draft.names?.length !== 2
    )
      throw new Error('本机测试编队草稿格式无效，请恢复本机草稿备份')
    // Retain dirty bases even if Git changed/deleted the file: save will report its version conflict.
    for (const entry of draft.entries.filter(entry => entry.dirty)) {
      const index = entries.value.findIndex(item => item.id === entry.id)
      const restored = editable(entry, true)
      if (index < 0) entries.value.push(restored)
      else entries.value[index] = restored
    }
  }
  if (!entries.value.length) {
    entries.value = defaults.map((player, index) =>
      editable(
        {
          ...document({ schemaVersion: 1, id: `default-${index + 1}`, name: player.name, team: player.team }),
          version: null,
        },
        true,
      ),
    )
  }
  const selected = ref<[string, string]>(
    [0, 1].map(index => {
      const id = draft?.selected[index]
      return entries.value.find(entry => entry.id === id)?.id ?? entries.value[index]?.id ?? entries.value[0]!.id
    }) as [string, string],
  )
  const names = ref<[string, string]>(draft?.names ?? [defaults[0]!.name, defaults[1]!.name])
  const error = ref('')
  let pending = Promise.resolve()
  function persist() {
    // Invoke immediately so window close cannot strand a renderer-side debounce/queue.
    pending = storage.writeDraft({
      schemaVersion: 1,
      entries: entries.value.map(entry => ({ ...document(entry), version: entry.version, dirty: entry.dirty })),
      selected: copy(selected.value),
      names: copy(names.value),
    })
    void pending.catch(cause => {
      error.value = `草稿暂存失败：${cause instanceof Error ? cause.message : String(cause)}`
    })
  }
  const current = (side: number) => entries.value.find(entry => entry.id === selected.value[side])!
  const players = computed<PlayerSchemaType[]>(() =>
    [0, 1].map(side => ({ id: String(side).repeat(21), name: names.value[side]!, team: current(side).team })),
  )
  const options = computed(() =>
    entries.value.map(entry => ({
      id: entry.id,
      name: `${entry.name}${entry.dirty ? ' *' : ''}`,
      size: entry.team.length,
    })),
  )
  const selectors: TeamLibraryDelegate[] = [0, 1].map(side => ({
    entries: options,
    selected: computed({
      get: () => selected.value[side]!,
      set: id => {
        selected.value[side] = id
        persist()
      },
    }),
  }))
  const editors: TeamEditorDelegate[] = [0, 1].map(side => {
    const changed = persist
    return {
      name: computed(() => current(side).name),
      ready: computed(() => !!current(side)),
      team: computed({
        get: () => current(side).team,
        set: team => {
          current(side).team = team
          changed()
        },
      }),
      persist: changed,
      createPet: () => {
        const template = current(side).team[0] ?? defaults[side]?.team[0]
        return template ? { ...copy(template), id: nanoid() } : fallbackPet?.()
      },
      removePet(id, done) {
        current(side).team = current(side).team.filter(pet => pet.id !== id)
        changed()
        done()
      },
      removeLabel: '移出测试队伍',
    }
  })
  function create(side: number, duplicate = false) {
    const source = current(side)
    const entry: Editable = {
      schemaVersion: 1,
      id: `team-${nanoid().toLowerCase()}`,
      name: duplicate ? `${source.name} 副本` : '新测试队伍',
      team: duplicate ? copy(source.team).map(pet => ({ ...pet, id: nanoid() })) : [],
      version: null,
      dirty: true,
    }
    entries.value.push(entry)
    selected.value[side] = entry.id
    persist()
  }
  function rename(id: string, name: string) {
    const entry = entries.value.find(item => item.id === id)
    if (!entry) throw new Error('队伍已不存在，请重新选择')
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 80) throw new Error('请输入 1–80 个字符的队伍名称')
    entry.name = trimmed
    entry.dirty = true
    persist()
  }
  async function save(side: number) {
    const entry = current(side),
      snapshot = document(entry)
    const result = await storage.files!.save({ document: snapshot, expectedVersion: entry.version })
    entry.version = result.version
    entry.dirty = JSON.stringify(document(entry)) !== JSON.stringify(snapshot)
    persist()
  }
  async function remove(side: number) {
    const entry = current(side)
    if (entries.value.length <= 1) throw new Error('请至少保留一套测试队伍')
    if (entry.version !== null) await storage.files!.remove({ id: entry.id, expectedVersion: entry.version })
    entries.value = entries.value.filter(item => item.id !== entry.id)
    selected.value = selected.value.map(id => (id === entry.id ? entries.value[0]!.id : id)) as [string, string]
    persist()
  }
  let reloading = false
  async function reload(side: number) {
    const entry = current(side)
    const latest = (await storage.list()).find(item => item.id === entry.id)
    if (!latest) throw new Error('项目文件已删除；可复制草稿为新队伍再保存')
    reloading = true
    try {
      entries.value.splice(entries.value.indexOf(entry), 1, editable(latest))
    } finally {
      reloading = false
    }
    persist()
  }
  // The editor may debounce its own persistence. Capture each change before a window can close.
  const stop = watch(
    () => entries.value.map(entry => ({ id: entry.id, text: JSON.stringify(document(entry)) })),
    (next, before) => {
      if (reloading) return
      const previous = new Map(before.map(entry => [entry.id, entry.text]))
      next.forEach((value, index) => {
        if (value.text !== previous.get(value.id)) entries.value[index]!.dirty = true
      })
      persist()
    },
    { flush: 'sync' },
  )
  persist()
  return {
    dispose: stop,
    entries,
    selected,
    names,
    players,
    selectors,
    editors,
    error,
    persist,
    create,
    rename,
    files: storage.files ? { save, remove, reload } : undefined,
    current,
    flush: () => pending,
  }
}
