<script setup lang="ts">
// Throwaway: compare library, split-pane and workflow layouts on /content?variant=A|B|C.
// All mutations use illustrative in-memory data; no installation or publication occurs.
import { computed, onMounted, onBeforeUnmount, ref, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute(),
  router = useRouter()
const variant = computed(() => String(route.query.variant || 'A'))
const titles = ['A · 游戏库', 'B · 分栏工作台', 'C · 任务流程']
const section = ref<'environments' | 'packages'>('environments')
const query = ref(''),
  filter = ref('all'),
  selected = ref('friends'),
  message = ref('')
const tab = ref('内容组合'),
  editing = ref(false),
  draftName = ref('')
const packages = ref([
  {
    id: 'base',
    name: '官方基础内容',
    subtitle: 'Arcadia Eternity · 4.0.0-preview.1',
    description: '基础精灵、技能与印记，每个环境都会包含。',
    icon: 'AE',
    color: 'blue',
    state: '内置',
    count: '168 精灵 · 842 技能',
    enabled: true,
  },
  {
    id: 'ice',
    name: '霜境冒险',
    subtitle: '@community/frost · 1.2.0',
    description: '冰雪主题精灵与技能，适合朋友之间的休闲对战。',
    icon: '霜',
    color: 'teal',
    state: '已安装',
    count: '12 精灵 · 36 技能',
    enabled: true,
  },
  {
    id: 'arena',
    name: '竞技拓展',
    subtitle: '@community/arena · 2.0.1',
    description: '一组面向竞技对战的精灵与平衡调整。',
    icon: '竞',
    color: 'violet',
    state: '已安装',
    count: '8 精灵 · 24 技能',
    enabled: false,
  },
  {
    id: 'forest',
    name: '森林奇遇',
    subtitle: '@community/forest · 0.9.0',
    description: '缺少依赖 @community/nature，补齐后可以使用。',
    icon: '森',
    color: 'amber',
    state: '需处理',
    count: '6 精灵 · 18 技能',
    enabled: false,
  },
])
// Proposed metadata presentation. Values below are illustrative, not installed-package facts.
const packageTab = ref('简介')
const packageMetadata: Record<
  string,
  {
    author: string
    version: string
    name: string
    namespace: string
    license: string
    compatibility: string
    source: string
    dependencies: { name: string; version: string; available: boolean }[]
  }
> = reactive({
  base: {
    author: 'Arcadia Eternity',
    version: '4.0.0-preview.1',
    name: '@arcadia-eternity/data-pack-base',
    namespace: 'base',
    license: 'MIT',
    compatibility: 'V4 引擎',
    source: '游戏内置',
    dependencies: [],
  },
  ice: {
    author: '霜境创作组',
    version: '1.2.0',
    name: '@community/frost',
    namespace: 'frost',
    license: '未提供',
    compatibility: 'V4 引擎 · 示例声明',
    source: 'npm · @community/frost@1.2.0',
    dependencies: [{ name: '官方基础内容', version: '4.0.0-preview.1', available: true }],
  },
  arena: {
    author: '竞技拓展维护组',
    version: '2.0.1',
    name: '@community/arena',
    namespace: 'arena',
    license: '未提供',
    compatibility: '尚未声明',
    source: '本地文件 · arena-2.0.1.tgz',
    dependencies: [{ name: '官方基础内容', version: '4.0.0-preview.1', available: true }],
  },
  forest: {
    author: '森林创作组',
    version: '0.9.0',
    name: '@community/forest',
    namespace: 'forest',
    license: '未提供',
    compatibility: 'V4 引擎 · 示例声明',
    source: 'npm · @community/forest@0.9.0',
    dependencies: [{ name: '@community/nature', version: '^1.0.0', available: false }],
  },
})
// Finite demo catalog: candidate sets below illustrate range intersections, not npm resolution.
packages.value.push(
  {
    id: 'nature',
    name: '自然基础',
    subtitle: '@community/nature · 1.6.3',
    description: '森林与竞技拓展共用的自然内容。',
    icon: '源',
    color: 'teal',
    state: '未安装',
    count: '4 精灵 · 12 技能',
    enabled: false,
  },
  {
    id: 'nature-v2',
    name: '自然基础',
    subtitle: '@community/nature · 2.1.0',
    description: '自然内容的第二个主版本。',
    icon: '源',
    color: 'teal',
    state: '未安装',
    count: '5 精灵 · 16 技能',
    enabled: false,
  },
  {
    id: 'wild',
    name: '荒野挑战',
    subtitle: '@community/wild · 1.0.0',
    description: '依赖自然基础 2.x，用于演示与森林奇遇的版本冲突。',
    icon: '野',
    color: 'amber',
    state: '未安装',
    count: '3 精灵 · 9 技能',
    enabled: false,
  },
)
for (const [id, version] of [
  ['nature', '1.6.3'],
  ['nature-v2', '2.1.0'],
] as const)
  packageMetadata[id] = {
    author: '自然内容维护组',
    version,
    name: '@community/nature',
    namespace: 'nature',
    license: '未提供',
    compatibility: 'V4 · 示例声明',
    source: `npm · @community/nature@${version}`,
    dependencies: [{ name: '官方基础内容', version: '4.0.0-preview.1', available: true }],
  }
packageMetadata.wild = {
  author: '荒野创作组',
  version: '1.0.0',
  name: '@community/wild',
  namespace: 'wild',
  license: '未提供',
  compatibility: 'V4 · 示例声明',
  source: 'npm · @community/wild@1.0.0',
  dependencies: [{ name: '@community/nature', version: '^2.0.0', available: false }],
}
packageMetadata.arena!.dependencies.push({ name: '@community/nature', version: '>=1.5.0 <2.0.0', available: false })
const metadata = computed(() => (current.value ? packageMetadata[current.value.id] : undefined))
const environments = ref([
  {
    id: 'friends',
    name: '好友休闲',
    subtitle: 'friends · 今天 14:32 更新',
    description: '和朋友一起体验基础内容与霜境冒险。',
    icon: '友',
    color: 'teal',
    state: '已准备',
    count: '2 个内容包 · 1 个固定版本',
    packageIds: ['base', 'ice'],
    revision: 1,
  },
  {
    id: 'ranked',
    name: '标准竞技',
    subtitle: 'ranked · 昨天更新',
    description: '官方内容与竞技拓展，队伍最多 6 只精灵。',
    icon: '竞',
    color: 'blue',
    state: '草稿',
    count: '2 个内容包 · 尚未准备',
    packageIds: ['base', 'arena'],
    revision: 0,
  },
  {
    id: 'explore',
    name: '新玩法试验',
    subtitle: 'explore · 3 天前更新',
    description: '先调整内容组合，再准备可用于对战的固定版本。',
    icon: '新',
    color: 'violet',
    state: '草稿',
    count: '1 个内容包 · 尚未准备',
    packageIds: ['base'],
    revision: 0,
  },
])
const rows = computed(() =>
  (section.value === 'environments' ? environments.value : packages.value).filter(
    item =>
      (item.name + item.subtitle).toLowerCase().includes(query.value.trim().toLowerCase()) &&
      (filter.value === 'all' || item.state === filter.value),
  ),
)
const current = computed(() => rows.value.find(item => item.id === selected.value) ?? rows.value[0])
const currentEnvironment = computed(() => environments.value.find(item => item.id === current.value?.id))
function switchSection(value: typeof section.value) {
  panel.value = ''
  section.value = value
  query.value = ''
  filter.value = 'all'
  editing.value = false
  tab.value = '内容组合'
}
function cycle(direction: number) {
  const index = ['A', 'B', 'C'].indexOf(variant.value)
  void router.replace({ query: { ...route.query, variant: ['A', 'B', 'C'][(index + direction + 3) % 3] } })
}
function key(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    cycle(event.key === 'ArrowLeft' ? -1 : 1)
  }
}
onMounted(() => window.addEventListener('keydown', key))
onBeforeUnmount(() => window.removeEventListener('keydown', key))
function prepare() {
  if (currentEnvironment.value) planEnvironment(currentEnvironment.value.id)
}
function create() {
  editing.value = true
  draftName.value = ''
}
function save() {
  if (!draftName.value.trim()) return
  const id = `demo-${++nextEnvironment}`
  environments.value.push({
    id,
    name: draftName.value.trim(),
    subtitle: `${id} · 刚刚创建`,
    description: '新环境已包含官方基础内容。',
    icon: '新',
    color: 'blue',
    state: '草稿',
    count: '1 个内容包 · 尚未准备',
    packageIds: ['base'],
    revision: 0,
  })
  selected.value = id
  query.value = ''
  filter.value = 'all'
  editing.value = false
  message.value = '演示草稿已创建，选择内容包后准备版本。'
}

// Lifecycle sandbox: captured plans and immutable version snapshots, all in memory.
type Environment = (typeof environments.value)[number]
type FixedVersion = {
  id: string
  environmentId: string
  number: number
  name: string
  packageIds: string[]
  lockedRows: PlanRow[]
  signature: string
}
type PlanRow = { id: string; name: string; version: string; reason: string; missing: boolean }
type Plan = {
  kind: 'prepare' | 'install'
  targetId: string
  title: string
  signature: string
  packageIds: string[]
  rows: PlanRow[]
}
type Job = {
  id: number
  title: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  phase: string
  plan: Plan
  detail: string
  downloaded: number
  total: number
  stage: number
  fail: boolean
}
const panel = ref<
  | ''
  | 'plan'
  | 'version'
  | 'delete-environment'
  | 'uninstall'
  | 'add-package'
  | 'add-to'
  | 'tasks'
  | 'installation'
  | 'conflict'
  | 'disable'
>('')
const plan = ref<Plan>()
const offline = ref(false),
  simulateFailure = ref(false)
const jobs = ref<Job[]>([])
const activeJob = computed(() => jobs.value.find(job => job.status === 'running'))
const latestJob = computed(() => jobs.value[0])
const taskFilter = ref('all')
const pendingJobs = computed(() => jobs.value.filter(job => job.status === 'queued' || job.status === 'running'))
const visibleJobs = computed(() =>
  jobs.value.filter(
    job =>
      taskFilter.value === 'all' ||
      (taskFilter.value === 'active'
        ? job.status === 'queued' || job.status === 'running'
        : taskFilter.value === 'failed'
          ? job.status === 'failed' || job.status === 'cancelled'
          : job.status === 'succeeded'),
  ),
)
const duplicatePlan = computed(
  () =>
    !!plan.value &&
    pendingJobs.value.some(
      job =>
        job.plan.kind === plan.value!.kind &&
        job.plan.targetId === plan.value!.targetId &&
        job.plan.signature === plan.value!.signature,
    ),
)
function clearFinished() {
  jobs.value = jobs.value.filter(job => job.status === 'queued' || job.status === 'running')
}
function demoDownload() {
  planInstall('forest')
  executePlan()
}

const versionId = ref('friends-v1')
const localVersionId = ref('friends-v1')
const confirmDelete = ref(false)
const addTarget = ref('friends')
const chosenInstall = ref('forest')
let nextEnvironment = 0
let jobSequence = 0
let taskTimer: ReturnType<typeof setTimeout> | undefined
const signature = (env: Environment) => JSON.stringify([...env.packageIds].sort())
const versions = ref<FixedVersion[]>([
  {
    id: 'friends-v1',
    environmentId: 'friends',
    number: 1,
    name: '好友休闲',
    packageIds: ['base', 'ice'],
    lockedRows: ['base', 'ice'].map(id => ({
      id,
      name: packages.value.find(pkg => pkg.id === id)!.name,
      version: packageMetadata[id]!.version,
      reason: '直接选择',
      missing: false,
    })),
    signature: signature(environments.value[0]!),
  },
])
const selectedVersion = computed(() => versions.value.find(version => version.id === versionId.value))
const environmentVersions = computed(() =>
  versions.value
    .filter(version => version.environmentId === currentEnvironment.value?.id)
    .slice()
    .reverse(),
)
const affectedDrafts = computed(() =>
  environments.value.filter(env => env.packageIds.includes(current.value?.id ?? '')),
)
const affectedVersions = computed(() =>
  versions.value.filter(version => version.packageIds.includes(current.value?.id ?? '')),
)
const planStale = computed(() => {
  if (plan.value?.kind !== 'prepare') return false
  const env = environments.value.find(env => env.id === plan.value?.targetId)
  return !env || signature(env) !== plan.value.signature
})
const planMissing = computed(() => plan.value?.rows.filter(row => row.missing) ?? [])
const installationFilter = ref('all')
const installationRows = computed(() =>
  packages.value
    .map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      version: packageMetadata[pkg.id]!.version,
      kind: pkg.id === 'base' ? '内置材料' : pkg.id.startsWith('nature') ? '共享资源包' : '直接安装',
      state: pkg.state,
      drafts: environments.value.filter(env => env.packageIds.includes(pkg.id)).map(env => env.name),
      copies: versions.value.filter(version => version.packageIds.includes(pkg.id)).length,
      task: activeJob.value?.plan.packageIds.includes(pkg.id) ? activeJob.value.phase : '',
    }))
    .filter(
      row =>
        installationFilter.value === 'all' ||
        (installationFilter.value === 'dependencies'
          ? row.kind === '共享资源包'
          : row.state === '未安装' || row.state === '需处理'),
    ),
)
const localVersion = computed(() => versions.value.find(version => version.id === localVersionId.value))
function inspectInstallation(id: string, action: 'detail' | 'install' | 'uninstall') {
  switchSection('packages')
  selected.value = id
  if (action === 'install') planInstall(id)
  else if (action === 'uninstall') panel.value = 'uninstall'
}
function syncEnvironment(env: Environment) {
  const own = versions.value.filter(version => version.environmentId === env.id)
  env.count = `${env.packageIds.length} 个内容包 · ${own.length} 个固定版本`
  env.state = own.some(version => version.signature === signature(env)) ? '已准备' : '草稿'
}
type Composition = { roots: string[]; members: string[] }
const compositions = reactive<Record<string, Composition>>({})
const pendingPackage = ref('forest')
const conflict = ref<{ title: string; lines: string[] }>()
const disableRequest = ref<{ envId: string; id: string; dependents: string[]; signature: string }>()
function composition(env: Environment): Composition {
  return (compositions[env.id] ??= { roots: [...env.packageIds], members: [...env.packageIds] })
}
const memberPackages = computed(() =>
  currentEnvironment.value
    ? composition(currentEnvironment.value)
        .members.map(id => packages.value.find(pkg => pkg.id === id)!)
        .filter(Boolean)
    : [],
)
const packageName = (id: string) => packageMetadata[id]!.name
const dependencyName = (name: string) => (name === '官方基础内容' ? packageName('base') : name)
function candidates(name: string, range: string): string[] {
  // Explicit fixtures only; real integration will consume npm's validated resolution plan.
  if (name === packageName('base')) return range === '4.0.0-preview.1' ? ['base'] : []
  if (name === '@community/nature')
    return range === '^2.0.0' ? ['nature-v2'] : ['^1.0.0', '>=1.5.0 <2.0.0'].includes(range) ? ['nature'] : []
  return packages.value
    .filter(pkg => packageName(pkg.id) === name && packageMetadata[pkg.id]!.version === range)
    .map(pkg => pkg.id)
}
function resolveComposition(roots: string[]): { ids: string[]; errors: string[] } {
  const selectedByName = new Map(roots.map(id => [packageName(id), id]))
  let ids = [...selectedByName.values()]
  for (let iteration = 0; iteration < 12; iteration++) {
    const requirements = new Map<string, { source: string; range: string; ids: string[] }[]>()
    const add = (name: string, source: string, range: string, choices: string[]) =>
      requirements.set(name, [...(requirements.get(name) ?? []), { source, range, ids: choices }])
    for (const id of roots) add(packageName(id), '环境直接选择', packageMetadata[id]!.version, [id])
    for (const id of ids)
      for (const dep of packageMetadata[id]!.dependencies)
        add(
          dependencyName(dep.name),
          packages.value.find(pkg => pkg.id === id)!.name,
          dep.version,
          candidates(dependencyName(dep.name), dep.version),
        )
    const next: string[] = [],
      errors: string[] = []
    for (const [name, reqs] of requirements) {
      const choices = reqs[0]!.ids.filter(id => reqs.every(req => req.ids.includes(id)))
      if (!choices.length) errors.push(...reqs.map(req => `${req.source} → ${name} ${req.range}`))
      else next.push(choices.find(id => ids.includes(id)) ?? choices[0]!)
    }
    if (errors.length) return { ids: [], errors }
    if (JSON.stringify([...next].sort()) === JSON.stringify([...ids].sort())) {
      const sorted: string[] = [],
        visiting = new Set<string>(),
        visited = new Set<string>()
      const visit = (id: string): boolean => {
        if (visiting.has(id)) return false
        if (visited.has(id)) return true
        visiting.add(id)
        for (const dep of packageMetadata[id]!.dependencies) {
          const child = next.find(other => packageName(other) === dependencyName(dep.name))
          if (!child || !visit(child)) return false
        }
        visiting.delete(id)
        visited.add(id)
        sorted.push(id)
        return true
      }
      return next.every(visit)
        ? { ids: sorted, errors: [] }
        : { ids: [], errors: ['必需依赖存在循环，无法按依赖顺序装配。'] }
    }
    ids = next
  }
  return { ids: [], errors: ['示例依赖图未收敛，不能提交。'] }
}
function introducedBy(env: Environment, id: string): string[] {
  return env.packageIds
    .filter(other => packageMetadata[other]!.dependencies.some(dep => dependencyName(dep.name) === packageName(id)))
    .map(other => packages.value.find(pkg => pkg.id === other)!.name)
}
function applyRoots(env: Environment, roots: string[]): boolean {
  const result = resolveComposition(roots)
  if (result.errors.length) {
    conflict.value = { title: '资源包版本不兼容', lines: result.errors }
    panel.value = 'conflict'
    return false
  }
  const state = composition(env)
  state.roots = [...roots]
  // Keep disabled members, but replace any older version of the same resource identity.
  state.members = [
    ...state.members.filter(id => !result.ids.some(other => packageName(other) === packageName(id))),
    ...result.ids,
  ]
  env.packageIds = result.ids
  syncEnvironment(env)
  return true
}
function addMember(env: Environment, id: string): boolean {
  const roots = composition(env).roots.filter(other => packageName(other) !== packageName(id))
  return applyRoots(env, [...roots, id])
}
function addSelectedMember() {
  if (currentEnvironment.value && addMember(currentEnvironment.value, pendingPackage.value))
    message.value = '已加入并启用；全部必需资源包已显式列出，每个包只使用一个版本。'
}
function dependsOn(id: string, target: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false
  seen.add(id)
  return packageMetadata[id]!.dependencies.some(
    dep =>
      dependencyName(dep.name) === packageName(target) ||
      candidates(dependencyName(dep.name), dep.version).some(child => dependsOn(child, target, seen)),
  )
}
function toggleMember(id: string, enabled: boolean) {
  const env = currentEnvironment.value
  if (!env || id === 'base') return
  if (enabled) {
    if (addMember(env, id)) message.value = '已启用此包及它的必需依赖。'
    return
  }
  const dependents = env.packageIds.filter(other => other !== id && dependsOn(other, id))
  if (dependents.length) {
    disableRequest.value = { envId: env.id, id, dependents, signature: signature(env) }
    panel.value = 'disable'
    return
  }
  applyRoots(
    env,
    composition(env).roots.filter(other => other !== id),
  )
  message.value = '已停用；无其他启用来源的自动依赖同步停用，材料保留。'
}
function confirmDisable() {
  const request = disableRequest.value,
    env = environments.value.find(item => item.id === request?.envId)
  if (!request || !env) return
  if (signature(env) !== request.signature) {
    message.value = '环境已变化，请重新选择停用对象。'
    panel.value = ''
    return
  }
  if (
    applyRoots(
      env,
      composition(env).roots.filter(id => id !== request.id && !request.dependents.includes(id)),
    )
  ) {
    panel.value = ''
    message.value = '已同时停用依赖方，其他独立启用的内容保持不变。'
  }
}
function resolveRows(ids: string[]): PlanRow[] {
  return ids.map(id => ({
    id,
    name: packages.value.find(pkg => pkg.id === id)!.name,
    version: packageMetadata[id]!.version,
    reason:
      ids
        .filter(other => packageMetadata[other]!.dependencies.some(dep => dependencyName(dep.name) === packageName(id)))
        .map(other => packages.value.find(pkg => pkg.id === other)!.name)
        .join('、') || '环境直接选择',
    missing: packages.value.find(pkg => pkg.id === id)!.state === '未安装',
  }))
}
function planEnvironment(id: string) {
  const env = environments.value.find(env => env.id === id)
  if (!env) return
  plan.value = {
    kind: 'prepare',
    targetId: id,
    title: env.name,
    signature: signature(env),
    packageIds: [...env.packageIds],
    rows: resolveRows(env.packageIds),
  }
  panel.value = 'plan'
}
function planInstall(id: string) {
  const resolved = resolveComposition([id])
  if (resolved.errors.length) {
    conflict.value = { title: '无法生成安装计划', lines: resolved.errors }
    panel.value = 'conflict'
    return
  }
  plan.value = {
    kind: 'install',
    targetId: id,
    title: packages.value.find(pkg => pkg.id === id)!.name,
    signature: '',
    packageIds: resolved.ids,
    rows: resolveRows(resolved.ids),
  }
  panel.value = 'plan'
}
function refreshPlan() {
  if (!plan.value) return
  if (plan.value.kind === 'prepare') planEnvironment(plan.value.targetId)
  else planInstall(plan.value.targetId)
}
function acquireMaterials(captured: Plan) {
  for (const id of captured.packageIds) {
    const pkg = packages.value.find(pkg => pkg.id === id)!
    if (pkg.state !== '内置') pkg.state = '已安装'
  }
  for (const metadata of Object.values(packageMetadata))
    for (const dep of metadata.dependencies)
      dep.available = candidates(dependencyName(dep.name), dep.version).some(id =>
        ['内置', '已安装'].includes(packages.value.find(pkg => pkg.id === id)!.state),
      )
}
function executePlan() {
  if (!plan.value || duplicatePlan.value || planStale.value || (offline.value && planMissing.value.length)) return
  const captured: Plan = JSON.parse(JSON.stringify(plan.value))
  const fail = simulateFailure.value
  const job = reactive<Job>({
    id: ++jobSequence,
    title: `${captured.title} · ${captured.kind === 'prepare' ? '准备版本' : '安装材料'}`,
    status: 'queued',
    phase: '等待开始',
    downloaded: 0,
    total: captured.rows.filter(row => row.missing).length * 12,
    stage: 0,
    fail,
    plan: captured,
    detail: '模拟任务；可切换页面，结果仍属于此对象。',
  })
  jobs.value.unshift(job)
  panel.value = 'tasks'
  taskFilter.value = 'all'
  startNextJob()
}
function startNextJob() {
  if (activeJob.value) return
  const job = [...jobs.value].reverse().find(item => item.status === 'queued')
  if (!job) return
  job.status = 'running'
  job.phase = job.total ? '下载材料' : '校验本机材料'
  const captured = job.plan
  const advance = (step: number) => {
    taskTimer = setTimeout(() => {
      if (job.status !== 'running') return
      if (step === 0) {
        if (job.downloaded < job.total) {
          job.downloaded = Math.min(job.total, job.downloaded + 3)
          job.detail = `模拟下载 ${job.downloaded} / ${job.total} MB；大小与进度仅用于演示。`
          advance(0)
          return
        }
        acquireMaterials(captured)
        job.stage = 1
        job.phase = '材料已校验'
        job.detail = '已获取的材料将保留；取消不会卸载这些材料。'
        advance(1)
      } else if (step === 1) {
        if (job.fail) {
          job.status = 'failed'
          job.phase = '模拟装配失败'
          job.detail = '材料已保留，未生成新固定版本，旧版本仍可用。重新检查后可重试。'
          startNextJob()
          return
        }
        job.stage = 2
        job.phase = captured.kind === 'prepare' ? '装配固定版本' : '登记安装结果'
        advance(2)
      } else {
        if (captured.kind === 'prepare') {
          const env = environments.value.find(env => env.id === captured.targetId)
          if (!env || signature(env) !== captured.signature) {
            job.status = 'failed'
            job.phase = '草稿已变化'
            job.detail = '材料已保留。请根据最新草稿重新检查计划，未提交过期版本。'
            startNextJob()
            return
          }
          const number = ++env.revision
          const version: FixedVersion = {
            id: `${env.id}-v${number}`,
            environmentId: env.id,
            number,
            name: env.name,
            packageIds: [...captured.packageIds],
            lockedRows: captured.rows.map(row => ({ ...row, missing: false })),
            signature: captured.signature,
          }
          versions.value.push(version)
          syncEnvironment(env)
          job.detail = `v${number} 已准备。尚未改变本机选用版本或发布到服务器。`
        } else job.detail = '材料已安装；已有环境配方与本机游玩选择保持不变。'
        job.status = 'succeeded'
        job.phase = '已完成'
        job.stage = 3
        startNextJob()
      }
    }, 700)
  }
  advance(0)
}
function cancelJob(job: Job) {
  if (job.status !== 'running' && job.status !== 'queued') return
  if (job.status === 'running') clearTimeout(taskTimer)
  job.status = 'cancelled'
  job.phase = '已取消'
  job.detail = '未提交新固定版本；此前校验完成的材料保留，旧版本继续可用。'
  startNextJob()
}
function retryJob(job: Job) {
  simulateFailure.value = false
  if (job.plan.kind === 'prepare') planEnvironment(job.plan.targetId)
  else planInstall(job.plan.targetId)
}
function openResult(job: Job) {
  switchSection(job.plan.kind === 'prepare' ? 'environments' : 'packages')
  selected.value = job.plan.targetId
  tab.value = '固定版本'
}
function openVersion(version: FixedVersion) {
  versionId.value = version.id
  confirmDelete.value = false
  panel.value = 'version'
}
function removeVersion() {
  const version = selectedVersion.value
  if (!version || localVersionId.value === version.id || activeJob.value) return
  versions.value = versions.value.filter(item => item.id !== version.id)
  const env = environments.value.find(env => env.id === version.environmentId)
  if (env) syncEnvironment(env)
  panel.value = ''
  if (section.value === 'environments') tab.value = '固定版本'
  message.value = '固定版本已删除（演示）。'
}
function duplicateEnvironment() {
  if (!currentEnvironment.value) return
  const env = {
    ...currentEnvironment.value,
    id: `demo-${++nextEnvironment}`,
    name: currentEnvironment.value.name + ' 副本',
    packageIds: [...currentEnvironment.value.packageIds],
    revision: 0,
  }
  compositions[env.id] = {
    roots: [...composition(currentEnvironment.value).roots],
    members: [...composition(currentEnvironment.value).members],
  }
  syncEnvironment(env)
  environments.value.push(env)
  selected.value = env.id
  message.value = '已复制配方，不复制固定版本或使用关系。'
}
function removeEnvironment() {
  const env = currentEnvironment.value
  if (!env || versions.value.some(version => version.environmentId === env.id) || activeJob.value) return
  environments.value = environments.value.filter(item => item.id !== env.id)
  panel.value = ''
  message.value = '环境草稿已删除（演示）。'
}
function uninstallPackage() {
  const pkg = current.value
  if (!pkg || pkg.id === 'base' || activeJob.value) return
  pkg.state = '未安装'
  panel.value = ''
  message.value = '安装条目已移除；配方保留，已有固定版本持有独立材料（演示）。'
}
function addToEnvironment() {
  const env = environments.value.find(env => env.id === addTarget.value)
  if (!env || !current.value) return
  if (!addMember(env, current.value.id)) return
  switchSection('environments')
  selected.value = env.id
  message.value = '已加入环境；共享依赖只选一个版本，并全部列为环境成员。'
}
function otherVersion() {
  const pkg = current.value
  if (!pkg || pkg.id === 'base') return
  const id = `${pkg.id}-next`
  if (!packages.value.some(item => item.id === id)) {
    const meta = packageMetadata[pkg.id]!
    const version = meta.version === '1.2.0' ? '1.3.0' : `${meta.version}-preview`
    packages.value.push({
      ...packages.value.find(item => item.id === pkg.id)!,
      id,
      subtitle: `${meta.name} · ${version}`,
      state: '未安装',
    })
    packageMetadata[id] = {
      ...meta,
      version,
      dependencies: meta.dependencies.map(dep => ({ ...dep })),
      source: `npm · ${meta.name}@${version}`,
    }
  }
  selected.value = id
  query.value = ''
  filter.value = 'all'
  planInstall(id)
}
function exportVersion() {
  if (!selectedVersion.value) return
  message.value = `演示导出预览：${selectedVersion.value.name} v${selectedVersion.value.number}，包含 ${selectedVersion.value.lockedRows.length} 个锁定包；真实环境文件需由正式后端生成。`
}
watch(
  () => current.value?.id,
  () => {
    panel.value = ''
    confirmDelete.value = false
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => clearTimeout(taskTimer))
for (const env of environments.value) applyRoots(env, [...env.packageIds])
</script>
<template>
  <main class="prototype" :class="'variant-' + variant">
    <div class="demo-note"><span>交互原型 · 示例数据</span><span>仅在本页模拟，刷新后重置</span></div>
    <header class="heading">
      <div>
        <p class="eyebrow">CONTENT WORKSPACE / 本机内容</p>
        <h1>{{ section === 'environments' ? '我的环境' : '资源包' }}</h1>
        <p>
          {{
            section === 'environments'
              ? '把喜欢的内容组合成玩法，准备好后再开始对战。'
              : '管理安装的内容，查看它们能为你的环境带来什么。'
          }}
        </p>
      </div>
      <button class="primary" @click="section === 'environments' ? create() : (panel = 'add-package')">
        ＋ {{ section === 'environments' ? '新建环境' : '添加资源包' }}
      </button>
    </header>
    <nav class="section-tabs">
      <button :class="{ active: section === 'environments' }" @click="switchSection('environments')">
        环境 <span>{{ environments.length }}</span></button
      ><button :class="{ active: section === 'packages' }" @click="switchSection('packages')">
        资源包 <span>{{ packages.length }}</span></button
      ><span class="scope">◉ 本机工作区</span
      ><button class="installation-entry" @click="panel = 'tasks'">
        ↓ 下载与安装 <span v-if="pendingJobs.length">{{ pendingJobs.length }}</span>
      </button>
    </nav>
    <p v-if="message" class="feedback" role="status">
      {{ message }} <button @click="message = ''" aria-label="关闭提示">×</button>
    </p>
    <form v-if="editing" class="create-form" @submit.prevent="save">
      <label>环境名称<input v-model="draftName" placeholder="例如：周末好友对战" required /></label
      ><button class="primary">创建草稿</button><button type="button" @click="editing = false">取消</button>
    </form>
    <div class="toolbar">
      <input
        v-model="query"
        type="search"
        :placeholder="section === 'environments' ? '搜索环境名称或标识…' : '搜索包名、作者…'"
        aria-label="搜索"
      /><select v-model="filter" aria-label="筛选状态">
        <option value="all">全部状态</option>
        <template v-if="section === 'environments'"
          ><option>已准备</option>
          <option>草稿</option></template
        ><template v-else
          ><option>已安装</option>
          <option>需处理</option>
          <option>未安装</option>
          <option>内置</option></template
        ></select
      ><span>{{ rows.length }} 项</span>
    </div>
    <section v-if="variant === 'C'" class="workflow">
      <div>
        <b>01</b><strong>{{ section === 'environments' ? '选择环境' : '安装内容' }}</strong
        ><small>从列表中选择要管理的内容</small>
      </div>
      <div>
        <b>02</b><strong>{{ section === 'environments' ? '调整组合' : '查看详情' }}</strong
        ><small>确认内容包、规则与依赖</small>
      </div>
      <div>
        <b>03</b><strong>{{ section === 'environments' ? '准备固定版本' : '加入环境' }}</strong
        ><small>确认后使用，已有版本保持独立</small>
      </div>
    </section>
    <div class="body-layout">
      <section class="items" aria-label="内容列表">
        <button
          v-for="item in rows"
          :key="item.id"
          class="item"
          :class="{ selected: current?.id === item.id }"
          @click="
            () => {
              selected = item.id
              tab = '内容组合'
            }
          "
        >
          <span class="cover" :class="item.color"
            ><span>{{ item.icon }}</span
            ><small v-if="variant === 'A'"
              >ARCADIA / {{ section === 'environments' ? 'ENVIRONMENT' : 'PACKAGE' }}</small
            ></span
          >
          <span class="item-copy"
            ><span class="item-title"
              >{{ item.name
              }}<span class="badge" :class="{ ready: item.state === '已准备', warning: item.state === '需处理' }">{{
                item.state
              }}</span></span
            ><small>{{ item.subtitle }}</small>
            <p v-if="variant !== 'B'">{{ item.description }}</p>
            <span class="counts">{{ item.count }}</span></span
          ><span class="chevron">↗</span>
        </button>
        <div v-if="!rows.length" class="empty">
          <h3>没有匹配的内容</h3>
          <p>试试其他名称，或重置筛选。</p>
          <button
            @click="
              () => {
                query = ''
                filter = 'all'
              }
            "
          >
            重置筛选
          </button>
        </div>
      </section>
      <aside v-if="panel" class="detail lifecycle-panel" aria-label="生命周期管理">
        <div class="detail-heading">
          <button class="text-button" @click="panel = ''">← 返回详情</button><span class="badge">本机 · 演示</span>
        </div>
        <template v-if="panel === 'conflict' && conflict">
          <h2>{{ conflict.title }}</h2>
          <p class="muted">没有共同可用版本。本次变更未保存，原环境保持不变。</p>
          <div class="detail-content">
            <div class="dependency-warning">
              <strong>冲突的依赖要求</strong>
              <p v-for="line in conflict.lines" :key="line">{{ line }}</p>
            </div>
            <p>示例目录中，自然基础 1.6.3 满足 ^1.0.0 与 &gt;=1.5.0 &lt;2.0.0；2.1.0 满足 ^2.0.0，两组没有交集。</p>
            <p class="muted">
              可以停用不兼容的依赖方后重新添加，或把它们放到不同环境。不会强制覆盖版本或安装私有副本。
            </p>
          </div>
          <div class="next-step"><button class="primary" @click="panel = ''">保留原组合，返回调整</button></div>
        </template>
        <template v-else-if="panel === 'disable' && disableRequest">
          <h2>此包仍被其他成员依赖</h2>
          <p class="muted">不能单独停用 {{ packages.find(pkg => pkg.id === disableRequest!.id)?.name }}。</p>
          <div class="detail-content">
            <h3>同时停用将影响</h3>
            <p v-for="id in disableRequest.dependents" :key="id" class="usage">
              {{ packages.find(pkg => pkg.id === id)?.name }}
            </p>
            <p>资源包仍保留在环境列表与材料库中，已有固定版本不变。</p>
          </div>
          <div class="next-step">
            <button @click="panel = ''">保持启用</button><button @click="confirmDisable">同时停用依赖方</button>
          </div>
        </template>
        <template v-else-if="panel === 'installation'">
          <h2>本机材料清单</h2>
          <p class="muted">本机材料与固定版本独立管理；安装新包不改变游玩选择。</p>
          <div class="detail-content">
            <div class="installation-current">
              <div>
                <strong>本机选用</strong
                ><small>{{
                  localVersion ? `${localVersion.name} · v${localVersion.number}` : '尚未选用固定版本'
                }}</small>
              </div>
              <button v-if="localVersion" @click="openVersion(localVersion)">管理引用</button>
            </div>
            <nav class="detail-tabs" aria-label="安装状态筛选">
              <button
                v-for="option in [
                  { id: 'all', label: '全部材料' },
                  { id: 'dependencies', label: '自动依赖' },
                  { id: 'issues', label: '需处理' },
                ]"
                :key="option.id"
                :class="{ active: installationFilter === option.id }"
                @click="installationFilter = option.id"
              >
                {{ option.label }}
              </button>
            </nav>
            <p v-if="!installationRows.length" class="muted">没有需要处理的材料。</p>
            <div v-for="row in installationRows" :key="row.id" class="installed-row">
              <div>
                <strong
                  >{{ row.name }} <code>{{ row.version }}</code></strong
                ><small
                  >{{ row.kind }} · {{ row.drafts.length ? '草稿：' + row.drafts.join('、') : '无草稿选择' }} ·
                  {{ row.copies }} 份固定副本</small
                ><small v-if="row.task">任务：{{ row.task }}</small
                ><small v-if="row.kind === '共享资源包'">环境中显式列出，由所有依赖方共同约束版本。</small>
              </div>
              <span class="badge" :class="row.state === '需处理' || row.state === '未安装' ? 'warning' : 'ready'">{{
                row.state
              }}</span>
              <div class="installed-actions">
                <button
                  v-if="row.state === '未安装' || row.state === '需处理'"
                  :disabled="!!activeJob"
                  @click="inspectInstallation(row.id, 'install')"
                >
                  检查安装</button
                ><button
                  v-if="row.kind === '直接安装' && row.state !== '未安装'"
                  :disabled="!!activeJob"
                  @click="inspectInstallation(row.id, 'uninstall')"
                >
                  卸载…</button
                ><button v-if="row.kind !== '自动依赖'" @click="inspectInstallation(row.id, 'detail')">详情</button>
              </div>
            </div>
          </div>
          <div class="next-step">
            <span class="metadata-note">固定副本持有独立材料，不代表包库条目必须保留。</span
            ><button @click="panel = 'tasks'">查看安装任务</button>
          </div>
        </template>
        <template v-else-if="panel === 'plan' && plan">
          <h2>{{ plan.kind === 'prepare' ? '准备计划' : '安装计划' }} · {{ plan.title }}</h2>
          <p class="muted">
            {{
              plan.kind === 'prepare'
                ? '获取材料后生成固定版本，不改变当前选用版本。'
                : '仅安装材料，不自动加入或切换任何环境。'
            }}
          </p>
          <div class="detail-content">
            <div class="plan-summary">
              <span>{{ plan.rows.length - planMissing.length }} 项可复用</span
              ><span>{{ planMissing.length }} 项需要获取</span>
            </div>
            <div v-for="row in plan.rows" :key="row.id" class="plan-row">
              <div>
                <strong
                  >{{ row.name }} <small>{{ row.version }}</small></strong
                ><small>{{ row.reason }} · {{ row.missing ? 'npm 示例来源 · 体积未知' : '本机材料' }}</small>
              </div>
              <span class="badge" :class="row.missing ? 'warning' : 'ready'">{{
                row.missing ? '需获取' : '可复用'
              }}</span>
            </div>
            <div class="plan-options">
              <label><input v-model="offline" type="checkbox" />仅使用本机材料</label
              ><label><input v-model="simulateFailure" type="checkbox" />模拟装配失败</label>
            </div>
            <p v-if="offline && planMissing.length" role="alert" class="dependency-warning">
              离线缺少 {{ planMissing.length }} 项材料。取消“仅使用本机材料”后可模拟下载安装。
            </p>
            <p v-if="planStale" role="alert" class="dependency-warning">草稿已变化，请重新检查计划。</p>
            <p v-if="duplicatePlan" class="muted">相同任务已在下载中心，无需重复添加。</p>
            <p v-else-if="activeJob" class="muted">已有任务正在执行，确认后加入等待队列。</p>
          </div>
          <div class="next-step">
            <button @click="refreshPlan">重新检查</button
            ><button
              class="primary"
              :disabled="duplicatePlan || planStale || (offline && !!planMissing.length)"
              @click="executePlan"
            >
              {{ plan.kind === 'install' ? '安装材料' : planMissing.length ? '安装依赖并准备' : '准备版本' }}
            </button>
          </div>
        </template>
        <template v-else-if="panel === 'tasks'">
          <h2>下载与安装</h2>
          <p class="muted">
            {{ activeJob ? '正在处理 1 项' : '当前没有下载' }} · {{ pendingJobs.length - (activeJob ? 1 : 0) }} 项等待 ·
            进度为演示数据
          </p>
          <nav class="detail-tabs" aria-label="下载任务筛选">
            <button
              v-for="option in [
                { id: 'all', label: '全部' },
                { id: 'active', label: '进行中' },
                { id: 'completed', label: '已完成' },
                { id: 'failed', label: '失败 / 已取消' },
              ]"
              :key="option.id"
              :class="{ active: taskFilter === option.id }"
              @click="taskFilter = option.id"
            >
              {{ option.label }}
            </button>
          </nav>
          <div class="detail-content">
            <div v-if="!visibleJobs.length" class="empty">
              <h3>{{ jobs.length ? '没有此类任务' : '还没有下载任务' }}</h3>
              <p>安装资源包或准备环境时，下载与安装进度会汇总到这里。</p>
              <button v-if="!jobs.length" @click="demoDownload">体验一次模拟下载</button>
            </div>
            <article v-for="job in visibleJobs" :key="job.id" class="job-card">
              <div class="detail-heading">
                <strong>{{ job.title }}</strong
                ><span class="badge" :class="job.status === 'failed' ? 'warning' : 'ready'">{{
                  { queued: '等待中', running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }[
                    job.status
                  ]
                }}</span>
              </div>
              <div class="transfer-phase">
                <span>{{ job.phase }}</span
                ><span v-if="job.total">{{ job.downloaded }} / {{ job.total }} MB（模拟）</span
                ><span v-else>使用本机材料</span>
              </div>
              <progress
                v-if="job.total"
                :value="job.downloaded"
                :max="job.total"
                :aria-label="job.title + ' 下载进度'"
              ></progress>
              <div class="transfer-steps">
                <span
                  v-for="(label, index) in ['下载', '校验', '安装 / 准备']"
                  :key="label"
                  :class="{ done: job.stage > index, current: job.status === 'running' && job.stage === index }"
                  >{{ job.stage > index ? '✓' : index + 1 }} {{ label }}</span
                >
              </div>
              <small>{{ job.detail }}</small>
              <details class="transfer-files">
                <summary>包含 {{ job.plan.rows.length }} 项材料</summary>
                <div v-for="row in job.plan.rows" :key="row.id" class="plan-row">
                  <span>{{ row.name }} · {{ row.version }}</span
                  ><span>{{
                    !row.missing
                      ? '本机复用'
                      : job.stage > 0
                        ? '已获取并校验'
                        : job.status === 'queued'
                          ? '等待下载'
                          : job.status === 'cancelled'
                            ? '已取消'
                            : '下载阶段'
                  }}</span>
                </div>
              </details>
              <div class="job-actions">
                <button v-if="job.status === 'running' || job.status === 'queued'" @click="cancelJob(job)">
                  {{ job.status === 'queued' ? '移出队列' : '取消任务' }}</button
                ><button v-else-if="job.status === 'succeeded'" @click="openResult(job)">查看结果</button
                ><button v-else @click="retryJob(job)">重新检查并重试</button>
              </div>
            </article>
          </div>
          <div class="next-step">
            <span class="metadata-note">切换页面不取消任务；刷新会重置演示。</span
            ><button
              :disabled="!jobs.some(job => job.status !== 'running' && job.status !== 'queued')"
              @click="clearFinished"
            >
              清除结束记录
            </button>
          </div>
        </template>
        <template v-else-if="panel === 'version' && selectedVersion">
          <h2>{{ selectedVersion.name }} · v{{ selectedVersion.number }}</h2>
          <p class="muted">固定版本 · 配方更新不会改变这份材料</p>
          <div class="detail-content">
            <h3>锁定内容</h3>
            <div v-for="row in selectedVersion.lockedRows" :key="row.id" class="plan-row">
              <strong>{{ row.name }}</strong
              ><code>{{ row.version }}</code>
            </div>
            <h3 class="subheading">使用关系</h3>
            <div v-if="localVersionId === selectedVersion.id" class="usage">
              <span>本机游玩选择 · 正在引用</span><button @click="localVersionId = ''">解除本机选用</button>
            </div>
            <p v-else class="muted">暂无引用，可以删除此版本。</p>
            <p class="muted">服务器发布需选择实际服务器并检查权限；此 demo 不模拟远端发布。</p>
            <div v-if="confirmDelete" class="dependency-warning">
              <p>确定删除此固定版本？环境草稿仍会保留。</p>
              <button @click="removeVersion" :disabled="!!activeJob || localVersionId === selectedVersion.id">
                确认删除版本</button
              ><button @click="confirmDelete = false">取消</button>
            </div>
          </div>
          <div class="next-step lifecycle-actions">
            <button
              :disabled="!!activeJob || localVersionId === selectedVersion.id"
              :title="localVersionId === selectedVersion.id ? '请先解除本机选用' : undefined"
              @click="confirmDelete = true"
            >
              删除版本…</button
            ><button @click="exportVersion">导出预览</button
            ><button
              class="primary"
              :disabled="localVersionId === selectedVersion.id"
              @click="localVersionId = selectedVersion.id"
            >
              本机选用此版本
            </button>
          </div>
        </template>
        <template v-else-if="panel === 'delete-environment' && currentEnvironment">
          <h2>删除环境 · {{ currentEnvironment.name }}</h2>
          <div class="detail-content">
            <p>删除草稿前，需要先清理它的固定版本及使用关系。</p>
            <div v-for="version in environmentVersions" :key="version.id" class="usage">
              <span>v{{ version.number }} · {{ localVersionId === version.id ? '本机选用中' : '未被引用' }}</span
              ><button @click="openVersion(version)">处理版本</button>
            </div>
            <p v-if="!environmentVersions.length" class="muted">没有固定版本，可删除这份环境草稿。</p>
          </div>
          <div class="next-step">
            <button @click="panel = ''">保留环境</button
            ><button :disabled="!!environmentVersions.length || !!activeJob" @click="removeEnvironment">
              确认删除环境
            </button>
          </div>
        </template>
        <template v-else-if="panel === 'uninstall' && current">
          <h2>卸载 · {{ current.name }}</h2>
          <div class="detail-content">
            <p>仅移除这个版本的安装条目。环境配方保留，之后准备时需要重新获取材料。</p>
            <h3>受影响的草稿</h3>
            <p v-if="!affectedDrafts.length" class="muted">没有草稿选择此版本。</p>
            <p v-for="env in affectedDrafts" :key="env.id" class="usage">{{ env.name }} · 再次准备时需安装</p>
            <h3 class="subheading">固定版本</h3>
            <p class="muted">{{ affectedVersions.length }} 个固定版本拥有独立材料，不随安装条目卸载而删除。</p>
          </div>
          <div class="next-step">
            <button @click="panel = ''">取消</button
            ><button :disabled="!!activeJob" @click="uninstallPackage">确认卸载此版本</button>
          </div>
        </template>
        <template v-else-if="panel === 'add-to' && current">
          <h2>加入环境 · {{ current.name }}</h2>
          <div class="detail-content">
            <p>修改环境草稿；同名包会替换为当前所选版本，旧固定版本不变。</p>
            <label class="target-field"
              >目标环境<select v-model="addTarget">
                <option v-for="env in environments" :key="env.id" :value="env.id">{{ env.name }}</option>
              </select></label
            >
            <p v-if="current.state !== '已安装' && current.state !== '内置'" class="dependency-warning">
              可先保存配方，准备时再统一获取缺失材料。
            </p>
            <p v-if="!environments.length">请先创建环境。</p>
          </div>
          <div class="next-step">
            <button @click="panel = ''">取消</button
            ><button
              class="primary"
              :disabled="!environments.some(env => env.id === addTarget)"
              @click="addToEnvironment"
            >
              加入环境草稿
            </button>
          </div>
        </template>
        <template v-else-if="panel === 'add-package'">
          <h2>添加资源包</h2>
          <p class="muted">以下为演示来源；正式版可选择 npm 精确版本或本地 .tgz 文件。</p>
          <div class="detail-content">
            <label class="target-field"
              >示例资源包<select v-model="chosenInstall">
                <option v-for="pkg in packages.filter(pkg => pkg.id !== 'base')" :key="pkg.id" :value="pkg.id">
                  {{ pkg.name }} · {{ packageMetadata[pkg.id]?.version }} · {{ pkg.state }}
                </option>
              </select></label
            >
            <p>将先检查安装材料与依赖，不自动改变环境。</p>
          </div>
          <div class="next-step">
            <button @click="panel = ''">取消</button
            ><button class="primary" :disabled="!!activeJob" @click="planInstall(chosenInstall)">检查安装计划</button>
          </div>
        </template>
      </aside>
      <aside v-else-if="current" class="detail" aria-label="所选内容详情">
        <div class="detail-heading">
          <span class="eyebrow">{{ section === 'environments' ? '环境 / 整合包' : '资源包 / 内容模组' }}</span
          ><span class="badge">{{ current.state }}</span>
        </div>
        <h2>{{ current.name }}</h2>
        <p class="muted">{{ current.description }}</p>
        <div class="detail-content">
          <template v-if="currentEnvironment && section === 'environments'">
            <nav class="detail-tabs">
              <button
                v-for="label in ['内容组合', '组合规则', '固定版本']"
                :key="label"
                :class="{ active: tab === label }"
                @click="tab = label"
              >
                {{ label }}
              </button>
            </nav>
            <template v-if="tab === '内容组合'">
              <div class="composition-toolbar">
                <select v-model="pendingPackage" aria-label="选择要加入的资源包">
                  <option v-for="pkg in packages.filter(pkg => pkg.id !== 'base')" :key="pkg.id" :value="pkg.id">
                    {{ pkg.name }} · {{ packageMetadata[pkg.id]?.version }}
                  </option></select
                ><button @click="addSelectedMember">加入并启用</button>
              </div>
              <label v-for="pkg in memberPackages" :key="pkg.id" class="package-choice explicit-member"
                ><input
                  type="checkbox"
                  :checked="currentEnvironment.packageIds.includes(pkg.id)"
                  :disabled="pkg.id === 'base'"
                  @change="toggleMember(pkg.id, ($event.target as HTMLInputElement).checked)"
                /><span
                  >{{ pkg.name }} <code>{{ packageMetadata[pkg.id]?.version }}</code
                  ><small
                    >{{
                      currentEnvironment.packageIds.includes(pkg.id)
                        ? introducedBy(currentEnvironment, pkg.id).length
                          ? '被 ' + introducedBy(currentEnvironment, pkg.id).join('、') + ' 依赖'
                          : '直接启用'
                        : '已停用'
                    }}{{ composition(currentEnvironment).roots.includes(pkg.id) ? ' · 用户保留' : '' }}</small
                  ></span
                ><span class="badge" :class="pkg.state === '未安装' ? 'warning' : 'ready'">{{
                  pkg.state === '未安装' ? '需安装' : pkg.state
                }}</span></label
              >
            </template>
            <template v-else-if="tab === '组合规则'">
              <div class="metadata-grid">
                <div>
                  <span>玩法定位</span
                  ><strong>{{ currentEnvironment.id === 'ranked' ? '标准竞技' : '好友休闲 / 自定义玩法' }}</strong>
                </div>
                <div><span>队伍规模</span><strong>1–6 只精灵（示例）</strong></div>
                <div><span>内容范围</span><strong>由所选资源包共同提供</strong></div>
                <div><span>版本策略</span><strong>准备后固定资源包版本与规则</strong></div>
              </div>
              <p class="muted">环境像整合包：组织资源包与对战规则，准备为一份可复用、可分享的玩法组合。</p>
            </template>
            <template v-else>
              <div v-if="!environmentVersions.length" class="empty">
                <h3>还没有固定版本</h3>
                <p>检查依赖并准备后，会保留独立的内容快照。</p>
                <button class="primary" @click="prepare">准备版本…</button>
              </div>
              <div v-for="version in environmentVersions" :key="version.id" class="version-row">
                <div>
                  <strong>v{{ version.number }}</strong
                  ><small
                    >{{ version.lockedRows.length }} 个锁定包 ·
                    {{ localVersionId === version.id ? '本机选用中' : '未被引用' }}</small
                  >
                </div>
                <button @click="openVersion(version)">管理版本</button>
              </div>
            </template>
          </template>
          <template v-else-if="metadata">
            <nav class="detail-tabs" aria-label="资源包信息">
              <button
                v-for="label in ['简介', '依赖', '使用此包的环境']"
                :key="label"
                :class="{ active: packageTab === label }"
                @click="packageTab = label"
              >
                {{ label }}
              </button>
            </nav>
            <template v-if="packageTab === '简介'">
              <div class="metadata-grid">
                <div>
                  <span>作者</span><strong>{{ metadata.author }}</strong>
                </div>
                <div>
                  <span>版本</span><strong>{{ metadata.version }}</strong>
                </div>
                <div>
                  <span>包标识</span><code>{{ metadata.name }}</code>
                </div>
                <div>
                  <span>命名空间</span><code>{{ metadata.namespace }}</code>
                </div>
                <div>
                  <span>兼容要求</span><strong>{{ metadata.compatibility }}</strong>
                </div>
                <div>
                  <span>许可证</span><strong>{{ metadata.license }}</strong>
                </div>
              </div>
              <div class="metadata-strip">
                <span>内容</span><strong>{{ current.count }}</strong>
              </div>
              <div class="metadata-strip">
                <span>安装来源</span><span>{{ metadata.source }}</span>
              </div>
              <p class="metadata-note">项目主页 / 问题反馈：作者未提供</p>
            </template>
            <template v-else-if="packageTab === '依赖'">
              <p v-if="!metadata.dependencies.length" class="muted">没有额外依赖。</p>
              <div v-for="dependency in metadata.dependencies" :key="dependency.name" class="dependency-row">
                <div>
                  <strong>{{ dependency.name }}</strong
                  ><small>要求版本：{{ dependency.version }}</small>
                </div>
                <span class="badge" :class="dependency.available ? 'ready' : 'warning'">{{
                  dependency.available ? '已满足' : '缺少依赖'
                }}</span>
              </div>
              <p v-if="current.state === '需处理'" class="dependency-warning">
                可以先加入环境草稿，准备版本时一并安装缺失依赖。
              </p>
            </template>
            <template v-else>
              <p
                v-for="env in environments.filter(env => env.packageIds.includes(current!.id))"
                :key="env.id"
                class="usage"
              >
                <span
                  >{{ env.name }} <span>{{ env.state }}</span></span
                >
                <button
                  @click="
                    () => {
                      switchSection('environments')
                      selected = env.id
                    }
                  "
                >
                  查看环境
                </button>
              </p>
              <p v-if="!environments.some(env => env.packageIds.includes(current!.id))" class="muted">
                尚未加入任何环境草稿。
              </p>
              <h3 class="subheading">持有独立材料的固定版本</h3>
              <p v-for="version in affectedVersions" :key="version.id" class="usage">
                <span>{{ version.name }} · v{{ version.number }}</span
                ><button @click="openVersion(version)">查看引用</button>
              </p>
              <p v-if="!affectedVersions.length" class="muted">没有固定版本使用此包。</p>
            </template>
          </template>
        </div>
        <div v-if="currentEnvironment && section === 'environments'" class="next-step lifecycle-actions">
          <details class="more-actions">
            <summary>更多操作</summary>
            <div>
              <button @click="duplicateEnvironment">复制环境</button
              ><button :disabled="!!activeJob" @click="panel = 'delete-environment'">删除环境…</button>
            </div>
          </details>
          <button class="primary" @click="prepare">检查依赖并准备…</button>
        </div>
        <div v-if="section === 'packages'" class="next-step lifecycle-actions">
          <details v-if="current.id !== 'base'" class="more-actions">
            <summary>更多操作</summary>
            <div>
              <button @click="panel = 'installation'">本机材料清单</button
              ><button @click="otherVersion">安装其他版本…</button
              ><button :disabled="!!activeJob || current.state === '未安装'" @click="panel = 'uninstall'">
                卸载此版本…
              </button>
            </div>
          </details>
          <button
            v-if="current.state === '未安装' || current.state === '需处理'"
            :disabled="!!activeJob"
            @click="planInstall(current.id)"
          >
            {{ current.state === '未安装' ? '安装…' : '补齐依赖…' }}
          </button>
          <button class="primary" @click="panel = 'add-to'">加入环境…</button>
        </div>
      </aside>
    </div>
    <button class="task-launcher" @click="panel = 'tasks'">
      {{ activeJob ? '◌ ' + activeJob.phase : latestJob ? '下载 · ' + latestJob.phase : '↓ 下载与安装' }}
      <span v-if="jobs.length">{{ jobs.length }}</span>
    </button>
    <details class="state">
      <summary>演示状态与参考</summary>
      <p>A：游戏库卡片，B：扩展管理器分栏，C：任务步骤与紧凑清单。</p>
      <p>
        参考 <a href="https://modrinth.com/app" target="_blank" rel="noreferrer">Modrinth App</a> 的实例与内容组织，以及
        <a
          href="https://code.visualstudio.com/docs/configure/extensions/extension-marketplace"
          target="_blank"
          rel="noreferrer"
          >VS Code 扩展管理</a
        >
        的列表与详情分工。
      </p>
      <p>
        另参考
        <a href="https://www.prismlauncher.org/wiki/help-pages/loader-mods/" target="_blank" rel="noreferrer"
          >Prism Launcher 的实例模组管理</a
        >：在环境内勾选内容，并将版本管理放在独立页签。最终方案待体验后确定。
      </p>
      <pre>{{
        JSON.stringify(
          { variant, section, selected: current?.id, environments, versions, localVersionId, jobs },
          null,
          2,
        )
      }}</pre>
    </details>
    <nav class="switcher" aria-label="原型方案切换">
      <button @click="cycle(-1)" aria-label="上一个方案">←</button
      ><span>{{ titles[['A', 'B', 'C'].indexOf(variant)] }}</span
      ><button @click="cycle(1)" aria-label="下一个方案">→</button
      ><span class="switch-hint">示例数据 · 方向键切换</span>
    </nav>
  </main>
</template>
<style scoped>
.prototype {
  --ink: #233449;
  --muted: #718095;
  --line: #e1e7ee;
  --accent: #216b60;
  color: var(--ink);
  max-width: 1280px;
  margin: auto;
  padding: 24px 32px 110px;
  font-size: 14px;
}
.demo-note {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #8a641f;
  background: #fff7e5;
  border: 1px solid #f0dfb6;
  padding: 9px 14px;
  border-radius: 8px;
  margin-bottom: 25px;
}
.heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  color: var(--muted);
}
h1 {
  font-size: 30px;
  font-weight: 750;
  margin: 6px 0;
}
h2 {
  font-size: 22px;
  font-weight: 700;
  margin: 14px 0;
}
h3 {
  font-weight: 650;
}
p {
  line-height: 1.7;
  margin: 8px 0;
}
.heading p:not(.eyebrow),
.muted,
small {
  color: var(--muted);
}
button,
input,
select {
  font: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--line);
  background: #fff;
  padding: 9px 14px;
  border-radius: 8px;
  color: var(--ink);
}
button:hover {
  border-color: #78a99e;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid #78b8ed;
  outline-offset: 3px;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  font-weight: 600;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.section-tabs {
  display: flex;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--line);
  margin-top: 24px;
}
.section-tabs button,
.detail-tabs button {
  border: 0;
  border-radius: 0;
  background: transparent;
  border-bottom: 2px solid transparent;
  padding: 14px 4px;
}
.active {
  color: var(--accent);
  border-bottom-color: var(--accent) !important;
  font-weight: 700;
}
.section-tabs span:not(.scope) {
  font-size: 11px;
  margin-left: 6px;
  background: #edf1f5;
  padding: 2px 6px;
  border-radius: 5px;
}
.scope {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 22px 0;
}
.toolbar input {
  max-width: 380px;
  width: 100%;
}
input:not([type='checkbox']),
select {
  border: 1px solid var(--line);
  background: white;
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 0;
}
.toolbar > span {
  margin-left: auto;
  color: var(--muted);
  white-space: nowrap;
}
.body-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 24px;
  align-items: start;
}
.items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.item {
  text-align: left;
  padding: 0;
  overflow: hidden;
  min-width: 0;
}
.item.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.cover {
  height: 112px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px;
  background: #e7eef8;
  color: #4874a0;
}
.cover > span {
  font-size: 32px;
  font-weight: 800;
}
.cover small {
  font-size: 9px;
  letter-spacing: 2px;
  color: inherit;
  opacity: 0.7;
}
.teal {
  background: #e0efeb;
  color: #388473;
}
.violet {
  background: #ede8f8;
  color: #79609f;
}
.amber {
  background: #faf0d9;
  color: #a48031;
}
.item-copy {
  display: block;
  padding: 16px;
}
.item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 16px;
  font-weight: 650;
}
.item-copy small {
  display: block;
  font-size: 11px;
  margin-top: 7px;
  overflow-wrap: anywhere;
}
.item-copy p {
  font-size: 12px;
  color: var(--muted);
}
.counts {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 14px;
}
.badge {
  display: inline-block;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 500;
  background: #eef1f5;
  padding: 3px 7px;
  border-radius: 5px;
  color: #64748b;
}
.ready {
  background: #e1f1e9;
  color: #277856;
}
.warning {
  background: #fff2d9;
  color: #926820;
}
.chevron {
  display: none;
}
.detail {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px;
  min-width: 0;
}
.detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-tabs {
  display: flex;
  gap: 22px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 18px;
}
.package-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 0;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
}
.package-choice small {
  display: block;
  font-size: 10px;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
input[type='checkbox'] {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.next-step {
  padding: 16px;
  background: #f3f7f6;
  border-radius: 8px;
  margin-top: 22px;
  font-size: 12px;
}
.next-step p {
  color: var(--muted);
}
.next-step button {
  width: 100%;
  margin-top: 8px;
}
.version-row,
.usage {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding: 14px 0;
}
.version-row small {
  display: block;
}
.usage span {
  font-size: 11px;
  color: var(--muted);
}
.package-stats {
  padding: 18px 0;
  margin-bottom: 15px;
  border-bottom: 1px solid var(--line);
}
.feedback {
  background: #e8f4ed;
  padding: 10px 14px;
  border-radius: 8px;
}
.feedback button {
  float: right;
  padding: 0 7px;
  background: transparent;
  border: 0;
}
.create-form {
  display: flex;
  align-items: end;
  gap: 10px;
  background: #fff;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  margin-top: 16px;
}
.create-form label {
  display: grid;
  gap: 6px;
}
.empty {
  padding: 35px 15px;
  text-align: center;
  grid-column: 1/-1;
  color: var(--muted);
}
.state {
  font-size: 12px;
  color: var(--muted);
  margin-top: 28px;
}
.state summary {
  cursor: pointer;
}
.state pre {
  max-height: 230px;
  overflow: auto;
  background: #eef2f6;
  padding: 15px;
}
.state a {
  text-decoration: underline;
}
.switcher {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 18px;
  background: #203448;
  color: white;
  padding: 8px 12px;
  border-radius: 50px;
  box-shadow: 0 8px 32px #142c3933;
  z-index: 1000;
  white-space: nowrap;
}
.switcher button {
  background: #ffffff16;
  border: 0;
  border-radius: 50%;
  color: white;
}
.switch-hint {
  font-size: 10px;
  opacity: 0.6;
  padding-right: 10px;
}
.variant-B .body-layout {
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: white;
}
.variant-B .items {
  display: block;
  border-right: 1px solid var(--line);
}
.variant-B .item {
  display: flex;
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 18px 14px;
  gap: 12px;
  align-items: center;
}
.variant-B .item.selected {
  box-shadow: inset 3px 0 var(--accent);
  background: #eef6f3;
}
.variant-B .cover {
  height: 48px;
  width: 48px;
  flex-shrink: 0;
  border-radius: 10px;
  padding: 0;
  align-items: center;
}
.variant-B .cover > span {
  font-size: 20px;
}
.variant-B .item-copy {
  padding: 0;
  flex: 1;
}
.variant-B .item-title {
  font-size: 14px;
}
.variant-B .detail {
  border: 0;
  padding: 28px 32px;
  min-height: 470px;
}
.variant-B .counts {
  margin-top: 8px;
}
.workflow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 0 0 24px;
  padding: 22px;
  background: #edf4f2;
  border-radius: 12px;
}
.workflow > div {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 6px;
}
.workflow b {
  grid-row: span 2;
  color: #5a8d81;
  font-size: 18px;
}
.workflow small {
  font-size: 11px;
}
.variant-C .body-layout {
  grid-template-columns: 1fr;
}
.variant-C .items {
  display: block;
}
.variant-C .item {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 8px;
  padding: 12px 16px;
  gap: 16px;
}
.variant-C .cover {
  height: 42px;
  width: 42px;
  border-radius: 8px;
  padding: 0;
  align-items: center;
  flex-shrink: 0;
}
.variant-C .cover > span {
  font-size: 20px;
}
.variant-C .item-copy {
  padding: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 25px;
}
.variant-C .item-copy p {
  display: none;
}
.variant-C .counts {
  margin: 4px 0;
}
.variant-C .chevron {
  display: block;
}
.variant-C .detail {
  padding: 24px 30px;
}
.variant-C .package-choice {
  max-width: 650px;
}
.variant-C .next-step {
  max-width: 650px;
}
@media (max-width: 800px) {
  .prototype {
    padding: 18px 16px 110px;
  }
  .body-layout,
  .variant-B .body-layout {
    grid-template-columns: 1fr;
  }
  .variant-B .items {
    border-right: 0;
  }
  .heading {
    align-items: start;
  }
  h1 {
    font-size: 24px;
  }
  .workflow {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .scope,
  .switch-hint {
    display: none;
  }
  .demo-note {
    gap: 12px;
    font-size: 10px;
  }
  .variant-C .item-copy {
    display: block;
  }
  .create-form {
    flex-wrap: wrap;
  }
}
@media (max-width: 450px) {
  .items {
    grid-template-columns: 1fr;
  }
  .heading {
    flex-direction: column;
    gap: 12px;
  }
  .toolbar {
    flex-wrap: wrap;
  }
  .toolbar input {
    max-width: none;
  }
  .switcher {
    gap: 10px;
    font-size: 12px;
  }
  .variant-B .detail {
    padding: 20px;
  }
}
/* B: bounded workspace; only the two content panes scroll. */
.variant-B {
  height: 100%;
  max-width: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 24px 50px;
  overflow: hidden !important;
  box-sizing: border-box;
}
.variant-B > :not(.body-layout) {
  flex-shrink: 0;
}
.variant-B .demo-note {
  padding: 4px 10px;
  margin-bottom: 10px;
}
.variant-B .heading .eyebrow,
.variant-B .heading > div > p:last-child {
  display: none;
}
.variant-B h1 {
  font-size: 22px;
  margin: 0;
}
.variant-B .section-tabs {
  margin-top: 8px;
}
.variant-B .section-tabs button {
  padding: 9px 4px;
}
.variant-B .toolbar {
  padding: 10px 0;
}
.variant-B .body-layout {
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(240px, 29%) minmax(0, 1fr);
  align-items: stretch;
}
.variant-B .items {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.variant-B .item {
  padding: 14px;
}
.variant-B .detail {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 18px 24px;
}
.variant-B .detail > :not(.detail-content) {
  flex-shrink: 0;
}
.variant-B .detail h2 {
  margin: 8px 0 0;
  font-size: 21px;
}
.variant-B .detail > .muted {
  margin: 4px 0;
  font-size: 12px;
}
.variant-B .detail-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.variant-B .detail-tabs {
  position: sticky;
  top: 0;
  background: white;
  z-index: 1;
  margin-bottom: 8px;
}
.variant-B .detail-tabs button {
  padding: 10px 4px;
}
.variant-B .package-choice {
  padding: 10px 0;
}
.variant-B .next-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  margin-top: 12px;
}
.variant-B .next-step p {
  margin: 2px 0 0;
}
.variant-B .next-step button {
  width: auto;
  margin: 0;
  white-space: nowrap;
}
.variant-B .feedback {
  margin: 6px 0 0;
  padding: 6px 12px;
  font-size: 12px;
}
.variant-B .create-form {
  margin-top: 8px;
  padding: 10px;
}
.variant-B .create-form label {
  display: flex;
  align-items: center;
}
.variant-B .switcher {
  bottom: 8px;
  padding: 3px 10px;
  gap: 10px;
  font-size: 12px;
}
.variant-B .switcher button {
  padding: 4px 10px;
}
.variant-B .state {
  position: fixed;
  right: 24px;
  bottom: 12px;
  margin: 0;
  z-index: 50;
}
.variant-B .state[open] {
  width: min(560px, calc(100vw - 32px));
  max-height: 50vh;
  overflow: auto;
  padding: 16px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 4px 24px #23344922;
}
@media (max-width: 640px) {
  .variant-B {
    padding: 8px 12px 70px;
  }
  .variant-B .heading {
    flex-direction: row;
    align-items: center;
  }
  .variant-B .body-layout {
    grid-template-columns: minmax(115px, 34%) minmax(0, 1fr);
  }
  .variant-B .item {
    padding: 10px 8px;
  }
  .variant-B .item .cover,
  .variant-B .item-copy > small,
  .variant-B .counts {
    display: none;
  }
  .variant-B .item-title {
    flex-direction: column;
    align-items: start;
    font-size: 12px;
  }
  .variant-B .detail {
    padding: 12px;
  }
  .variant-B .detail h2 {
    font-size: 18px;
  }
  .variant-B .detail > .muted {
    display: none;
  }
  .variant-B .next-step {
    padding: 8px 0 0;
    background: white;
  }
  .variant-B .next-step > div {
    display: none;
  }
  .variant-B .next-step button {
    width: 100%;
  }
  .variant-B .state {
    bottom: 48px;
    right: 12px;
    font-size: 10px;
  }
  .variant-B .package-choice {
    flex-wrap: wrap;
  }
  .variant-B .package-choice > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .variant-B .detail-tabs {
    gap: 12px;
    font-size: 12px;
  }
  .variant-B .toolbar input {
    flex: 1;
    width: 100px;
  }
  .variant-B .toolbar > span {
    display: none;
  }
}

.variant-B .demo-note {
  display: none;
}
.variant-B .heading {
  min-height: 38px;
}
.variant-B .recipe-helper {
  display: none;
}
.variant-B .package-choice {
  padding: 7px 0;
}
.variant-B .detail-tabs {
  margin-bottom: 4px;
}
.variant-B .switch-hint {
  font-size: 10px;
}

@media (min-width: 641px) and (max-height: 800px) {
  .variant-B .toolbar {
    padding: 6px 0;
  }
  .variant-B .section-tabs button {
    padding: 6px 4px;
  }
  .variant-B .next-step {
    padding: 8px 12px;
    margin-top: 8px;
  }
}

.metadata-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
  padding: 12px 0;
}
.metadata-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.metadata-grid span,
.metadata-strip > span:first-child,
.metadata-note {
  color: var(--muted);
  font-size: 11px;
}
.metadata-grid strong,
.metadata-grid code {
  font-size: 12px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.metadata-strip {
  display: flex;
  gap: 16px;
  align-items: baseline;
  padding: 8px 0;
  border-top: 1px solid var(--line);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.metadata-strip strong {
  font-weight: 500;
}
.metadata-note {
  margin: 6px 0;
}
.dependency-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
  gap: 12px;
}
.dependency-row small {
  display: block;
  margin-top: 6px;
}
.dependency-warning {
  padding: 12px;
  background: #fff6e4;
  border-radius: 8px;
  color: #896421;
  font-size: 12px;
}
@media (max-width: 640px) {
  .metadata-grid {
    grid-template-columns: 1fr;
  }
  .metadata-strip {
    flex-direction: column;
    gap: 4px;
  }
  .detail-tabs {
    flex-wrap: wrap;
  }
}

@media (min-width: 641px) {
  .variant-B .metadata-grid {
    gap: 10px 24px;
    padding: 14px 0;
  }
  .variant-B .metadata-grid > div {
    grid-template-columns: 60px minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
  }
}

.lifecycle-panel .text-button {
  border: 0;
  padding: 0;
  background: transparent;
}
.lifecycle-panel .detail-content {
  padding-top: 8px;
}
.plan-summary {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  color: var(--muted);
  font-size: 12px;
}
.plan-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.plan-row small {
  font-size: 11px;
  font-weight: 400;
}
.plan-row > div > small {
  display: block;
  margin-top: 4px;
}
.plan-options {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 14px 0;
  font-size: 12px;
}
.plan-options label {
  display: flex;
  gap: 6px;
  align-items: center;
}
.lifecycle-actions {
  flex-wrap: wrap;
}
.variant-B .lifecycle-actions > button {
  width: auto;
}
.variant-B .lifecycle-actions > .more-actions {
  display: block;
}
.more-actions {
  position: relative;
  margin-right: auto;
  font-size: 12px;
}
.more-actions summary {
  cursor: pointer;
  padding: 8px;
}
.more-actions > div {
  position: absolute;
  bottom: 100%;
  left: 0;
  display: grid;
  gap: 4px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px;
  min-width: 150px;
  box-shadow: 0 4px 16px #23344922;
  z-index: 10;
}
.more-actions button {
  white-space: nowrap;
  text-align: left;
}
.job-card {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 10px;
}
.job-card strong {
  font-size: 13px;
}
.job-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.subheading {
  margin-top: 18px;
}
.target-field {
  display: grid;
  gap: 8px;
  margin: 16px 0;
}
.task-launcher {
  position: fixed;
  bottom: 9px;
  left: 160px;
  font-size: 11px;
  padding: 5px 10px;
  z-index: 45;
}
@media (max-width: 800px) {
  .task-launcher {
    left: 12px;
    bottom: 48px;
  }
}

.variant-B .lifecycle-panel .plan-row {
  padding: 5px 0;
}
.variant-B .lifecycle-panel .plan-row > div > small {
  margin-top: 1px;
}
.variant-B .lifecycle-panel .plan-summary {
  padding: 4px 0;
}
.variant-B .lifecycle-panel .plan-options {
  padding: 8px 0;
}

.installation-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: #f3f7f6;
  border-radius: 8px;
}
.installation-current small {
  display: block;
  margin-top: 3px;
}
.installed-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
.installed-row > div:first-child {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.installed-row strong {
  font-weight: 600;
}
.installed-row code {
  font-size: 11px;
  font-weight: 400;
  margin-left: 4px;
}
.installed-row small {
  display: block;
  font-size: 10px;
  margin-top: 4px;
}
.installed-actions {
  display: flex;
  gap: 4px;
}
.installed-actions button {
  padding: 5px 8px;
  font-size: 11px;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .installed-row {
    flex-wrap: wrap;
  }
  .installed-row > div:first-child {
    flex-basis: 100%;
  }
  .installation-current {
    flex-wrap: wrap;
  }
  .section-tabs {
    gap: 12px;
  }
}

.transfer-phase {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  margin: 12px 0 6px;
}
.job-card progress {
  display: block;
  width: 100%;
  height: 8px;
  accent-color: var(--accent);
  border: none;
  border-radius: 10px;
  overflow: hidden;
}
.job-card progress::-webkit-progress-bar {
  background: #e9efed;
}
.job-card progress::-webkit-progress-value {
  background: var(--accent);
  transition: width 0.3s;
}
.transfer-steps {
  display: flex;
  gap: 20px;
  color: var(--muted);
  font-size: 11px;
  padding: 10px 0;
}
.transfer-steps .done,
.transfer-steps .current {
  color: var(--accent);
}
.transfer-steps .current {
  font-weight: 700;
}
.transfer-files {
  font-size: 11px;
  color: var(--muted);
  margin-top: 12px;
}
.transfer-files summary {
  cursor: pointer;
}
@media (max-width: 640px) {
  .transfer-phase,
  .transfer-steps {
    flex-wrap: wrap;
    gap: 6px;
  }
}

.composition-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  position: sticky;
  top: 40px;
  background: white;
  z-index: 1;
}
.composition-toolbar select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font-size: 12px;
}
.composition-toolbar button {
  padding: 6px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.explicit-member > span:first-of-type {
  flex: 1;
}
.explicit-member code {
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 640px) {
  .composition-toolbar {
    flex-wrap: wrap;
    position: static;
  }
}
</style>
