import i18next from 'i18next'
import { contentLanguage, environmentLocaleText } from './serverContent'

type EnvironmentKind = 'elements' | 'matchupTables' | 'parameterGroups' | 'parameterProfiles' | 'ruleSets'

function label(ns: string, key: string, fallback: string) {
  return i18next.t(key, { ns, nsSeparator: false, lng: contentLanguage.value, defaultValue: fallback }) || fallback
}

export function environmentName(kind: EnvironmentKind, id: string, inlineName?: string) {
  const fallback = inlineName ?? id
  if (kind === 'elements') return label('element', id + '.name', fallback)
  return label('environment', kind + '.' + id + '.name', fallback)
}

export function gameplayName(kind: 'element' | 'nature' | 'enhancement', id: string, inlineName?: string) {
  const selected = environmentLocaleText(kind, id, 'name')
  if (selected !== undefined) return selected
  return label(kind, id + '.name', inlineName ?? id)
}

export function parameterGroupLabel(group: { id: string; name?: string; unit?: string }) {
  const name = environmentName('parameterGroups', group.id, group.name)
  const unit = label('environment', 'parameterGroups.' + group.id + '.unit', group.unit ?? '')
  return unit ? name + ' · ' + unit : name
}
