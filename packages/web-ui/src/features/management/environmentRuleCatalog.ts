import { maxSatisfying, satisfies } from 'semver'
import type {
  ManagedEnvironment,
  ManagedEnvironmentInstallation,
  ManagedReadyEnvironmentInstallation,
} from '@arcadia-eternity/protocol'
import type { InstalledContentPackage, PackageRuleCatalog } from '@/types/contentPackages'

type Member = PackageRuleCatalog['members'][number]
type Candidate = { member: Member; catalog: PackageRuleCatalog }

export type EditorPackage = Pick<InstalledContentPackage, 'id' | 'name' | 'version'> &
  Partial<Pick<InstalledContentPackage, 'contentIds' | 'ruleCatalog'>>

export function resolveDraftContent({
  rows,
  sources,
  materials,
  installations,
  origin,
  draft,
}: {
  rows: { name: string; version: string }[]
  sources: string[]
  materials: EditorPackage[]
  installations: ManagedEnvironmentInstallation[]
  origin?: ManagedReadyEnvironmentInstallation
  draft?: ManagedEnvironment
}) {
  // A captured archive and its pinned version can represent the same installation.
  const declaration = draft && draft.revision === origin?.draftRevision ? draft.document : origin?.document
  const packages = new Map(rows.map(row => [row.name.trim(), row.version.trim()]))
  const matching =
    declaration &&
    rows.length === Object.keys(declaration.packages).length &&
    Object.entries(declaration.packages).every(([name, version]) => packages.get(name) === version) &&
    sources.length === declaration.sources.length &&
    declaration.sources.every(name => sources.includes(name))
      ? origin
      : undefined
  const lockedMembers = matching?.members
  if (matching?.ruleComposition && lockedMembers?.length) {
    return {
      installation: matching,
      catalog: matching,
      ruleSets: matching.ruleComposition.ruleSets,
      packages: lockedMembers,
    }
  }
  const candidates = new Map<string, Candidate[]>()
  function index(catalog: PackageRuleCatalog) {
    for (const member of catalog.members) {
      const entries = candidates.get(member.name) ?? []
      entries.push({ member, catalog })
      candidates.set(member.name, entries)
    }
  }
  function prepared(version: ManagedReadyEnvironmentInstallation) {
    if (version.members && version.ruleComposition)
      index({ members: version.members, ruleSets: version.ruleComposition.ruleSets })
  }
  if (origin) prepared(origin)
  for (const item of materials) if (item.ruleCatalog) index(item.ruleCatalog)
  for (const item of installations) if (item.status === 'ready' && item !== origin) prepared(item)

  const selected = new Map<string, Candidate>()
  const conflicts = new Set<string>()
  const visited = new Set<Member>()
  function include(candidate: Candidate) {
    const { member, catalog } = candidate
    if (visited.has(member)) return
    visited.add(member)
    const previous = selected.get(member.namespace)
    if (previous) {
      if (previous.member.name !== member.name || previous.member.version !== member.version)
        conflicts.add(member.namespace)
    } else selected.set(member.namespace, candidate)
    for (const name of member.dependencies) {
      const dependency = catalog.members.find(entry => entry.name === name)
      if (dependency) include({ member: dependency, catalog })
    }
  }

  // Some older materials only carry IDs. Include their versions in the same selection as rule catalogs.
  const selectedPackages = new Map<string, { name: string; version: string }>()
  let allRootsResolved = true
  function select(name: string, range?: string) {
    const choices = candidates.get(name) ?? []
    const installed = materials.filter(pkg => pkg.name === name)
    const versions = new Set([...choices.map(({ member }) => member.version), ...installed.map(pkg => pkg.version)])
    const pinned = origin?.members?.find(member => member.name === name)?.version
    const keepLock =
      range === undefined
        ? declaration?.sources.includes(name)
        : pinned && (declaration?.packages[name] === range || satisfies(pinned, range))
    let version = keepLock ? pinned : undefined
    if (!version && range !== undefined) version = maxSatisfying([...versions], range) ?? undefined
    if (!version && range === undefined && versions.size === 1) version = [...versions][0]
    if (!version) {
      allRootsResolved = false
      return
    }
    const candidate = choices.find(({ member }) => member.version === version)
    if (candidate) include(candidate)
    else selectedPackages.set(name, { name, version })
  }
  for (const [name, range] of packages) if (range) select(name, range)
  for (const name of sources) select(name)
  const members = [...selected.values()].filter(({ member }) => !conflicts.has(member.namespace))
  for (const { member } of members) selectedPackages.set(member.name, member)
  // A new draft can use a captured catalog for the same complete package selection.
  // An unresolved root, a registered source, or conflicting captures have no verified catalog.
  const complete =
    allRootsResolved &&
    members.length > 0 &&
    !conflicts.size &&
    !sources.length &&
    rows.length === packages.size &&
    rows.every(row => row.version.trim() && selectedPackages.has(row.name.trim()))
  const captures = complete
    ? installations.filter(
        (item): item is ManagedReadyEnvironmentInstallation =>
          item.status === 'ready' &&
          item.members?.length === selectedPackages.size &&
          item.members.every(member => selectedPackages.get(member.name)?.version === member.version),
      )
    : []
  const catalog = matching ?? (new Set(captures.map(item => item.contentRevision)).size === 1 ? captures[0] : undefined)
  return {
    installation: matching,
    catalog,
    ruleSets:
      catalog?.ruleComposition?.ruleSets ??
      members.flatMap(({ member, catalog }) =>
        catalog.ruleSets.filter(row => row.id.startsWith(member.namespace + ':')),
      ),
    packages: [...selectedPackages.values()],
  }
}

export function rulePreviewIssue(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^ENVIRONMENT_RULE_SET_MISSING: /, '所选内容包中找不到规则集：')
    .replace(/^ENVIRONMENT_REFERENCE_MISSING: /, '内容包中找不到引用：')
    .replace(/^ENVIRONMENT_RULE_CYCLE: /, '规则集循环引用：')
    .replace(/^ENVIRONMENT_RULE_CONFLICT: /, '继承规则有冲突：')
}
